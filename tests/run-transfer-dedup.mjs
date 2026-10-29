import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=await mkdtemp(path.join(tmpdir(),'hotel-transfer-dedup-')),database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(resolve=>socket.close(resolve));
let server,admin,clerk,checks=0,roomIndex=0,receiptId=70000;
const secret='isolated-transfer-dedup-key';
const bank={bankId:'MB',bankName:'Fixture bank',accountNumber:'0000000000001',accountName:'FIXTURE ONLY',sepayApiKey:secret};
async function stop(){if(server&&server.exitCode===null){const done=once(server,'exit');server.kill();await done;}server=null;}
async function start(){await stop();server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root,'--Payments:BankConfigFile',path.join(root,'bank-config.json')]});}
async function api(method,route,body,status=200,token=clerk??admin,headers={}){
 const response=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const data=response.status===204?null:await response.json();
 assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);checks++;
 return {status:response.status,data};
}
const payments=async id=>(await api('GET',`/api/BookingOperations/${id}/payments`)).data;
const details=async id=>(await api('GET','/api/BankTransfers/'+id)).data;
const manual=(bookingId,reference,amount=25000,status=200,extra={})=>api('POST',`/api/BookingOperations/${bookingId}/payments`,{requestId:randomUUID(),type:'Deposit',method:'Transfer',amount,reference,...extra},status);
const receipt=(bookingId,referenceCode,amount=25000,extra={})=>({id:++receiptId,accountNumber:bank.accountNumber,transferType:'in',transferAmount:amount,content:bookingId?'ANNHIEN '+bookingId:'Khong co ma',referenceCode,gateway:'MBBank',...extra});
const deliver=(body,status=200)=>api('POST','/api/BookingOperations/sepay-webhook',body,status,null,{Authorization:'Apikey '+secret});
const match=(id,bookingId,extra={},status=200)=>api('POST',`/api/BankTransfers/${id}/match`,{bookingId,note:'Đã đối chiếu chứng từ gốc trên ngân hàng.',...extra},status);
const configure=(value=bank)=>api('POST','/api/BookingOperations/bank-config',value,200,admin);
try{
 await start();admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).data.token;
 const user=(await api('POST','/api/Users',{username:'transferclerk',password:'Fixture-clerk-123!',fullName:'Lễ tân thử đối soát',role:'Receptionist'},201,admin)).data;
 clerk=(await api('POST','/api/Auth/login',{username:user.username,password:'Fixture-clerk-123!'},200,null)).data.token;
 const customer=(await api('POST','/api/Customers',{fullName:'Transfer dedup fixture'},201)).data;
 const type=(await api('POST','/api/RoomTypes',{name:'Transfer dedup fixture'},201,admin)).data;
 const today=(await api('GET','/api/HotelConfiguration')).data.today;
 const day=n=>{const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10)};
 async function booking(price=500000){const room=(await api('POST','/api/Rooms',{roomNumber:'TD'+(++roomIndex),roomTypeId:type.id,price,capacity:2},201,admin)).data;return (await api('POST','/api/Bookings',{customerId:customer.id,roomId:room.id,guestCount:1,checkInDate:day(1),checkOutDate:day(2)},201)).data;}
 const first=await booking();await manual(first.id,'UNCONFIGURED',25000,503);assert.equal((await payments(first.id)).balance.paid,0);
 await configure();
 const op=randomUUID(),original=await manual(first.id,'  late-reference  ',25000,200,{requestId:op});
 assert.equal((await manual(first.id,'  late-reference  ',25000,200,{requestId:op})).data.id,original.data.id);
 const lateBody=receipt(first.id,'LATE-REFERENCE'),late=(await deliver(lateBody)).data;
 assert.equal(late.status,'Matched');assert.equal((await details(late.transferId)).paymentId,original.data.id);
 assert.equal((await payments(first.id)).balance.paid,25000);assert.equal((await payments(first.id)).items.length,1);
 await deliver(lateBody);assert.equal((await manual(first.id,'late-reference')).data.id,original.data.id);
 await manual(first.id,'late-reference',1,409);const other=await booking();await manual(other.id,'LATE-REFERENCE',25000,409);
 await manual(first.id,'Different payload',25000,409,{requestId:op});
 const changedAmount=(await deliver(receipt(first.id,'late-reference',1))).data;assert.equal(changedAmount.status,'Pending');
 await match(changedAmount.transferId,first.id,{recordAsNew:true},409);
 await match(changedAmount.transferId,first.id,{existingPaymentId:original.data.id},409);
 const secondId=(await deliver(receipt(first.id,'late-reference'))).data;assert.equal(secondId.status,'Pending');
 await match(secondId.transferId,first.id,{existingPaymentId:original.data.id},409);assert.equal((await payments(first.id)).items.length,1);

 const full=await booking(25000),earlyBody=receipt(full.id,'WEBHOOK-FIRST');
 const early=(await deliver(earlyBody)).data;assert.equal(early.status,'Matched');
 const earlyPayment=(await details(early.transferId)).paymentId;
 const adoptedOp=randomUUID();assert.equal((await manual(full.id,'WEBHOOK-FIRST',25000,200,{type:'Payment',requestId:adoptedOp})).data.id,earlyPayment);
 assert.equal((await manual(full.id,'WEBHOOK-FIRST',25000,200,{type:'Payment',requestId:adoptedOp})).data.id,earlyPayment);
 await manual(other.id,'CHANGED-ALIAS-PAYLOAD',25000,409,{requestId:adoptedOp});
 assert.equal((await payments(full.id)).balance.paid,25000);assert.equal((await payments(full.id)).items.length,1);

 const pendingBooking=await booking(),pendingBody=receipt(null,'PENDING-FIRST');
 const pending=(await deliver(pendingBody)).data;assert.equal(pending.status,'Pending');
 const pendingOp=randomUUID(),pendingPayment=(await manual(pendingBooking.id,'PENDING-FIRST',25000,200,{requestId:pendingOp})).data;
 assert.equal((await details(pending.transferId)).paymentId,pendingPayment.id);
 assert.equal((await manual(pendingBooking.id,'PENDING-FIRST',25000,200,{requestId:pendingOp})).data.id,pendingPayment.id);
 await deliver(pendingBody);assert.equal((await payments(pendingBooking.id)).balance.paid,25000);

 const conflictBody=receipt(other.id,'WRONG-BOOKING-HINT'),conflictReceipt=(await deliver(conflictBody)).data;
 await manual(first.id,'WRONG-BOOKING-HINT',25000,409);assert.equal((await payments(first.id)).balance.paid,25000);
 const closed=(await deliver(receipt(null,'CLOSED-REF'))).data;
 await api('POST',`/api/BankTransfers/${closed.transferId}/close`,{note:'Đã xử lý riêng theo chứng từ.'});
 await manual(other.id,'CLOSED-REF',25000,409);

 const duplicateBooking=await booking(),duplicateFirst=(await deliver(receipt(null,'DUPLICATE-PENDING-REF'))).data;
 const duplicateSecond=(await deliver(receipt(null,'DUPLICATE-PENDING-REF'))).data;
 assert.equal((await details(duplicateSecond.transferId)).reason,'DuplicateBankReference');
 await match(duplicateFirst.transferId,duplicateBooking.id,{},409);
 await api('POST',`/api/BankTransfers/${duplicateSecond.transferId}/close`,{note:'Đã xác nhận đây là bản gửi trùng của giao dịch trước.'});
 await match(duplicateFirst.transferId,duplicateBooking.id);assert.equal((await payments(duplicateBooking.id)).balance.paid,25000);

 const distinct=await booking();await manual(distinct.id,'DISTINCT-A');await deliver(receipt(distinct.id,'DISTINCT-B'));
 assert.equal((await payments(distinct.id)).balance.paid,50000);assert.equal((await payments(distinct.id)).items.length,2);

 for(let i=0;i<12;i++){
  const b=await booking(),ref='RACE-'+i,body=receipt(b.id,ref);
  await Promise.all([manual(b.id,ref,25000,[200,409]),deliver(body,[200,409])]);
  await manual(b.id,ref);await deliver(body);
  assert.equal((await payments(b.id)).balance.paid,25000);assert.equal((await payments(b.id)).items.length,1);
 }
 const staffRace=await booking();await Promise.all(Array.from({length:8},()=>manual(staffRace.id,'STAFF-RACE',25000,[200,409])));
 await manual(staffRace.id,'STAFF-RACE');assert.equal((await payments(staffRace.id)).items.length,1);
 await start();assert.equal((await manual(first.id,'LATE-REFERENCE')).data.id,original.data.id);await deliver(lateBody);
 assert.equal((await payments(first.id)).balance.paid,25000);

 const scopedA=await booking(),scopedB=await booking(),scopedC=await booking();
 await manual(scopedA.id,'SHARED-REF');
 const account2={...bank,accountNumber:'0000000000002'};await configure(account2);
 await manual(scopedB.id,'STALE-ACCOUNT',25000,409,{bankId:bank.bankId,bankAccountNumber:bank.accountNumber});
 await manual(scopedB.id,'SHARED-REF');await deliver(receipt(scopedB.id,'SHARED-REF',25000,{accountNumber:account2.accountNumber}));
 const bank2={...account2,bankId:'VCB',bankName:'Different fixture bank'};await configure(bank2);
 await manual(scopedC.id,'SHARED-REF');await deliver(receipt(scopedC.id,'SHARED-REF',25000,{accountNumber:bank2.accountNumber,gateway:'Vietcombank'}));
 for(const b of [scopedA,scopedB,scopedC])assert.equal((await payments(b.id)).balance.paid,25000);
 await configure();await deliver(receipt(scopedA.id,'SHARED-REF'));

 const refund=await booking(25000),refundPayment=(await manual(refund.id,'REFUND-INCOMING')).data;
 await api('POST',`/api/Bookings/${refund.id}/cancel`);
 await manual(refund.id,'REFUND-INCOMING',25000,200,{type:'Refund'});
 const afterRefund=(await deliver(receipt(refund.id,'REFUND-INCOMING'))).data;
 assert.equal(afterRefund.status,'Matched');assert.equal((await details(afterRefund.transferId)).paymentId,refundPayment.id);
 assert.equal((await payments(refund.id)).balance.paid,0);assert.equal((await payments(refund.id)).items.length,2);

 // Real preceding-schema upgrade, not just newly created rows: leave older money untouched.
 const legacy=await booking(25000),legacyPayment=(await manual(legacy.id,'Older free-form note')).data;
 const independent=await booking(),oldIndependent=(await manual(independent.id,'Older separate deposit')).data;
 await stop();const sql=new DatabaseSync(database);try{
  const duplicateKey=sql.prepare('SELECT BankReferenceKey FROM BookingPayments WHERE Id=?').get(legacyPayment.id).BankReferenceKey;
  assert.throws(()=>sql.prepare('INSERT INTO BookingPayments (BookingId,RequestId,Type,Method,Amount,Reference,RecordedBy,CreatedAt,BankReferenceKey) VALUES (?,?,?,?,?,?,?,?,?)').run(legacy.id,randomUUID(),'Deposit','Transfer',2500000,'duplicate','fixture',today,duplicateKey),/UNIQUE/);checks++;
  sql.exec('DROP TABLE BankPaymentOperations; DROP INDEX IX_BankTransfers_BankReferenceKey; DROP INDEX IX_BookingPayments_BankReferenceKey; ALTER TABLE BankTransfers DROP COLUMN BankReferenceKey; ALTER TABLE BookingPayments DROP COLUMN BankReferenceKey');
  sql.prepare('DELETE FROM __EFMigrationsHistory WHERE MigrationId LIKE ?').run('%AddBankPaymentReferenceIdentity');
  sql.prepare('DELETE FROM __EFMigrationsHistory WHERE MigrationId LIKE ?').run('%AddBankPaymentOperations');
 }finally{sql.close();}
 await start();assert.equal((await payments(legacy.id)).balance.paid,25000);
 const legacyReceipt=(await deliver(receipt(legacy.id,'LEGACY-EXACT-REF'))).data;
 assert.equal(legacyReceipt.status,'Pending');assert.equal((await details(legacyReceipt.transferId)).reason,'PossibleExistingPayment');
 await match(legacyReceipt.transferId,legacy.id,{},409);
 await match(legacyReceipt.transferId,legacy.id,{existingPaymentId:oldIndependent.id},409);
 await match(legacyReceipt.transferId,legacy.id,{existingPaymentId:legacyPayment.id,recordAsNew:true},400);
 await match(legacyReceipt.transferId,legacy.id,{existingPaymentId:legacyPayment.id});
 await match(legacyReceipt.transferId,legacy.id,{existingPaymentId:legacyPayment.id});
 assert.equal((await payments(legacy.id)).balance.paid,25000);assert.equal((await payments(legacy.id)).items.length,1);
 const independentReceipt=(await deliver(receipt(independent.id,'NEW-DISTINCT-BANK-REF'))).data;
 assert.equal(independentReceipt.status,'Pending');await match(independentReceipt.transferId,independent.id,{},409);
 await match(independentReceipt.transferId,independent.id,{recordAsNew:true});
 assert.equal((await payments(independent.id)).balance.paid,50000);

 const missing=await booking(),manualMissing=(await manual(missing.id,'NO-WEBHOOK-REF')).data;
 const missingReceipt=(await deliver(receipt(missing.id,null))).data;assert.equal(missingReceipt.status,'Pending');
 await match(missingReceipt.transferId,missing.id,{},409);await match(missingReceipt.transferId,missing.id,{existingPaymentId:manualMissing.id});
 assert.equal((await payments(missing.id)).balance.paid,25000);
 console.log(`PASS: ${checks} transfer-dedup API/schema checks: manual/webhook in both orders, exact reference normalization, full payment, durable retries, conflicting amount/booking, pending/closed receipts, distinct receipts, concurrent requests, bank/account scoping, refunds and legacy upgrade/reconciliation.`);

 if(process.env.HOTEL_TRANSFER_DEDUP_UI==='1'){
  const require=createRequire(import.meta.url),module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';
  const {chromium}=require(module),{expect}=require(module+'/test');
  const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  try{
   const ui=await booking(25000),uiPayment=(await manual(ui.id,'UI-LEGACY-REF')).data;
   await stop();const sql=new DatabaseSync(database);try{sql.prepare('UPDATE BookingPayments SET BankReferenceKey=NULL WHERE Id=?').run(uiPayment.id);}finally{sql.close();}await start();
   const uiReceipt=(await deliver(receipt(ui.id,'UI-LEGACY-REF'))).data;assert.equal(uiReceipt.status,'Pending');
   const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient'));
   await page.goto(base);await page.locator('#username').fill('transferclerk');await page.locator('#password').fill('Fixture-clerk-123!');await page.locator('#login-form [type="submit"]').click();await expect(page.locator('.dashboard-head')).toBeVisible();
   await page.locator('[data-view="reconciliation"]').click();await page.locator('#filter-form [name="keyword"]').fill('UI-LEGACY-REF');await page.locator('#filter-form [type="submit"]').click();
   await page.locator('[data-act="transfer-match"]').click();await page.locator('#f-bookingId').fill(String(ui.id));await page.getByRole('button',{name:'Kiểm tra booking',exact:true}).click();
   await expect(page.locator('#f-existingPaymentId option')).toHaveCount(2);await expect(page.locator('#transfer-booking-preview')).toContainText('Còn phải thu');
   await page.locator('#f-existingPaymentId').selectOption(String(uiPayment.id));await page.locator('#f-note').fill('Đã kiểm tra khoản lễ tân thu đủ trước khi webhook đến.');
   await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('dialog')).not.toBeVisible();
   assert.equal((await details(uiReceipt.transferId)).paymentId,uiPayment.id);assert.equal((await payments(ui.id)).items.length,1);
   const uiNew=await booking();await page.evaluate(id=>action('booking-pay',id),uiNew.id);
   await page.locator('#f-type').selectOption('Deposit');await page.locator('#f-method').selectOption('Transfer');await page.locator('#f-amount').fill('25000');await page.locator('#f-reference').fill('UI-NEW-REF');
   await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('dialog')).not.toBeVisible();
   await deliver(receipt(uiNew.id,'UI-NEW-REF'));assert.equal((await payments(uiNew.id)).balance.paid,25000);assert.equal((await payments(uiNew.id)).items.length,1);assert.deepEqual(errors,[]);
   console.log('PASS: Edge clerk links a fully paid legacy receipt without increasing money; a manual transfer from the payment form is not re-credited by a late webhook. No external provider was contacted.');
  }finally{await browser.close();}
 }
}finally{
 await stop();const resolved=path.resolve(root);
 if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('hotel-transfer-dedup-'))throw new Error('Unsafe temporary cleanup path');
 await rm(resolved,{recursive:true,force:true});console.log('Temporary transfer-dedup data removed. Live bank/SMTP/database and Visual Studio session were not used.');
}

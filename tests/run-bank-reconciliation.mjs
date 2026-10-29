import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {once} from 'node:events';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=await mkdtemp(path.join(tmpdir(),'hotel-reconciliation-'));
const database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(resolve=>socket.close(resolve));
let server,admin,clerk,guest,checks=0,roomIndex=0;
const key='isolated-reconciliation-webhook-key';
const bank={bankId:'MB',bankName:'Fixture bank',accountNumber:'0000000000001',accountName:'FIXTURE ONLY',sepayApiKey:key};
const webhookPath='/api/BookingOperations/sepay-webhook';
async function stop(){if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}server=null;}
async function start(){await stop();server=await startTestServer({project,root,database,base,environment:'Production',extraArgs:['--Storage:DataDirectory',root,'--Payments:BankConfigFile',path.join(root,'bank-config.json')]});}
async function api(method,route,body,status=200,token=admin,headers={}){
 const response=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${method} ${route}: expected ${status}, got ${response.status}`);checks++;
 return {status:response.status,data:response.status===204?null:await response.json()};
}
const receive=(body,status=200)=>api('POST',webhookPath,body,status,null,{Authorization:'Apikey '+key});
const payload=(id,amount=10,content='Chuyen tien khong co ma')=>({id,transferType:'in',accountNumber:bank.accountNumber,transferAmount:amount,content,referenceCode:'REF-'+id,gateway:'MBBank',transactionDate:'2026-10-28 10:00:00'});
const list=async(query='',token=clerk)=>(await api('GET','/api/BankTransfers'+query,undefined,200,token)).data;
const detail=async(id)=>(await api('GET','/api/BankTransfers/'+id,undefined,200,clerk)).data;
const payments=async(id)=>(await api('GET',`/api/BookingOperations/${id}/payments`,undefined,200,clerk)).data;
const match=(id,bookingId,status=200)=>api('POST',`/api/BankTransfers/${id}/match`,{bookingId,note:'Đã xác nhận người chuyển và đúng đặt phòng.'},status,clerk);
try{
 await start();admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).data.token;
 const user=(await api('POST','/api/Users',{username:'reconcileclerk',password:'Fixture-clerk-123!',fullName:'Lễ tân đối soát',role:'Receptionist'},201)).data;
 clerk=(await api('POST','/api/Auth/login',{username:user.username,password:'Fixture-clerk-123!'},200,null)).data.token;
 guest=(await api('POST','/api/CustomerAuth/register',{username:'reconcileguest',password:'Fixture-guest-123!',fullName:'Khách đối soát',phone:'0901234567',email:'reconcile@example.test'},201,null)).data;
 const type=(await api('POST','/api/RoomTypes',{name:'Reconciliation fixture'},201)).data;
 const today=(await api('GET','/api/HotelConfiguration')).data.today;
 const day=n=>{const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10)};
 async function booking(price=100){const room=(await api('POST','/api/Rooms',{roomNumber:'RC'+(++roomIndex),roomTypeId:type.id,price,capacity:2},201)).data;return (await api('POST','/api/Bookings',{customerId:guest.account.customerId,roomId:room.id,guestCount:1,checkInDate:day(1),checkOutDate:day(2)},201)).data;}
 await api('POST','/api/BookingOperations/bank-config',bank);
 for(const [method,route,body] of [['GET','/api/BankTransfers'],['GET','/api/BankTransfers/1'],['POST','/api/BankTransfers/1/match',{bookingId:1,note:'fixture'}],['POST','/api/BankTransfers/1/close',{note:'fixture'}]]){
  await api(method,route,body,401,null);await api(method,route,body,403,guest.token);
 }
 const seed=payload(1001,10.5,'<img src=x onerror=alert(1)> Chuyen tien');
 await api('POST',webhookPath,seed,401,null);
 await api('POST',webhookPath,seed,401,null,{Authorization:'Apikey wrong'});
 await receive({...seed,accountNumber:'wrong'},400);
 await receive({...seed,transferType:'invalid'},400);
 await receive({...seed,transferType:'out'});
 assert.equal((await list()).totalCount,0);
 const result=(await receive(seed)).data;assert.equal(result.status,'Pending');
 const pendingId=result.transferId;
 const pending=await detail(pendingId);assert.equal(pending.reason,'MissingBookingCode');assert.equal(pending.amount,10.5);assert.equal(pending.bookingId,null);assert.equal(pending.paymentId,null);assert.equal(pending.fingerprint,undefined);assert.ok(!JSON.stringify(pending).includes(key));
 assert.equal((await receive(seed)).data.transferId,pendingId);
 // Numerically equal JSON decimals with different scales are the same receipt.
 const raw=await fetch(base+webhookPath,{method:'POST',headers:{'content-type':'application/json',Authorization:'Apikey '+key},body:JSON.stringify(seed).replace('"transferAmount":10.5','"transferAmount":10.50')});assert.equal(raw.status,200);checks++;
 await receive({...seed,transferAmount:11},409);await receive({...seed,content:'Changed content'},409);assert.deepEqual(await detail(pendingId),pending);
 assert.equal((await list()).totalCount,1);
 await start();assert.deepEqual(await detail(pendingId),pending);
 const normal=await booking(100),other=await booking(100),cancelled=await booking(100);
 await api('POST',`/api/Bookings/${cancelled.id}/cancel`);
 const unknown=(await receive(payload(1002,10,'ANNHIEN 2147483647'))).data;
 assert.equal((await detail(unknown.transferId)).reason,'BookingNotFound');
 const overpaid=(await receive(payload(1003,110,'ANNHIEN '+normal.id))).data;assert.equal(overpaid.status,'Pending');assert.equal((await detail(overpaid.transferId)).reason,'AmountExceedsDue');
 const onCancelled=(await receive(payload(1004,10,'ANNHIEN '+cancelled.id))).data;assert.equal((await detail(onCancelled.transferId)).reason,'BookingCancelled');
 assert.equal((await payments(normal.id)).balance.paid,0);
 await api('POST',`/api/BankTransfers/${pendingId}/match`,{bookingId:normal.id,note:' '},400,clerk);
 await match(pendingId,2147483647,409);await match(pendingId,cancelled.id,409);await match(overpaid.transferId,normal.id,409);
 await match(pendingId,normal.id);await match(pendingId,normal.id);await match(pendingId,other.id,409);
 assert.equal((await payments(normal.id)).balance.paid,10.5);assert.equal((await payments(normal.id)).items.length,1);
 const matched=await detail(pendingId);assert.equal(matched.status,'Matched');assert.equal(matched.resolvedBy,'reconcileclerk');assert.equal(matched.bookingId,normal.id);assert.ok(matched.paymentId);assert.match(matched.resolutionNote,/xác nhận/);
 assert.equal((await receive(seed)).data.status,'Matched');assert.equal((await payments(normal.id)).items.length,1);
 await api('POST',`/api/BankTransfers/${pendingId}/close`,{note:'Cannot close matched'},409,clerk);
 await api('POST',`/api/BankTransfers/${overpaid.transferId}/close`,{note:''},400,clerk);
 await api('POST',`/api/BankTransfers/${overpaid.transferId}/close`,{note:'Khách đã được hoàn tiền riêng theo chứng từ thử.'},200,clerk);
 await match(overpaid.transferId,normal.id,409);assert.equal((await receive(payload(1003,110,'ANNHIEN '+normal.id))).data.status,'Closed');
 assert.equal((await payments(normal.id)).balance.paid,10.5);
 const paidBooking=await booking(20);
 const auto=(await receive(payload(1005,20,'ANNHIEN '+paidBooking.id))).data;assert.equal(auto.status,'Matched');assert.equal((await payments(paidBooking.id)).balance.paid,20);
 const settled=(await receive(payload(1006,1,'ANNHIEN '+paidBooking.id))).data;assert.equal((await detail(settled.transferId)).reason,'BookingSettled');
 await match(unknown.transferId,paidBooking.id,409);
 for(const query of ['?status=Wrong','?pageNumber=0','?pageSize=101','?keyword='+'x'.repeat(201)])await api('GET','/api/BankTransfers'+query,undefined,400,clerk);
 assert.equal((await list('?keyword=REF-1001')).totalCount,1);assert.equal((await list('?status=Closed')).items[0].id,overpaid.transferId);
 const paged=await list('?pageSize=2&pageNumber=2');assert.equal(paged.items.length,2);assert.ok(paged.totalPages>=3);
 assert.equal((await list('?pageNumber=2147483647')).items.length,0);
 const duplicateBody=payload(1100,12);
 const duplicates=await Promise.all(Array.from({length:12},()=>receive(duplicateBody,[200,409])));
 assert.ok(duplicates.some(x=>x.status===200));assert.equal((await list('?keyword=REF-1100')).totalCount,1);
 const raceId=(await list('?keyword=REF-1100')).items[0].id;
 const matchRace=await Promise.all([match(raceId,normal.id,[200,409]),match(raceId,other.id,[200,409])]);assert.equal(matchRace.filter(x=>x.status===200).length,1);
 const receiptRaceBody=payload(1101,3);const receiptRace=(await receive(receiptRaceBody)).data;
 await Promise.all([receive(receiptRaceBody,[200,409]),match(receiptRace.transferId,other.id,[200,409])]);
 await match(receiptRace.transferId,other.id);assert.equal((await detail(receiptRace.transferId)).status,'Matched');
 const capacity=await booking(100);
 const left=(await receive(payload(1102,60))).data,right=(await receive(payload(1103,60))).data;
 const capacityRace=await Promise.all([match(left.transferId,capacity.id,[200,409]),match(right.transferId,capacity.id,[200,409])]);assert.equal(capacityRace.filter(x=>x.status===200).length,1);assert.equal((await payments(capacity.id)).balance.paid,60);
 const closing=(await receive(payload(1104,2))).data;
 const beforeClosing=await payments(other.id);
 const closeRace=await Promise.all([match(closing.transferId,other.id,[200,409]),api('POST',`/api/BankTransfers/${closing.transferId}/close`,{note:'Đã xử lý riêng theo chứng từ.'},[200,409],clerk)]);
 assert.equal(closeRace.filter(x=>x.status===200).length,1);
 const closedOrMatched=await detail(closing.transferId),afterClosing=await payments(other.id);
 assert.equal(afterClosing.balance.paid,beforeClosing.balance.paid+(closedOrMatched.status==='Matched'?2:0));
 // Upgrade from the preceding schema: keep bookings/payments and rebuild only the new inbox.
 await stop();
 const sql=new DatabaseSync(database);try{
  sql.exec('DROP TABLE BankPaymentOperations; DROP TABLE BankTransfers; DROP INDEX IX_BookingPayments_BankReferenceKey; ALTER TABLE BookingPayments DROP COLUMN BankReferenceKey');
  sql.prepare('DELETE FROM __EFMigrationsHistory WHERE MigrationId LIKE ? OR MigrationId LIKE ?').run('%AddBankTransferReconciliation','%AddBankPaymentReferenceIdentity');
  sql.prepare('DELETE FROM __EFMigrationsHistory WHERE MigrationId LIKE ?').run('%AddBankPaymentOperations');
  sql.prepare('INSERT INTO BookingPayments (BookingId,RequestId,Type,Method,Amount,Reference,RecordedBy,CreatedAt) VALUES (?,?,?,?,?,?,?,?)').run(other.id,'sepay-1200','Deposit','Transfer',700,'Legacy fixture','Legacy fixture',today+' 12:00:00');
 }finally{sql.close();}
 await start();
 const beforeLegacy=await payments(other.id);
 const legacy=(await receive(payload(1200,7,'ANNHIEN '+other.id))).data;assert.equal(legacy.status,'Matched');
 assert.equal((await payments(other.id)).balance.paid,beforeLegacy.balance.paid);assert.equal((await payments(other.id)).items.length,beforeLegacy.items.length);
 const audit=(await api('GET','/api/Administration/audit?pageSize=100')).data.items;
 assert.ok(audit.some(x=>x.entity==='BankTransfer'&&x.summary.includes('BookingId')));
 console.log(`PASS: ${checks} reconciliation API checks: durable receipts, permissions, filtering/paging, manual matching, rejected overpayment/cancelled/settled booking, closure, duplicate payload conflicts, restart, concurrent delivery/allocation and legacy migration without double-credit.`);

 if(process.env.HOTEL_RECONCILIATION_UI==='1'){
  const require=createRequire(import.meta.url),module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';
  const {chromium}=require(module),{expect}=require(module+'/test');
  const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  try{
   const uiBody=payload(1300,8,'<img src=x onerror=alert(1)> UI unmatched');const ui=(await receive(uiBody)).data;
   const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));let dialogs=0;page.on('dialog',dialog=>{dialogs++;dialog.dismiss();});
   await page.goto(base);await page.locator('#username').fill('reconcileclerk');await page.locator('#password').fill('Fixture-clerk-123!');await page.locator('#login-form [type="submit"]').click();await expect(page.locator('.dashboard-head')).toBeVisible();
   await page.locator('[data-view="reconciliation"]').click();await expect(page.locator('[data-act="transfer-match"]')).toHaveCount(1);
   if(process.env.HOTEL_RECONCILIATION_SCREENSHOT)await page.screenshot({path:process.env.HOTEL_RECONCILIATION_SCREENSHOT,fullPage:true});
   assert.equal(await page.locator('#main img[src="x"]').count(),0);assert.equal(dialogs,0);
   await page.locator('[data-act="transfer-detail"]').click();await expect(page.locator('dialog')).toContainText('UI unmatched');await page.locator('#transfer-detail-close').click();
   await page.locator('[data-act="transfer-match"]').click();await page.locator('#f-bookingId').fill(String(normal.id));await page.locator('#f-note').fill('Khách xác nhận đúng nội dung qua kênh hỗ trợ.');
   await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('#modal-error')).toContainText('Kiểm tra booking');
   await page.getByRole('button',{name:'Kiểm tra booking',exact:true}).click();await expect(page.locator('#transfer-booking-preview')).toContainText('Khách đối soát');
   await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('dialog')).not.toBeVisible();assert.equal((await detail(ui.transferId)).status,'Matched');
   await page.locator('#filter-form select[name="status"]').selectOption('Matched');await page.locator('#filter-form [type="submit"]').click();await expect(page.locator('#main')).toContainText('Đã gắn booking');
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Page overflow at ${width}px`);}
   const closeUi=(await receive(payload(1301,2))).data;
   await page.locator('#filter-form select[name="status"]').selectOption('Pending');await page.locator('#filter-form [type="submit"]').click();await page.locator('[data-act="transfer-close"]').click();await page.locator('#f-note').fill('Đã xử lý riêng và lưu chứng từ tại quầy.');await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('dialog')).not.toBeVisible();assert.equal((await detail(closeUi.transferId)).status,'Closed');
   assert.deepEqual(errors,[]);console.log('PASS: Edge clerk inbox, escaped transfer text, details, booking preview required, allocation, status filter, closure and responsive table.');
  }finally{await browser.close();}
 }
}finally{
 await stop();
 if(path.dirname(path.resolve(root))!==path.resolve(tmpdir())||!path.basename(root).startsWith('hotel-reconciliation-'))throw new Error('Unsafe cleanup path');
 await rm(root,{recursive:true,force:true});console.log('Temporary reconciliation data removed; live database, bank and SMTP were not used.');
}

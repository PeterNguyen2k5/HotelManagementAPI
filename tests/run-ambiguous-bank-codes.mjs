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
const root=await mkdtemp(path.join(tmpdir(),'hotel-ambiguous-codes-')),database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(resolve=>socket.close(resolve));
let server,admin,clerk,checks=0,roomIndex=0,receiptId=80000;
const key='isolated-ambiguous-code-key';
const bank={bankId:'MB',bankName:'Fixture bank',accountNumber:'0000000000001',accountName:'FIXTURE ONLY',sepayApiKey:key};
async function stop(){if(server&&server.exitCode===null){const done=once(server,'exit');server.kill();await done;}server=null;}
async function start(){await stop();server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root,'--Payments:BankConfigFile',path.join(root,'bank-config.json')]});}
async function api(method,route,body,status=200,token=clerk??admin,headers={}){
 const response=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const data=response.status===204?null:await response.json();
 assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);checks++;
 return {status:response.status,data};
}
const receipt=fields=>({id:++receiptId,gateway:'MBBank',transferType:'in',accountNumber:bank.accountNumber,transferAmount:123,referenceCode:'AMB-REF-'+receiptId,...fields});
const deliver=(body,status=200)=>api('POST','/api/BookingOperations/sepay-webhook',body,status,null,{Authorization:'Apikey '+key});
const details=async id=>(await api('GET','/api/BankTransfers/'+id)).data;
const payments=async id=>(await api('GET',`/api/BookingOperations/${id}/payments`)).data;
const match=(id,bookingId,extra={})=>api('POST',`/api/BankTransfers/${id}/match`,{bookingId,note:'Đã kiểm tra chứng từ và xác nhận booking đúng với người chuyển.',...extra});
const manual=(bookingId,reference,status=200)=>api('POST',`/api/BookingOperations/${bookingId}/payments`,{requestId:randomUUID(),method:'Transfer',type:'Deposit',amount:123,reference},status);
try{
 await start();admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).data.token;
 const user=(await api('POST','/api/Users',{username:'ambiguousclerk',password:'Fixture-clerk-123!',fullName:'Lễ tân thử nội dung nhiều mã',role:'Receptionist'},201,admin)).data;
 clerk=(await api('POST','/api/Auth/login',{username:user.username,password:'Fixture-clerk-123!'},200,null)).data.token;
 const customer=(await api('POST','/api/Customers',{fullName:'Khách thử nhiều mã booking'},201)).data;
 const type=(await api('POST','/api/RoomTypes',{name:'Ambiguous code fixture'},201,admin)).data;
 const today=(await api('GET','/api/HotelConfiguration')).data.today;
 const day=n=>{const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10)};
 async function booking(){const room=(await api('POST','/api/Rooms',{roomNumber:'AM'+(++roomIndex),roomTypeId:type.id,price:500000,capacity:2},201,admin)).data;return (await api('POST','/api/Bookings',{customerId:customer.id,roomId:room.id,guestCount:1,checkInDate:day(1),checkOutDate:day(2)},201)).data;}
 await api('POST','/api/BookingOperations/bank-config',bank,200,admin);
 const a=await booking(),b=await booking();
 const cases=[
  ['two codes in content',{content:`ANNHIEN ${a.id}; ANNHIEN ${b.id}`}],
  ['reversed order',{content:`ANNHIEN ${b.id}; ANNHIEN ${a.id}`}],
  ['two codes in description',{description:`BOOKING #${a.id}; HD #${b.id}`}],
  ['two codes in code',{code:`ANNHIEN${a.id};BOOKING${b.id}`}],
  ['content/description disagree',{content:`ANNHIEN ${a.id}`,description:`ANNHIEN ${b.id}`}],
  ['content/code disagree',{content:`ANNHIEN ${a.id}`,code:`HD${b.id}`}],
  ['description/code disagree',{description:`AN NHIEN ${a.id}`,code:`booking #${b.id}`}],
  ['duplicates plus other ID',{content:`HD${a.id} HD${a.id}`,description:`BOOKING${b.id}`,code:`ANNHIEN${a.id}`}],
  ['unknown ID still conflicts',{content:`ANNHIEN ${a.id}; ANNHIEN 2147483647`}],
  ['padded but distinct IDs',{content:`ANNHIEN 000${a.id};HD 000${b.id}`}],
 ];
 let originalBody,originalTransfer;
 for(const [name,fields] of cases){
  const beforeA=await payments(a.id),beforeB=await payments(b.id),body=receipt(fields),result=(await deliver(body)).data;
  assert.equal(result.status,'Pending',name);assert.equal(result.bookingId,null,name);
  const detail=await details(result.transferId);assert.equal(detail.reason,'AmbiguousBookingCode',name);assert.equal(detail.suggestedBookingId,null,name);assert.equal(detail.paymentId,null,name);assert.match(detail.reasonText,/nhiều mã booking/);
  assert.deepEqual(await payments(a.id),beforeA,name);assert.deepEqual(await payments(b.id),beforeB,name);
  assert.equal((await deliver(body)).data.transferId,result.transferId,name);
  if(!originalBody){originalBody=body;originalTransfer=result;}
 }
 for(const fields of [
  {content:`ANNHIEN ${a.id};ANNHIEN ${a.id}`},
  {content:`annhien${a.id}`,description:`AN NHIEN #000${a.id}`,code:`booking #${a.id}`},
  {code:`HD#${a.id}`},{description:`BOOKING${a.id}`},{content:`AN NHIEN ${a.id}`},
  {content:`ANNHIEN ${'0'.repeat(100)}${a.id}`}
 ]){
  const before=await payments(a.id),body=receipt(fields),result=(await deliver(body)).data;
  assert.equal(result.status,'Matched');assert.equal(result.bookingId,a.id);assert.equal((await payments(a.id)).balance.paid,before.balance.paid+123);
  await deliver(body);assert.equal((await payments(a.id)).items.length,before.items.length+1);
 }
 for(const [fields,reason] of [
  [{content:'ANNHIEN',description:String(a.id)},'MissingBookingCode'],
  [{content:`ANNHIEN ${a.id};ANNHIEN 2147483648`},'InvalidBookingCode'],
  [{content:`ANNHIEN ${a.id};HD 0`},'InvalidBookingCode'],
  [{content:'ANNHIEN 99999999999999999999999999999999999'},'InvalidBookingCode']
 ]){
  const before=await payments(a.id),result=(await deliver(receipt(fields))).data;
  assert.equal(result.status,'Pending');assert.equal((await details(result.transferId)).reason,reason);assert.deepEqual(await payments(a.id),before);
 }
 const beforeManual=await payments(a.id);await manual(a.id,originalBody.referenceCode,409);assert.deepEqual(await payments(a.id),beforeManual);
 await start();assert.equal((await deliver(originalBody)).data.status,'Pending');assert.equal((await details(originalTransfer.transferId)).suggestedBookingId,null);
 const concurrentBody=receipt({content:`ANNHIEN ${a.id};HD${b.id}`});
 const concurrent=await Promise.all(Array.from({length:12},()=>deliver(concurrentBody,[200,409])));assert.ok(concurrent.some(x=>x.status===200));
 const found=(await api('GET','/api/BankTransfers?keyword='+concurrentBody.referenceCode)).data;assert.equal(found.totalCount,1);assert.equal(found.items[0].status,'Pending');
 const beforeChosen=await payments(b.id);await match(found.items[0].id,b.id);await match(found.items[0].id,b.id);await deliver(concurrentBody);
 assert.equal((await payments(b.id)).balance.paid,beforeChosen.balance.paid+123);assert.equal((await payments(b.id)).items.length,beforeChosen.items.length+1);

 const paid=await booking(),paidBody=receipt({content:`ANNHIEN ${paid.id};HD${b.id}`});
 const paidPayment=(await manual(paid.id,paidBody.referenceCode)).data;
 const paidReceipt=(await deliver(paidBody)).data;assert.equal(paidReceipt.status,'Pending');assert.equal((await details(paidReceipt.transferId)).paymentId,null);
 await match(paidReceipt.transferId,paid.id);assert.equal((await details(paidReceipt.transferId)).paymentId,paidPayment.id);assert.equal((await payments(paid.id)).balance.paid,123);
 const legacy=await booking(),legacyBody=receipt({content:`ANNHIEN ${legacy.id};ANNHIEN ${b.id}`});
 const legacyPayment=(await manual(legacy.id,legacyBody.referenceCode)).data;
 await stop();const sql=new DatabaseSync(database);try{
  sql.prepare('UPDATE BookingPayments SET RequestId=?,BankReferenceKey=NULL WHERE Id=?').run('sepay-'+legacyBody.id,legacyPayment.id);
  sql.prepare('UPDATE BankTransfers SET Reason=?,SuggestedBookingId=? WHERE Id=?').run('BookingNotFound',a.id,originalTransfer.transferId);
 }finally{sql.close();}
 await start();const oldView=await details(originalTransfer.transferId);assert.equal(oldView.reason,'AmbiguousBookingCode');assert.equal(oldView.suggestedBookingId,null);
 await manual(a.id,originalBody.referenceCode,409);await deliver(originalBody);
 const persisted=new DatabaseSync(database);try{const row=persisted.prepare('SELECT Reason,SuggestedBookingId FROM BankTransfers WHERE Id=?').get(originalTransfer.transferId);assert.equal(row.Reason,'AmbiguousBookingCode');assert.equal(row.SuggestedBookingId,null);}finally{persisted.close();}
 const legacyReceipt=(await deliver(legacyBody)).data;assert.equal(legacyReceipt.status,'Pending');assert.equal((await details(legacyReceipt.transferId)).paymentId,null);
 await match(legacyReceipt.transferId,legacy.id,{existingPaymentId:legacyPayment.id});assert.equal((await payments(legacy.id)).balance.paid,123);assert.equal((await payments(legacy.id)).items.length,1);
 console.log(`PASS: ${checks} ambiguous-code API checks: all fields/orderings, repeated aliases and padded IDs, unknown/invalid IDs, field boundaries, durable/repeated/concurrent receipts, staff resolution, manual-payment guard and legacy linkage without extra money.`);

 if(process.env.HOTEL_AMBIGUOUS_CODES_UI==='1'){
  const require=createRequire(import.meta.url),module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';
  const {chromium}=require(module),{expect}=require(module+'/test');
  const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  try{
   const uiA=await booking(),uiB=await booking(),uiBody=receipt({content:`ANNHIEN ${uiA.id}; ANNHIEN ${uiB.id}`,referenceCode:'AMBIGUOUS-UI-REF'});
   const ui=(await deliver(uiBody)).data;
   const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient'));
   await page.goto(base);await page.locator('#username').fill('ambiguousclerk');await page.locator('#password').fill('Fixture-clerk-123!');await page.locator('#login-form [type="submit"]').click();await expect(page.locator('.dashboard-head')).toBeVisible();
   await page.locator('[data-view="reconciliation"]').click();await page.locator('#filter-form [name="keyword"]').fill('AMBIGUOUS-UI-REF');await page.locator('#filter-form [type="submit"]').click();
   await expect(page.locator('#main')).toContainText('Có nhiều mã booking');await expect(page.locator('#main')).not.toContainText('Mã gợi ý #');
   await page.locator('[data-act="transfer-detail"]').click();await expect(page.locator('dialog')).toContainText('Có nhiều mã booking');await page.locator('#transfer-detail-close').click();
   await page.locator('[data-act="transfer-match"]').click();await expect(page.locator('#f-bookingId')).toHaveValue('');
   await page.locator('#f-bookingId').fill(String(uiB.id));await page.locator('#f-note').fill('Đã xác minh khách chuyển đúng booking thứ hai, không chọn mã đầu tiên.');
   await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('#modal-error')).toContainText('Kiểm tra booking');
   await page.getByRole('button',{name:'Kiểm tra booking',exact:true}).click();await expect(page.locator('#transfer-booking-preview')).toContainText('Booking #'+uiB.id);
   await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('dialog')).not.toBeVisible();
   const resolved=await details(ui.transferId);assert.equal(resolved.status,'Matched');assert.equal(resolved.bookingId,uiB.id);assert.equal(resolved.resolvedBy,'ambiguousclerk');
   await deliver(uiBody);assert.equal((await payments(uiA.id)).balance.paid,0);assert.equal((await payments(uiB.id)).balance.paid,123);assert.equal((await payments(uiB.id)).items.length,1);assert.deepEqual(errors,[]);
   console.log('PASS: Edge shows ambiguous-code warning without first-ID suggestion; staff must preview and can choose the second booking, with one credit after webhook retry.');
  }finally{await browser.close();}
 }
}finally{
 await stop();const resolved=path.resolve(root);
 if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('hotel-ambiguous-codes-'))throw new Error('Unsafe temporary cleanup path');
 await rm(resolved,{recursive:true,force:true});console.log('Temporary ambiguous-code server/data removed; live database, SMTP and bank were not used.');
}

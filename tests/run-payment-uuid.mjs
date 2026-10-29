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
const root=await mkdtemp(path.join(tmpdir(),'hotel-payment-uuid-')),database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(resolve=>socket.close(resolve));
let server,admin,clerk,checks=0,roomIndex=0;
const key='isolated-payment-uuid-key';
const bank={bankId:'MB',bankName:'Fixture bank',accountNumber:'0000000000001',accountName:'FIXTURE ONLY',sepayApiKey:key};
async function stop(){if(server&&server.exitCode===null){const done=once(server,'exit');server.kill();await done;}server=null;}
async function start(){await stop();server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root,'--Payments:BankConfigFile',path.join(root,'bank-config.json')]});}
async function api(method,route,body,status=200,token=clerk??admin,headers={}){
 const response=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const data=response.status===204?null:await response.json();
 assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);checks++;
 return {status:response.status,data};
}
const payments=async id=>(await api('GET',`/api/BookingOperations/${id}/payments`)).data;
const pay=(id,body,status=200)=>api('POST',`/api/BookingOperations/${id}/payments`,body,status);
const direct=(id,body,status=200)=>api('POST',`/api/BookingOperations/${id}/customer-payment`,body,status);
const data=(extra={})=>({requestId:randomUUID(),type:'Deposit',method:'Cash',amount:25000,...extra});
const mixed=id=>id.split('').map((c,i)=>i%2?c.toUpperCase():c.toLowerCase()).join('');
function sqlUpdate(action){const sql=new DatabaseSync(database);try{return action(sql);}finally{sql.close();}}
try{
 await start();admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).data.token;
 const user=(await api('POST','/api/Users',{username:'uuidclerk',password:'Fixture-clerk-123!',fullName:'Lễ tân thử UUID',role:'Receptionist'},201,admin)).data;
 clerk=(await api('POST','/api/Auth/login',{username:user.username,password:'Fixture-clerk-123!'},200,null)).data.token;
 const customer=(await api('POST','/api/Customers',{fullName:'Khách thử UUID thanh toán'},201)).data;
 const type=(await api('POST','/api/RoomTypes',{name:'Payment UUID fixture'},201,admin)).data;
 const today=(await api('GET','/api/HotelConfiguration')).data.today;
 const day=n=>{const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10)};
 async function booking(){const room=(await api('POST','/api/Rooms',{roomNumber:'UU'+(++roomIndex),roomTypeId:type.id,price:500000,capacity:2},201,admin)).data;return (await api('POST','/api/Bookings',{customerId:customer.id,roomId:room.id,guestCount:1,checkInDate:day(1),checkOutDate:day(2)},201)).data;}
 await api('POST','/api/BookingOperations/bank-config',bank,200,admin);
 const a=await booking(),other=await booking();
 const original=data({requestId:'abcdefab-1234-4567-89ab-abcdefabcdef'}),first=(await pay(a.id,original)).data;
 for(const requestId of [original.requestId.toUpperCase(),mixed(original.requestId),original.requestId])assert.equal((await pay(a.id,{...original,requestId})).data.id,first.id);
 assert.equal((await payments(a.id)).balance.paid,25000);assert.equal((await payments(a.id)).items.length,1);
 for(const change of [{amount:1},{type:'Payment'},{method:'Transfer',reference:'OTHER-REF'},{reference:'Changed note'}])await pay(a.id,{...original,requestId:original.requestId.toUpperCase(),...change},409);
 await pay(other.id,{...original,requestId:original.requestId.toUpperCase()},409);
 const partial=await booking();await pay(partial.id,data({amount:50000}));await api('POST',`/api/Bookings/${partial.id}/cancel`);
 const partialRefund=data({type:'Refund',method:'Transfer',amount:10000,reference:'UUID-PARTIAL-REFUND'}),partialPayment=(await pay(partial.id,partialRefund)).data;
 assert.equal((await pay(partial.id,{...partialRefund,requestId:partialRefund.requestId.toUpperCase()})).data.id,partialPayment.id);
 assert.equal((await pay(partial.id,{...partialRefund,requestId:mixed(partialRefund.requestId)})).data.id,partialPayment.id);
 assert.equal((await payments(partial.id)).balance.paid,40000);assert.equal((await payments(partial.id)).items.length,2);
 for(const bad of ['not-a-uuid','x'.repeat(36),'abcdefab1234456789ababcdefabcdef'])await pay(a.id,{...original,requestId:bad},400);
 const outgoing=data({type:'Refund'});await api('POST',`/api/Bookings/${a.id}/cancel`);const refunded=(await pay(a.id,outgoing)).data;
 assert.equal((await pay(a.id,{...outgoing,requestId:outgoing.requestId.toUpperCase()})).data.id,refunded.id);
 assert.equal((await payments(a.id)).balance.paid,0);assert.equal((await payments(a.id)).items.length,2);
 const transfer=data({requestId:randomUUID().toUpperCase(),method:'Transfer',reference:'UUID-TRANSFER-REF'}),transferPayment=(await pay(other.id,transfer)).data;
 assert.equal((await pay(other.id,{...transfer,requestId:transfer.requestId.toLowerCase()})).data.id,transferPayment.id);
 assert.equal((await payments(other.id)).items.length,1);
 const directBody={requestId:randomUUID().toUpperCase(),type:'Direct',method:'Cash',amount:0};
 const directPayment=(await direct(other.id,directBody)).data.payment;
 assert.equal((await direct(other.id,{...directBody,requestId:directBody.requestId.toLowerCase()})).data.payment.id,directPayment.id);
 await direct(other.id,{...directBody,reference:'Changed choice'},409);
 await pay(other.id,data({requestId:directBody.requestId.toLowerCase()}),409);
 await direct(other.id,{...directBody,requestId:transfer.requestId.toLowerCase()},409);
 await start();assert.equal((await pay(a.id,{...outgoing,requestId:mixed(outgoing.requestId)})).data.id,refunded.id);
 const stored=sqlUpdate(sql=>sql.prepare('SELECT RequestId FROM BookingPayments WHERE Id IN (?,?,?,?)').all(first.id,refunded.id,transferPayment.id,directPayment.id));
 for(const row of stored)assert.match(row.RequestId,/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

 // The UUID of a manual operation must remain bound when its result was created by a webhook.
 const adopted=await booking();await api('POST','/api/BookingOperations/sepay-webhook',{id:90001,accountNumber:bank.accountNumber,transferType:'in',transferAmount:25000,content:'ANNHIEN '+adopted.id,referenceCode:'UUID-ADOPTED'},200,null,{Authorization:'Apikey '+key});
 const adoptedBody=data({method:'Transfer',reference:'UUID-ADOPTED',requestId:randomUUID().toUpperCase()}),adoptedPayment=(await pay(adopted.id,adoptedBody)).data;
 assert.equal((await pay(adopted.id,{...adoptedBody,requestId:adoptedBody.requestId.toLowerCase()})).data.id,adoptedPayment.id);
 await pay(other.id,{...adoptedBody,requestId:adoptedBody.requestId.toLowerCase(),reference:'DIFFERENT'},409);
 await direct(adopted.id,{...directBody,requestId:adoptedBody.requestId.toLowerCase()},409);

 const race=await booking(),raceBody=data();
 await Promise.all(Array.from({length:16},(_,i)=>pay(race.id,{...raceBody,requestId:i%2?raceBody.requestId.toUpperCase():raceBody.requestId},[200,409])));
 await pay(race.id,raceBody);assert.equal((await payments(race.id)).balance.paid,25000);assert.equal((await payments(race.id)).items.length,1);
 await api('POST',`/api/Bookings/${race.id}/cancel`);const refundRace=data({type:'Refund'});
 await Promise.all(Array.from({length:12},(_,i)=>pay(race.id,{...refundRace,requestId:i%2?refundRace.requestId.toUpperCase():refundRace.requestId},[200,409])));
 await pay(race.id,refundRace);assert.equal((await payments(race.id)).balance.paid,0);assert.equal((await payments(race.id)).items.length,2);

 // Simulate old stored keys without changing any money, then replay after a real restart.
 const legacy=await booking(),legacyBody=data(),legacyPayment=(await pay(legacy.id,legacyBody)).data;
 const legacyN=await booking(),legacyNBody=data(),legacyNPayment=(await pay(legacyN.id,legacyNBody)).data;
 const collision=await booking(),collisionBody=data(),collisionPayment=(await pay(collision.id,collisionBody)).data;
 const aliasCollision=data({method:'Transfer',reference:'UUID-ADOPTED'});await pay(adopted.id,aliasCollision);
 const cross=await booking(),crossBody=data(),crossPayment=(await pay(cross.id,crossBody)).data;
 await stop();sqlUpdate(sql=>{
  sql.prepare('UPDATE BookingPayments SET RequestId=? WHERE Id=?').run(legacyBody.requestId.toUpperCase(),legacyPayment.id);
  sql.prepare('UPDATE BookingPayments SET RequestId=? WHERE Id=?').run('  '+legacyNBody.requestId.replaceAll('-','')+'  ',legacyNPayment.id);
  sql.prepare('UPDATE BankPaymentOperations SET RequestId=? WHERE RequestId=?').run(adoptedBody.requestId.toUpperCase(),adoptedBody.requestId.toLowerCase());
  sql.prepare('INSERT INTO BookingPayments (BookingId,RequestId,Type,Method,Amount,Reference,RecordedBy,CreatedAt) VALUES (?,?,?,?,?,?,?,?)').run(collision.id,collisionBody.requestId.toUpperCase(),'Deposit','Cash',2500000,null,'Legacy duplicate fixture',today);
  const op=sql.prepare('SELECT * FROM BankPaymentOperations WHERE RequestId=?').get(aliasCollision.requestId);
  sql.prepare('INSERT INTO BankPaymentOperations (RequestId,Fingerprint,PaymentId,CreatedAt) VALUES (?,?,?,?)').run(aliasCollision.requestId.toUpperCase(),op.Fingerprint,op.PaymentId,op.CreatedAt);
  sql.prepare('INSERT INTO BankPaymentOperations (RequestId,Fingerprint,PaymentId,CreatedAt) VALUES (?,?,?,?)').run(crossBody.requestId.toUpperCase(),'conflicting-legacy-fingerprint',adoptedPayment.id,today);
 });await start();
 assert.equal((await pay(legacy.id,legacyBody)).data.id,legacyPayment.id);assert.equal((await pay(legacyN.id,legacyNBody)).data.id,legacyNPayment.id);
 assert.equal((await pay(adopted.id,{...adoptedBody,requestId:adoptedBody.requestId.toLowerCase()})).data.id,adoptedPayment.id);
 const beforeCollision=await payments(collision.id);assert.equal(beforeCollision.balance.paid,50000);
 await pay(collision.id,collisionBody,409);await pay(collision.id,{...collisionBody,requestId:collisionBody.requestId.toUpperCase()},409);
 assert.deepEqual(await payments(collision.id),beforeCollision);assert.equal((await payments(collision.id)).items[0].id,collisionPayment.id);
 await pay(adopted.id,aliasCollision,409);await pay(cross.id,crossBody,409);assert.equal((await payments(cross.id)).items[0].id,crossPayment.id);
 assert.equal(sqlUpdate(sql=>sql.prepare('SELECT RequestId FROM BookingPayments WHERE Id=?').get(legacyPayment.id)).RequestId,legacyBody.requestId.toUpperCase());
 console.log(`PASS: ${checks} payment UUID API checks: cash/transfer/refund/direct, uppercase/lowercase/mixed retries, changed-payload and namespace conflicts, concurrent requests, restart, webhook aliases and legacy case/format/collision handling without rewriting money.`);

 if(process.env.HOTEL_PAYMENT_UUID_UI==='1'){
  const require=createRequire(import.meta.url),module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';
  const {chromium}=require(module),{expect}=require(module+'/test');
  const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  try{
   const ui=await booking(),page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));let attempts=0;
   await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient'));
   await page.route(`**/api/BookingOperations/${ui.id}/payments`,async route=>{
    if(route.request().method()!=='POST')return route.continue();
    if(attempts++===0){const body=route.request().postDataJSON();const response=await route.fetch({postData:JSON.stringify({...body,requestId:body.requestId.toUpperCase()})});assert.equal(response.status(),200);return route.abort('failed');}
    return route.continue();
   });
   await page.goto(base);await page.locator('#username').fill('uuidclerk');await page.locator('#password').fill('Fixture-clerk-123!');await page.locator('#login-form [type="submit"]').click();await expect(page.locator('.dashboard-head')).toBeVisible();
   await page.evaluate(id=>action('booking-pay',id),ui.id);await page.locator('#f-type').selectOption('Deposit');await page.locator('#f-method').selectOption('Cash');await page.locator('#f-amount').fill('25000');
   await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('#modal-error')).not.toBeEmpty();assert.equal((await payments(ui.id)).balance.paid,25000);
   await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('dialog')).not.toBeVisible();assert.equal(attempts,2);assert.equal((await payments(ui.id)).balance.paid,25000);assert.equal((await payments(ui.id)).items.length,1);assert.deepEqual(errors,[]);
   console.log('PASS: Edge loses the first committed response with an uppercase UUID; retry from the same form uses lowercase and keeps exactly one 25,000 VND receipt.');
  }finally{await browser.close();}
 }
}finally{
 await stop();const resolved=path.resolve(root);
 if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('hotel-payment-uuid-'))throw new Error('Unsafe temporary cleanup path');
 await rm(resolved,{recursive:true,force:true});console.log('Temporary payment UUID data removed; live database, bank and SMTP were not used.');
}

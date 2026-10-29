import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(import.meta.dirname,'..');
const root=await mkdtemp(path.join(tmpdir(),'hotel-financial-history-')),database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(resolve=>socket.close(resolve));
let server,token,checks=0,roomIndex=0;
async function stop(){if(server&&server.exitCode===null){const done=once(server,'exit');server.kill();await done;}server=null;}
async function start(){await stop();server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root,'--Payments:BankConfigFile',path.join(root,'bank-config.json')]});}
async function api(method,url,body,status=200,auth=token){
 const r=await fetch(base+url,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(auth?{authorization:'Bearer '+auth}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const value=r.status===204?null:await r.json();assert.ok((Array.isArray(status)?status:[status]).includes(r.status),`${method} ${url}: ${r.status} ${JSON.stringify(value)}`);checks++;return value;
}
function sql(action){const db=new DatabaseSync(database);try{return action(db);}finally{db.close();}}
const payments=id=>api('GET',`/api/BookingOperations/${id}/payments`);
const pay=(id,body,status=200)=>api('POST',`/api/BookingOperations/${id}/payments`,body,status);
const bank={bankId:'MB',bankName:'Display name is not a trusted bank alias',accountNumber:'0000000000001',accountName:'FIXTURE ONLY',sepayApiKey:'fixture-financial-history-key'};
let receiptId=910000;
async function receive(body,status=200){const r=await fetch(base+'/api/BookingOperations/sepay-webhook',{method:'POST',headers:{'content-type':'application/json',authorization:'Apikey '+bank.sepayApiKey},body:JSON.stringify(body)});const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));checks++;return value;}
try{
 await start();token=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).token;
 const guest=await api('POST','/api/CustomerAuth/register',{username:'historyguest',password:'Fixture-guest-123!',email:'history@example.test',fullName:'History fixture',phone:'0901234567'},201,null);
 const type=await api('POST','/api/RoomTypes',{name:'Financial history fixture'},201);
 const today=(await api('GET','/api/HotelConfiguration')).today;
 const day=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 async function booking(start=1){const room=await api('POST','/api/Rooms',{roomNumber:'FH'+(++roomIndex),roomTypeId:type.id,price:500000,capacity:2},201);return api('POST','/api/Bookings',{customerId:guest.account.customerId,roomId:room.id,guestCount:1,checkInDate:day(start),checkOutDate:day(start+1)},201);}
 async function refundable(){const b=await booking();await pay(b.id,{requestId:randomUUID(),type:'Deposit',method:'Cash',amount:200000});await api('POST',`/api/Bookings/${b.id}/cancel`);return b;}
 const refund=(reference,extra={})=>({requestId:randomUUID(),type:'Refund',method:'Transfer',amount:25000,reference,...extra});
 await api('POST','/api/BookingOperations/bank-config',bank);
 const a=await booking();
 const payload={id:++receiptId,gateway:'Vietcombank',accountNumber:bank.accountNumber,transferType:'in',transferAmount:25000,content:'ANNHIEN '+a.id,referenceCode:'WRONG-BANK-FIXTURE',transactionDate:today+' 10:00:00'};
 for(const gateway of [undefined,null,'',' ','Vietcombank','Fake MB Bank','MBBank-other',bank.bankName])await receive({...payload,gateway},400);
 await receive({...payload,gateway:'MBBank',accountNumber:'wrong-account'},400);
 assert.equal((await payments(a.id)).balance.paid,0);assert.equal((await api('GET','/api/BankTransfers')).totalCount,0);
 for(const gateway of ['MBBank','mb','970422',' MB Bank ']){
  const valid={...payload,id:++receiptId,gateway,referenceCode:'BANK-VALID-'+receiptId};assert.equal((await receive(valid)).status,'Matched');assert.equal((await receive(valid)).status,'Matched');
 }
 assert.equal((await payments(a.id)).balance.paid,100000);
 assert.equal((await receive({...payload,gateway:'MBBank'})).status,'Matched','Rejected ID must remain usable by a corrected valid event.');
 assert.equal((await payments(a.id)).balance.paid,125000);
 await api('POST','/api/BookingOperations/bank-config',{...bank,bankId:'970422'});
 assert.equal((await receive({...payload,id:++receiptId,gateway:'MBBank',transferType:'out'})).success,true);
 await api('POST','/api/BookingOperations/bank-config',bank);
 console.log('PASS: mismatched/missing/unknown bank gateways cannot consume receipts or credit money; explicit MB/MBBank/BIN aliases and authenticated retries work.');

 const b=await refundable(),request=refund(' SAME-OUTGOING-REF ');
 const first=await pay(b.id,request);assert.equal((await pay(b.id,request)).id,first.id);
 const alias=refund('same-outgoing-ref',{bankId:'970422',bankAccountNumber:' '+bank.accountNumber+' '});
 assert.equal((await pay(b.id,alias)).id,first.id);assert.equal((await pay(b.id,alias)).id,first.id);
 assert.equal((await pay(b.id,refund('SAME-OUTGOING-REF',{bankId:'MBBank'}))).id,first.id);
 await pay(b.id,refund('SAME-OUTGOING-REF',{amount:1}),409);
 const other=await refundable();await pay(other.id,refund('SAME-OUTGOING-REF'),409);
 assert.equal((await payments(b.id)).balance.paid,175000);assert.equal((await payments(b.id)).items.filter(p=>p.type==='Refund').length,1);
 await pay(b.id,refund('SHARED-SCOPE',{bankId:'VCB'}));await pay(b.id,refund('SHARED-SCOPE',{bankId:'MB'}));
 await pay(b.id,refund('SHARED-SCOPE',{bankId:'MB',bankAccountNumber:'0000000000002'}));
 await pay(b.id,refund('INVALID-SOURCE',{bankId:'unknown'}),409);await pay(b.id,refund('INVALID-SOURCE',{bankAccountNumber:' '}),409);
 await pay(b.id,refund('EXCESS',{amount:100001}),409);
 const race=refund('RACE-OUT');await Promise.all(Array.from({length:8},()=>pay(other.id,{...race,requestId:randomUUID()},[200,409])));
 const racePayment=await pay(other.id,race);assert.equal((await payments(other.id)).items.filter(p=>p.reference==='RACE-OUT').length,1);
 const legacy=await pay(other.id,refund('OLD-OUTGOING-REF'));sql(db=>db.prepare('UPDATE BookingPayments SET BankReferenceKey=NULL WHERE Id=?').run(legacy.id));
 await pay(other.id,refund('old-outgoing-ref'),409);assert.equal((await pay(other.id,{requestId:sql(db=>db.prepare('SELECT RequestId FROM BookingPayments WHERE Id=?').get(legacy.id).RequestId),type:'Refund',method:'Transfer',amount:25000,reference:'OLD-OUTGOING-REF'})).id,legacy.id);
 const incoming=await booking();await pay(incoming.id,{requestId:randomUUID(),type:'Deposit',method:'Transfer',amount:25000,reference:'BOTH-DIRECTIONS'});await api('POST',`/api/Bookings/${incoming.id}/cancel`);
 await pay(incoming.id,refund('BOTH-DIRECTIONS'));assert.equal((await payments(incoming.id)).balance.paid,0);
 await start();assert.equal((await pay(b.id,alias)).id,first.id);assert.equal((await pay(other.id,race)).id,racePayment.id);
 console.log('PASS: outgoing bank/account/reference identity, normalization, distinct scopes, payload conflicts, concurrent clerks, UUID aliases, restart, legacy caution and incoming/outgoing separation preserve money.');

 const c=await booking(0);await api('POST',`/api/Bookings/${c.id}/check-in`);
 const service=await api('POST','/api/Services',{name:'Nuoc minibar fixture',unit:'chai',price:25000},201);
 const usageRequest={requestId:randomUUID(),bookingId:c.id,serviceId:service.id,quantity:1};
 const usage=await api('POST','/api/Services/usage',usageRequest,201);
 await api('PUT','/api/Services/'+service.id,{name:'Giat ui fixture',unit:'kg',price:50000});
 const usages=await api('GET',`/api/Services/usage/booking/${c.id}`);assert.equal(usages[0].serviceName,'Nuoc minibar fixture');assert.equal(usages[0].total,25000);
 assert.deepEqual(await api('POST','/api/Services/usage',usageRequest),usage);
 const d=await booking(0);await api('POST',`/api/Bookings/${d.id}/check-in`);
 const newer=await api('POST','/api/Services/usage',{...usageRequest,requestId:randomUUID(),bookingId:d.id},201);assert.equal(newer.serviceName,'Giat ui fixture');assert.equal(newer.total,50000);
 const portal=await api('GET',`/api/CustomerPortal/bookings/${c.id}`,undefined,200,guest.token);assert.equal(portal.services[0].name,'Nuoc minibar fixture');
 await api('POST',`/api/Bookings/${c.id}/check-out`);const invoice=await api('GET',`/api/BookingOperations/${c.id}/invoice`);assert.equal(invoice.detail.services[0].name,'Nuoc minibar fixture');assert.equal(invoice.detail.services[0].total,25000);
 assert.equal((await api('GET',`/api/Reports/popular-services?from=${today}&to=${today}`)).find(x=>x.serviceId===service.id).name,'Nuoc minibar fixture');
 await api('PUT','/api/Services/'+service.id,{name:'New catalog after invoice',unit:'lan',price:75000});assert.deepEqual((await api('GET',`/api/BookingOperations/${c.id}/invoice`)).detail,invoice.detail);
 // Real upgrade: original operation names must win over the subsequently renamed catalog.
 await stop();const before=sql(db=>({count:db.prepare('SELECT COUNT(*) n FROM ServiceUsages').get().n,total:db.prepare('SELECT SUM(Total) n FROM ServiceUsages').get().n}));
 sql(db=>{
  db.exec('ALTER TABLE ServiceUsages DROP COLUMN ServiceName');db.prepare('DELETE FROM __EFMigrationsHistory WHERE MigrationId LIKE ?').run('%PreserveServiceUsageName');
  db.prepare('INSERT INTO ServiceUsages (BookingId,ServiceId,Quantity,UnitPrice,Total,UsedAt) VALUES (?,?,?,?,?,?)').run(d.id,service.id,1,12300,12300,today+' 10:00:00');
 });
 await start();const migrated=await api('GET',`/api/Services/usage/booking/${c.id}`);assert.equal(migrated[0].serviceName,'Nuoc minibar fixture');assert.equal(migrated[0].total,25000);
 const upgraded=await api('GET',`/api/Services/usage/booking/${d.id}`);assert.equal(upgraded.find(x=>x.id===newer.id).serviceName,'Giat ui fixture');assert.equal(upgraded.find(x=>x.id!==newer.id).serviceName,'New catalog after invoice');
 assert.equal(sql(db=>db.prepare('SELECT COUNT(*) n FROM ServiceUsages').get().n),before.count+1);assert.equal(sql(db=>db.prepare('SELECT SUM(Total) n FROM ServiceUsages').get().n),before.total+12300);
 assert.deepEqual((await api('GET',`/api/BookingOperations/${c.id}/invoice`)).detail,invoice.detail);
 await api('PUT','/api/Services/'+service.id,{name:'Renamed after migration',unit:'lan',price:80000});assert.equal((await api('GET',`/api/Services/usage/booking/${d.id}`))[0].serviceName,'Giat ui fixture');
 console.log('PASS: original service names survive catalog edits, retry, portal, checkout invoice, reports and migration; old rows fall back only when no original operation snapshot exists, without rebilling or rewriting invoices.');

 if(process.env.HOTEL_FINANCIAL_HISTORY_UI==='1'){
  const require=createRequire(import.meta.url),module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';const {chromium}=require(module),{expect}=require(module+'/test');
  const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});try{
   const ui=await refundable(),page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient'));
   await page.goto(base);await page.locator('#username').fill('admin');await page.locator('#password').fill(testAdminPassword);await page.locator('#login-form [type="submit"]').click();await expect(page.locator('.dashboard-head')).toBeVisible();
   for(let i=0;i<2;i++){
    await page.evaluate(id=>action('booking-pay',id),ui.id);await expect(page.locator('#f-bankId')).toBeHidden();await page.locator('#f-method').selectOption('Transfer');
    await expect(page.locator('#f-bankId')).toBeVisible();await expect(page.locator('#f-bankAccountNumber')).toHaveValue(bank.accountNumber);
    await page.locator('#f-bankId').fill(i?'970422':'MB');await page.locator('#f-amount').fill('25000');await page.locator('#f-reference').fill('UI-OUT-REF');await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('dialog')).not.toBeVisible();
   }
   assert.equal((await payments(ui.id)).balance.paid,175000);assert.equal((await payments(ui.id)).items.filter(p=>p.type==='Refund').length,1);
   await page.goto(base+'/invoice.html?bookingId='+c.id);await expect(page.locator('#invoice')).toContainText('Nuoc minibar fixture');await expect(page.locator('#invoice')).not.toContainText('Giat ui fixture');assert.deepEqual(errors,[]);
   console.log('PASS: Edge refund form records source bank/account, duplicate reference from a new form does not refund twice, and invoice retains the original service name.');
  }finally{await browser.close();}
 }
 console.log(`PASS: ${checks} financial/history API/schema checks plus source-scope, migration and file assertions.`);
}finally{
 await stop();if(path.dirname(path.resolve(root))!==path.resolve(tmpdir())||!path.basename(root).startsWith('hotel-financial-history-'))throw Error('Unsafe cleanup');
 await rm(root,{recursive:true,force:true});console.log('Disposable financial/history data/server removed. No production SMTP or bank calls.');
}

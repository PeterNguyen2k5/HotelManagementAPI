import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {once} from 'node:events';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=await mkdtemp(path.join(tmpdir(),'hotel-service-retry-')),database=path.join(root,'hotel.db');
const listener=createServer().listen(0,'127.0.0.1');await once(listener,'listening');
const base=`http://127.0.0.1:${listener.address().port}`;await new Promise(resolve=>listener.close(resolve));
let server,admin,clerk,checks=0,roomNumber=0;
async function stop(){if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}server=null;}
async function start(){await stop();server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root]});}
async function api(method,route,body,status=200,token=admin){
 const response=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${method} ${route}: expected ${status}, got ${response.status}`);checks++;
 return {status:response.status,data:response.status===204?null:await response.json()};
}
const use=(payload,status=201,token=clerk)=>api('POST','/api/Services/usage',payload,status,token);
const usages=async id=>(await api('GET','/api/Services/usage/booking/'+id)).data;
try{
 await start();admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).data.token;
 const staff=(await api('POST','/api/Users',{username:'retryclerk',password:'Fixture-clerk-123!',fullName:'Lễ tân thử dịch vụ',role:'Receptionist'},201)).data;
 clerk=(await api('POST','/api/Auth/login',{username:staff.username,password:'Fixture-clerk-123!'},200,null)).data.token;
 const guest=(await api('POST','/api/CustomerAuth/register',{username:'retryguest',password:'Fixture-guest-123!',fullName:'Khách thử',phone:'0901234567',email:'retry@example.test'},201,null)).data;
 const customer=(await api('POST','/api/Customers',{fullName:'Khách dùng dịch vụ'},201)).data;
 const type=(await api('POST','/api/RoomTypes',{name:'Service retry fixture'},201)).data;
 const today=(await api('GET','/api/HotelConfiguration')).data.today;
 const end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+1);
 async function booking(){const room=(await api('POST','/api/Rooms',{roomNumber:'SR'+(++roomNumber),roomTypeId:type.id,price:100000,capacity:2},201)).data;const b=(await api('POST','/api/Bookings',{customerId:customer.id,roomId:room.id,guestCount:1,checkInDate:today,checkOutDate:end.toISOString().slice(0,10)},201)).data;await api('POST',`/api/Bookings/${b.id}/check-in`);return b;}
 const service=(await api('POST','/api/Services',{name:'Bữa sáng thử',unit:'Lần',price:25000},201)).data;
 const otherService=(await api('POST','/api/Services',{name:'Dịch vụ khác',unit:'Lần',price:10000},201)).data;
 const firstBooking=await booking(),secondBooking=await booking();
 const body={requestId:randomUUID(),bookingId:firstBooking.id,serviceId:service.id,quantity:1};
 await use(body,401,null);await use(body,403,guest.token);
 for(const requestId of [undefined,null,'','invalid','00000000-0000-0000-0000-000000000000',' '+randomUUID(),randomUUID().replaceAll('-','')]){
  const rejected=await use({...body,requestId},400);assert.ok(rejected.data.errors?.RequestId);
 }
 assert.equal((await usages(firstBooking.id)).length,0);
 const saved=(await use(body)).data;assert.equal(saved.total,25000);
 const repeated=(await use(body,200)).data;assert.deepEqual(repeated,saved);
 assert.deepEqual((await use({...body,requestId:body.requestId.toUpperCase()},200)).data,saved);
 assert.equal((await usages(firstBooking.id)).length,1);
 for(const changes of [{bookingId:secondBooking.id},{serviceId:otherService.id},{quantity:2}])await use({...body,...changes},409);
 await start();assert.deepEqual((await use(body,200)).data,saved);
 await api('PUT','/api/Services/'+service.id,{name:'Tên đã đổi',unit:'Lần',price:35000});
 assert.deepEqual((await use(body,200)).data,saved,'Retries preserve the originally recorded name/price.');
 const additional=(await use({...body,requestId:randomUUID()})).data;assert.equal(additional.total,35000);assert.notEqual(additional.id,saved.id);
 await api('DELETE','/api/Services/'+service.id,undefined,204);assert.deepEqual((await use(body,200)).data,saved);
 const disabledBody={...body,requestId:randomUUID()};await use(disabledBody,400);
 await api('POST','/api/Services/'+service.id+'/activate');await use(disabledBody);
 await api('DELETE','/api/Services/usage/'+saved.id,undefined,204);
 await use(body,409);assert.equal((await usages(firstBooking.id)).some(x=>x.id===saved.id),false);
 await start();await use(body,409);
 const afterDelete=await use({...body,requestId:randomUUID()});assert.equal(afterDelete.status,201);
 const parallelBooking=await booking(),parallel={...body,bookingId:parallelBooking.id,requestId:randomUUID()};
 const sent=await Promise.all(Array.from({length:12},()=>use(parallel,[201,200,409])));
 assert.equal(sent.filter(x=>x.status===201).length,1);const parallelSaved=(await use(parallel,200)).data;
 assert.equal((await usages(parallelBooking.id)).length,1);
 const conflictId=randomUUID();
 const conflicts=await Promise.all([use({...parallel,requestId:conflictId,quantity:1},[201,409]),use({...parallel,requestId:conflictId,quantity:2},[201,409])]);assert.equal(conflicts.filter(x=>x.status===201).length,1);
 const beforeCheckout=await usages(parallelBooking.id);
 await api('POST',`/api/Bookings/${parallelBooking.id}/check-out`);
 assert.deepEqual((await use(parallel,200)).data,parallelSaved,'Successful retry after checkout is read-only.');
 await use({...parallel,requestId:randomUUID()},409);
 const invoice=(await api('GET',`/api/BookingOperations/${parallelBooking.id}/invoice`)).data;
 assert.equal(invoice.detail.serviceTotal,beforeCheckout.reduce((sum,x)=>sum+x.total,0));
 assert.equal((await usages(parallelBooking.id)).length,beforeCheckout.length);
 const audit=(await api('GET','/api/Administration/audit?pageSize=100')).data.items;
 assert.ok(audit.some(x=>x.entity==='ServiceUsageOperation'));

 // Upgrade an existing database without re-billing its pre-existing usage rows.
 const legacyBefore=await usages(firstBooking.id);await stop();
 const sql=new DatabaseSync(database);try{sql.exec('DROP TABLE ServiceUsageOperations');sql.prepare('DELETE FROM __EFMigrationsHistory WHERE MigrationId LIKE ?').run('%AddServiceUsageIdempotency');}finally{sql.close();}
 await start();assert.deepEqual(await usages(firstBooking.id),legacyBefore);
 console.log(`PASS: ${checks} service-retry API checks: UUID validation, permissions, exact retry, payload conflicts, independent new orders, captured name/price, disable/re-enable, deletion tombstones, restart, concurrent requests, post-checkout retries and migration preserving old usages.`);

 if(process.env.HOTEL_SERVICE_RETRY_UI==='1'){
  const uiBooking=await booking();
  const require=createRequire(import.meta.url),module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';
  const {chromium}=require(module),{expect}=require(module+'/test');
  const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  try{
   const page=await browser.newPage();page.setDefaultTimeout(15000);
   const keys=[];let dropNext=true,committed;
   await page.route('**/api/Services/usage',async route=>{
    if(route.request().method()!=='POST')return route.continue();
    keys.push(route.request().postDataJSON().requestId);
    if(dropNext){dropNext=false;const response=await route.fetch();assert.equal(response.status(),201);committed=await response.json();return route.abort('failed');}
    return route.continue();
   });
   await page.goto(base);await page.locator('#username').fill(staff.username);await page.locator('#password').fill('Fixture-clerk-123!');await page.locator('#login-form [type="submit"]').click();await expect(page.locator('.dashboard-head')).toBeVisible();
   await page.locator('[data-view="bookings"]').first().click();await page.locator(`[data-act="usage-add"][data-id="${uiBooking.id}"]`).click();
   await page.locator('#f-serviceId').selectOption(String(service.id));await page.locator('#f-quantity').fill('1');await page.locator('#modal-form [type="submit"]').click();
   await expect(page.locator('#modal-error')).toContainText('Không kết nối được máy chủ');assert.ok(committed);assert.equal((await usages(uiBooking.id)).length,1);
   await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('#modal')).not.toBeVisible();
   assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert.equal((await usages(uiBooking.id)).length,1);
   await page.locator(`[data-act="usage-add"][data-id="${uiBooking.id}"]`).click();await page.locator('#f-serviceId').selectOption(String(service.id));await page.locator('#f-quantity').fill('1');await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('#modal')).not.toBeVisible();
   assert.notEqual(keys[2],keys[0]);assert.equal((await usages(uiBooking.id)).length,2);
   console.log('PASS: Edge loses the first response after server commit, retries the form with the same UUID without double-billing, and gives a genuinely new order a new UUID.');
  }finally{await browser.close();}
 }
}finally{
 await stop();if(path.dirname(path.resolve(root))!==path.resolve(tmpdir())||!path.basename(root).startsWith('hotel-service-retry-'))throw new Error('Unsafe cleanup path');
 await rm(root,{recursive:true,force:true});console.log('Temporary service-retry data removed. Live bookings and staff sessions were not used.');
}

import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(import.meta.dirname,'..'),root=await mkdtemp(path.join(tmpdir(),'hotel-payment-cancel-')),database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(r=>socket.close(r));
let server,browser,admin,checks=0,roomNumber=0;
async function raw(method,url,body,token=admin){
 const r=await fetch(base+url,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:token.startsWith('Apikey ')?token:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:r.status,data:r.status===204?null:await r.json()};
}
async function api(method,url,body,status=200,token=admin){const r=await raw(method,url,body,token);assert.equal(r.status,status,`${method} ${url}: ${JSON.stringify(r.data)}`);checks++;return r.data;}
function sql(action){const db=new DatabaseSync(database);try{return action(db);}finally{db.close();}}
try{
 server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root,'--Payments:BankConfigFile',path.join(root,'bank.json')]});
 admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).token;
 const guest=await api('POST','/api/CustomerAuth/register',{username:'cancelguest',password:'Fixture-guest-123!',email:'cancel@example.test',fullName:'Cancel fixture',phone:'0901234567'},201,null);
 const other=await api('POST','/api/CustomerAuth/register',{username:'cancelother',password:'Fixture-guest-123!',email:'other@example.test',fullName:'Other fixture',phone:'0901234568'},201,null);
 const type=await api('POST','/api/RoomTypes',{name:'Cancellation fixture'},201);
 const today=(await api('GET','/api/HotelConfiguration')).today;
 const end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+1);const checkout=end.toISOString().slice(0,10);
 const bank={bankId:'MB',bankName:'MB Bank',accountNumber:'0000000000001',accountName:'FIXTURE ONLY',sepayApiKey:'fixture-cancellation-key'};
 await api('POST','/api/BookingOperations/bank-config',bank);
 async function booking(){const r=await api('POST','/api/Rooms',{roomNumber:'C'+(++roomNumber),roomTypeId:type.id,price:100000,capacity:2},201);return api('POST','/api/Bookings',{customerId:guest.account.customerId,roomId:r.id,guestCount:1,checkInDate:today,checkOutDate:checkout},201);}
 const info=(id,token=guest.token)=>api('GET',`/api/BookingOperations/${id}/public-info`,undefined,200,token);
 const cancel=(id,status=200,token=guest.token)=>api('POST',`/api/BookingOperations/${id}/cancel-hold`,undefined,status,token);
 const pay=id=>raw('POST',`/api/BookingOperations/${id}/payments`,{requestId:randomUUID(),type:'Deposit',method:'Cash',amount:25000});
 const legacy=await booking();let view=await info(legacy.id);
 assert.equal(view.paymentDueAtUtc,null);assert.equal(view.canCancelHold,true);assert.equal(view.roomTypeName,type.name);checks+=3;
 await cancel(legacy.id,401,null);await cancel(legacy.id,403,admin);await cancel(legacy.id,404,other.token);await cancel(2147483647,404);
 await api('POST',`/api/BookingOperations/${legacy.id}/customer-payment`,{requestId:randomUUID(),type:'Direct',method:'Cash',amount:0},200,guest.token);
 const pending=await api('POST',`/api/BookingRequests/${legacy.id}`,{type:'Cancel',reason:'Fixture pending request'},201,guest.token);
 await cancel(legacy.id);await cancel(legacy.id);
 view=await info(legacy.id);assert.equal(view.status,'Cancelled');assert.equal(view.balance.paid,0);assert.equal(view.holdExpiredAtUtc,null);assert.equal(view.canCancelHold,false);checks+=4;
 const requests=await api('GET','/api/BookingRequests/mine',undefined,200,guest.token);assert.equal(requests.items.find(x=>x.id===pending.id).status,'Rejected');checks++;
 const available=await api('GET',`/api/Bookings/available-rooms?checkInDate=${today}&checkOutDate=${checkout}&guestCount=1`);assert.ok(available.some(x=>x.id===legacy.roomId));checks++;
 const late=await api('POST','/api/BookingOperations/sepay-webhook',{id:930001,gateway:'MBBank',accountNumber:bank.accountNumber,transferType:'in',transferAmount:25000,content:'ANNHIEN '+legacy.id,referenceCode:'CANCELLED-LATE'},200,'Apikey '+bank.sepayApiKey);assert.equal(late.status,'Pending');checks++;
 const paid=await booking();assert.equal((await pay(paid.id)).status,200);checks++;
 await cancel(paid.id,409);view=await info(paid.id);assert.equal(view.canCancelHold,false);assert.equal(view.canRequestCancellation,true);assert.equal(view.balance.paid,25000);checks+=3;
 const active=await booking();await api('POST',`/api/Bookings/${active.id}/check-in`);await cancel(active.id,409);
 const timed=await booking();sql(db=>db.prepare("UPDATE Bookings SET PaymentDueAtUtc=strftime('%Y-%m-%d %H:%M:%f','now','+30 minutes') WHERE Id=?").run(timed.id));
 // A cancellation racing a real receipt must never leave a paid cancellation created by this endpoint.
 for(let i=0;i<12;i++){
  const b=await booking();const results=await Promise.all([raw('POST',`/api/BookingOperations/${b.id}/cancel-hold`,undefined,guest.token),pay(b.id)]);
  assert.ok(results.every(x=>[200,409].includes(x.status)));
  const current=await info(b.id);
  if(current.status==='Cancelled')assert.equal(current.balance.paid,0);else{assert.equal(current.status,'Reserved');assert.equal(current.balance.paid,25000);}
  checks+=2;
 }
 console.log('PASS: owner-only unpaid cancellation, safe retries, Direct zero, pending requests, room release, late transfer reconciliation, paid/check-in rejection and 12 concurrent cash/cancel pairs.');
 if(process.env.HOTEL_PLAYWRIGHT_MODULE){
  const {chromium}=createRequire(import.meta.url)(process.env.HOTEL_PLAYWRIGHT_MODULE);
  browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(token=>sessionStorage.setItem('hotel.customer.token',token),guest.token);
  await page.route('https://img.vietqr.io/**',r=>r.abort());
  const unpaid=await booking();await page.goto(base+'/payment.html?bookingId='+unpaid.id);
  await page.locator('#btn-cancel-booking').waitFor();assert.match(await page.locator('#payment-hold-notice').innerText(),/không áp dụng thời hạn tự hủy/);checks++;
  await page.getByRole('button',{name:'Hủy giữ chỗ',exact:true}).click();await page.locator('#cancel-booking-dialog').waitFor();
  await page.getByRole('button',{name:'Giữ lại booking',exact:true}).click();assert.equal((await info(unpaid.id)).status,'Reserved');checks++;
  await page.goto(base+'/payment.html?bookingId='+timed.id);await page.locator('[data-hold-clock]').waitFor();
  assert.match(await page.locator('#payment-hold-notice').innerText(),/30 phút/);checks++;
  if(process.env.HOTEL_UI_SCREENSHOTS){await mkdir(process.env.HOTEL_UI_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.HOTEL_UI_SCREENSHOTS,'payment-deadline-cancel-desktop.png'),fullPage:true});}
  await page.getByRole('button',{name:'Hủy giữ chỗ',exact:true}).click();await page.getByRole('button',{name:'Xác nhận hủy',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#payment-hold-notice').textContent.includes('Booking đã hủy'));
  assert.equal(await page.locator('#qr-section').isVisible(),false);assert.equal(await page.locator('#btn-confirm-direct').isDisabled(),true);assert.equal((await info(timed.id)).status,'Cancelled');checks+=3;
  await page.goto(base+'/payment.html?bookingId='+paid.id);await page.getByRole('button',{name:'Yêu cầu hủy',exact:true}).click();
  await page.locator('#cancel-booking-reason').fill('Thay đổi lịch trình fixture');await page.getByRole('button',{name:'Gửi yêu cầu hủy',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#payment-cancel-status').textContent.includes('đang chờ lễ tân'));
  assert.equal(await page.locator('#btn-cancel-booking').isDisabled(),true);assert.equal((await info(paid.id)).status,'Reserved');checks+=2;
  await page.goto(base+'/payment.html?bookingId='+unpaid.id);await page.locator('#btn-cancel-booking').waitFor();await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('#btn-cancel-booking').isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks+=2;
  if(process.env.HOTEL_UI_SCREENSHOTS)await page.screenshot({path:path.join(process.env.HOTEL_UI_SCREENSHOTS,'payment-legacy-cancel-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Hủy giữ chỗ',exact:true}).click();
  // A receipt arriving after the dialog opened must be rechecked by the server.
  assert.equal((await pay(unpaid.id)).status,200);checks++;
  await page.getByRole('button',{name:'Xác nhận hủy',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#cancel-booking-error').textContent.includes('đã nhận tiền'));
  assert.equal((await info(unpaid.id)).status,'Reserved');assert.deepEqual(errors,[]);checks+=2;
  await context.close();await browser.close();browser=null;
  console.log('PASS: Edge desktop/mobile countdown, explicit no-deadline explanation, visible cancellation, confirmation/dismissal, paid request flow, raced receipt rejection and no browser errors.');
 }
 console.log(`PASS: ${checks} payment cancellation checks.`);
}finally{await browser?.close();if(server?.exitCode===null){const done=once(server,'exit');server.kill();await done;}await rm(root,{recursive:true,force:true});}

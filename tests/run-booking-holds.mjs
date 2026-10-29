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

const project=path.resolve(import.meta.dirname,'..'),root=await mkdtemp(path.join(tmpdir(),'hotel-holds-')),database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(r=>socket.close(r));
let server,admin,checks=0,roomNumber=0,browser;
async function start(){server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root,'--Payments:BankConfigFile',path.join(root,'bank.json')]});}
async function stop(){if(server&&server.exitCode===null){const done=once(server,'exit');server.kill();await done;}server=null;}
async function api(method,url,body,status=200,token=admin){
 const r=await fetch(base+url,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:token.startsWith('Apikey ')?token:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=r.status===204?null:await r.json();assert.equal(r.status,status,`${method} ${url}: ${JSON.stringify(data)}`);checks++;return data;
}
function sql(action){const db=new DatabaseSync(database);try{return action(db);}finally{db.close();}}
const expire=id=>sql(db=>db.prepare("UPDATE Bookings SET PaymentDueAtUtc = strftime('%Y-%m-%d %H:%M:%f', 'now', '-1 minute') WHERE Id = ?").run(id));
const payment=(id,type='Deposit',amount=25000,method='Cash',reference=null)=>api('POST',`/api/BookingOperations/${id}/payments`,{requestId:randomUUID(),type,amount,method,reference});
try {
 await start();admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).token;
 const guest=await api('POST','/api/CustomerAuth/register',{username:'holdguest',password:'Guest-fixture-123!',fullName:'Hold guest',email:'hold@example.test',phone:'0901234567'},201,null);
 const other=await api('POST','/api/CustomerAuth/register',{username:'holdother',password:'Guest-fixture-123!',fullName:'Other guest',email:'other@example.test',phone:'0901234568'},201,null);
 const today=(await api('GET','/api/HotelConfiguration')).today;
 const date=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const type=await api('POST','/api/RoomTypes',{name:'Hold fixtures'},201);
 async function room(price=100000){return api('POST','/api/Rooms',{roomNumber:'H'+(++roomNumber),roomTypeId:type.id,price,capacity:2},201);}
 const body=r=>({roomId:r.id,guestCount:1,checkInDate:today,checkOutDate:date(1),fullName:'Hold guest',phone:'0901234567',email:'hold@example.test'});
 async function hold(r){return api('POST','/api/Bookings/public',body(r),201,guest.token);}
 const r1=await room(),h1=await hold(r1);
 assert.match(h1.paymentDueAtUtc,/Z$/);assert.ok(Math.abs(Date.parse(h1.paymentDueAtUtc)-Date.parse(h1.serverTimeUtc)-1800000)<1000);checks+=2;
 const pending=await api('POST',`/api/BookingRequests/${h1.id}`,{type:'Cancel',reason:'Guest fixture request'},201,guest.token);
 await api('POST',`/api/BookingOperations/${h1.id}/customer-payment`,{requestId:randomUUID(),type:'Direct',method:'Cash',amount:0},200,guest.token);
 const bank={bankId:'MB',bankName:'MB Bank',accountNumber:'0000000000001',accountName:'FIXTURE ONLY',sepayApiKey:'fixture-holds-webhook-key'};
 await api('POST','/api/BookingOperations/bank-config',bank);
 expire(h1.id);
 const available=await api('GET',`/api/Bookings/available-rooms?checkInDate=${today}&checkOutDate=${date(1)}&guestCount=1`);
 assert.ok(available.some(r=>r.id===r1.id));checks++;
 const replacement=await api('POST','/api/Bookings',{...body(r1),customerId:other.account.customerId},201);
 assert.equal(replacement.paymentDueAtUtc,null);checks++;
 const late=await api('POST','/api/BookingOperations/sepay-webhook',{id:920001,gateway:'MBBank',accountNumber:bank.accountNumber,transferType:'in',transferAmount:25000,content:'ANNHIEN '+h1.id,referenceCode:'HOLD-LATE'},200,'Apikey '+bank.sepayApiKey);
 assert.equal(late.status,'Pending');checks++;
 const cancelled=await api('GET',`/api/CustomerPortal/bookings/${h1.id}`,undefined,200,guest.token);
 assert.equal(cancelled.booking.status,'Cancelled');assert.ok(cancelled.booking.holdExpiredAtUtc);assert.equal(cancelled.balance.paid,0);assert.equal(cancelled.canPay,false);assert.equal(cancelled.requests[0].status,'Rejected');checks+=5;
 const rows=await api('GET','/api/BankTransfers');assert.equal(rows.items[0].reason,'HoldExpired');checks++;
 await api('POST',`/api/BookingOperations/${h1.id}/payments`,{requestId:randomUUID(),type:'Deposit',method:'Cash',amount:25000},409);
 await api('POST',`/api/Bookings/${h1.id}/check-in`,undefined,409);
 await api('POST',`/api/BookingRequests/${pending.id}/resolve`,{approve:true},409);
 const r2=await room(),h2=await hold(r2);await payment(h2.id);expire(h2.id);
 await api('GET','/api/CustomerPortal/summary',undefined,200,guest.token);
 const protectedBooking=await api('GET',`/api/CustomerPortal/bookings/${h2.id}`,undefined,200,guest.token);
 assert.equal(protectedBooking.booking.status,'Reserved');assert.equal(protectedBooking.booking.awaitingPayment,false);checks+=2;
 const occupied=await api('GET',`/api/Bookings/available-rooms?checkInDate=${today}&checkOutDate=${date(1)}&guestCount=1`);assert.ok(!occupied.some(r=>r.id===r2.id));checks++;
 await api('POST',`/api/Bookings/${h2.id}/check-in`);
 const r3=await room(),h3=await hold(r3);expire(h3.id);
 await api('POST',`/api/BookingOperations/${h3.id}/payments`,{requestId:randomUUID(),type:'Deposit',method:'Transfer',amount:25000,reference:'HOLD-TOO-LATE'},409);
 assert.equal((await api('GET',`/api/Bookings/${h3.id}`)).status,'Cancelled');checks++;
 const r4=await room(),h4=await hold(r4);
 await api('POST',`/api/Bookings/${h4.id}/check-in`,undefined,409);
 const approved=await api('POST',`/api/BookingRequests/${h4.id}`,{type:'Change',reason:'Change dates fixture',roomId:r4.id,checkInDate:date(2),checkOutDate:date(3)},201,guest.token);
 await api('POST',`/api/BookingRequests/${approved.id}/resolve`,{approve:true,note:'Approved fixture'});
 assert.equal((await api('GET',`/api/CustomerPortal/bookings/${h4.id}`,undefined,200,guest.token)).booking.paymentDueAtUtc,h4.paymentDueAtUtc);checks++;
 const free=await hold(await room(0));assert.equal(free.paymentDueAtUtc,null);checks++;
 let feed=await api('GET','/api/CustomerNotifications',undefined,200,guest.token);
 assert.ok(feed.items.some(x=>x.id==='expired-'+h1.id));assert.ok(feed.items.some(x=>x.id==='payment-'+protectedBooking.payments[0].id&&x.message.includes('Tiền mặt')));assert.ok(feed.items.some(x=>x.id==='request-'+approved.id));assert.ok(!feed.items.some(x=>x.bookingId===replacement.id));checks+=4;
 assert.ok(feed.items.every(x=>/Z$/.test(x.createdAtUtc)));checks++;
 await api('GET','/api/CustomerNotifications',undefined,401,null);await api('GET','/api/CustomerNotifications',undefined,403,admin);
 assert.equal((await api('GET','/api/CustomerNotifications',undefined,200,other.token)).items.length,0);checks++;
 await api('POST','/api/CustomerNotifications/read',{keys:[feed.items[0].id]},404,other.token);
 await api('POST','/api/CustomerNotifications/read',{keys:null},400,guest.token);
 const readKey=feed.items[0].id;
 await api('POST','/api/CustomerNotifications/read',{keys:[readKey,readKey]},204,guest.token);
 await api('POST','/api/CustomerNotifications/read',{keys:[readKey]},204,guest.token);
 assert.equal(sql(db=>db.prepare('SELECT COUNT(*) n FROM CustomerNotificationReads').get().n),1);checks++;
 await stop();await start();
 assert.equal((await api('GET','/api/CustomerNotifications',undefined,200,guest.token)).items.find(x=>x.id===readKey).isRead,true);checks++;
 assert.equal((await api('GET',`/api/Bookings/${replacement.id}`)).status,'Reserved');checks++;
 console.log('PASS: 30-minute UTC holds; direct choice is not a receipt; expiration releases rooms, rejects pending requests and late credits; partial deposits and legacy/staff bookings survive; notification ownership, idempotent reads and restart persistence.');

 if(process.env.HOTEL_PLAYWRIGHT_MODULE){
  const {chromium}=createRequire(import.meta.url)(process.env.HOTEL_PLAYWRIGHT_MODULE);
  browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1280,height:850}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(token=>sessionStorage.setItem('hotel.customer.token',token),guest.token);
  await page.addInitScript(()=>{const now=Date.now.bind(Date);Date.now=()=>now()+21600000;});
  await page.goto(base+'/customer.html#bookings');await page.locator('[data-portal-booking="'+h4.id+'"]').waitFor();
  await page.locator('[data-hold-clock]').first().waitFor();
  await page.waitForFunction(()=>/^(29|30):[0-5][0-9]$/.test(document.querySelector('[data-hold-clock]').textContent));checks++;
  await page.getByRole('button',{name:/Thông báo/}).click();await page.locator('.guest-notification').first().waitFor();
  if(process.env.HOTEL_UI_SCREENSHOTS){await mkdir(process.env.HOTEL_UI_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.HOTEL_UI_SCREENSHOTS,'customer-holds-desktop.png'),fullPage:true});}
  await page.getByRole('button',{name:'Đọc tất cả'}).click();await page.waitForFunction(()=>document.querySelector('.guest-bell b').hidden);checks++;
  await page.keyboard.press('Escape');assert.equal(await page.locator('#guest-notification-panel').isVisible(),false);checks++;
  await page.goto(base+'/payment.html?bookingId='+h4.id);await page.locator('#payment-hold-notice [data-hold-clock]').waitFor();
  const seconds=()=>page.locator('#payment-hold-notice [data-hold-clock]').innerText().then(x=>x.split(':').reduce((m,n)=>m*60+Number(n),0));
  const initialSeconds=await seconds();await page.waitForTimeout(2100);
  await page.locator('#card-deposit .method-head strong').click();
  assert.ok(await seconds()<=initialSeconds-1,'Switching the payment method must not restart the countdown.');checks++;
  await page.route('https://img.vietqr.io/**',route=>route.abort());
  expire(h4.id);await api('GET',`/api/BookingOperations/${h4.id}/payment-status`,undefined,200,guest.token);
  await page.waitForFunction(()=>document.querySelector('#payment-hold-notice').textContent.includes('Đã hết hạn'),{timeout:10000});
  assert.equal(await page.locator('#btn-confirm-transfer').isDisabled(),true);assert.equal(await page.locator('#btn-confirm-direct').isDisabled(),true);checks+=2;
  await page.goto(base+'/customer.html#booking-'+h4.id);await page.locator('.booking-hold.expired').waitFor();
  await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:/Thông báo/}).click();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
  if(process.env.HOTEL_UI_SCREENSHOTS)await page.screenshot({path:path.join(process.env.HOTEL_UI_SCREENSHOTS,'customer-holds-mobile.png'),fullPage:true});
  await page.goto(base+'/hotel.html');await page.getByRole('button',{name:/Thông báo/}).waitFor();
  await page.getByRole('button',{name:/Thông báo/}).click();await page.locator('.guest-notification').first().waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);checks++;
  await context.close();await browser.close();browser=null;
  console.log('PASS: Edge desktop/mobile bell, read-all, escape/focus, countdown, expiry payment controls and no browser errors.');
 }
 // The background job must cancel without any API read or open browser.
 const unattended=await api('POST','/api/Bookings',{...body(await room()),customerId:guest.account.customerId},201);
 sql(db=>db.prepare("UPDATE Bookings SET PaymentDueAtUtc = strftime('%Y-%m-%d %H:%M:%f', 'now', '-1 minute') WHERE Id = ?").run(unattended.id));
 for(let i=0;i<90;i++){
  if(sql(db=>db.prepare('SELECT Status FROM Bookings WHERE Id = ?').get(unattended.id).Status)==='Cancelled')break;
  await new Promise(r=>setTimeout(r,250));
 }
 assert.equal(sql(db=>db.prepare('SELECT Status FROM Bookings WHERE Id = ?').get(unattended.id).Status),'Cancelled');checks++;
 // Upgrade a populated pre-feature schema. No imported booking acquires a deadline.
 await stop();
 const fingerprint=()=>sql(db=>({bookings:db.prepare('SELECT COUNT(*) n FROM Bookings').get().n,paid:db.prepare('SELECT SUM(Amount) n FROM BookingPayments').get().n,rooms:db.prepare('SELECT COUNT(*) n FROM Rooms').get().n}));
 const before=fingerprint();
 sql(db=>db.exec("DROP INDEX IX_Bookings_Status_PaymentDueAtUtc; DROP TABLE CustomerNotificationReads; ALTER TABLE Bookings DROP COLUMN PaymentDueAtUtc; ALTER TABLE Bookings DROP COLUMN HoldExpiredAtUtc; DELETE FROM __EFMigrationsHistory WHERE MigrationId LIKE '%AddBookingHoldsAndNotificationReads';"));
 await start();assert.deepEqual(fingerprint(),before);assert.equal(sql(db=>db.prepare('SELECT COUNT(*) n FROM Bookings WHERE PaymentDueAtUtc IS NOT NULL OR HoldExpiredAtUtc IS NOT NULL').get().n),0);checks+=2;
 console.log('PASS: unattended expiry and migration of a populated legacy database preserve rooms, booking counts and money; old bookings have no new deadline.');
 console.log(`PASS: ${checks} booking hold and customer notification checks.`);
} finally {await browser?.close();await stop();await rm(root,{recursive:true,force:true});}

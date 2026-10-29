import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(import.meta.dirname,'..'),root=await mkdtemp(path.join(tmpdir(),'hotel-guest-capacity-')),database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(r=>socket.close(r));
let server,browser,admin,checks=0;
async function api(method,url,body,status=200,token=admin){
 const response=await fetch(base+url,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=response.status===204?null:await response.json();assert.equal(response.status,status,`${method} ${url}: ${JSON.stringify(data)}`);checks++;return data;
}
async function maximum(){const r=await fetch(base+'/api/Bookings/guest-options');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');checks+=2;return (await r.json()).maxGuests;}
try{
 server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root]});
 assert.equal(await maximum(),1);checks++;
 admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).token;
 const guest=await api('POST','/api/CustomerAuth/register',{username:'capacityguest',password:'Fixture-guest-123!',email:'capacity@example.test',fullName:'Capacity fixture',phone:'0901234567'},201,null);
 const type=await api('POST','/api/RoomTypes',{name:'Capacity fixture'},201);
 const small=await api('POST','/api/Rooms',{roomNumber:'GC2',roomTypeId:type.id,price:100000,capacity:2},201);
 assert.equal(await maximum(),2);checks++;
 const large=await api('POST','/api/Rooms',{roomNumber:'GC20',roomTypeId:type.id,price:200000,capacity:20},201);
 assert.equal(await maximum(),20);checks++;
 const today=(await api('GET','/api/HotelConfiguration')).today;
 const day=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
 const body={fullName:guest.account.fullName,phone:guest.account.phone,email:guest.account.email,roomId:large.id,guestCount:20,checkInDate:day(3),checkOutDate:day(4)};
 async function available(n){return api('GET',`/api/Bookings/available-rooms?checkInDate=${day(3)}&checkOutDate=${day(4)}&guestCount=${n}`,undefined,200,null);}
 for(const n of [5,19,20]){const result=await available(n);assert.deepEqual(result.map(x=>x.id),[large.id]);checks++;}
 assert.deepEqual(await available(21),[]);checks++;
 for(const n of [0,-1,1.5,101])await api('GET',`/api/Bookings/available-rooms?checkInDate=${day(3)}&checkOutDate=${day(4)}&guestCount=${n}`,undefined,400,null);
 await api('POST','/api/Bookings/public',{...body,guestCount:21},400,guest.token);
 await api('POST','/api/Bookings/public',{...body,roomId:small.id,guestCount:20},400,guest.token);
 const group=await api('POST','/api/Bookings/public',body,201,guest.token);
 assert.equal(group.guestCount,20);assert.equal((await api('GET',`/api/CustomerPortal/bookings/${group.id}`,undefined,200,guest.token)).booking.guestCount,20);checks+=2;
 await api('POST',`/api/BookingOperations/${group.id}/cancel-hold`,undefined,200,guest.token);
 const ceiling=await api('POST','/api/Rooms',{roomNumber:'GC100',roomTypeId:type.id,price:100000,capacity:100},201);
 assert.equal(await maximum(),100);checks++;
 await api('DELETE','/api/Rooms/'+ceiling.id,undefined,204);assert.equal(await maximum(),20);checks++;
 const setCapacity=capacity=>api('PUT','/api/Rooms/'+large.id,{roomNumber:large.roomNumber,roomTypeId:type.id,price:large.price,status:0,capacity});
 if(process.env.HOTEL_PLAYWRIGHT_MODULE){
  const {chromium}=createRequire(import.meta.url)(process.env.HOTEL_PLAYWRIGHT_MODULE);
  browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(token=>sessionStorage.setItem('hotel.customer.token',token),guest.token);
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:950});await page.goto(base+'/hotel.html');
   await page.waitForFunction(()=>document.querySelector('select[name="guests"]')?.options.length===20&&!document.querySelector('select[name="guests"]').disabled);
   assert.equal(await page.locator('select[name="guests"] option').last().getAttribute('value'),'20');checks++;
   await page.locator('[name="checkInDate"]').fill(day(3));await page.locator('[name="checkOutDate"]').fill(day(4));
   await page.locator('select[name="guests"]').selectOption('20');
   await page.waitForFunction(()=>document.querySelector('#room-results').getAttribute('aria-busy')==='false');
   assert.equal(await page.locator('[data-room]').count(),1);assert.equal(await page.locator('[data-room]').getAttribute('data-room'),String(large.id));
   assert.equal(await page.locator('select[name="guests"]').inputValue(),'20');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks+=4;
   if(process.env.HOTEL_UI_SCREENSHOTS){await mkdir(process.env.HOTEL_UI_SCREENSHOTS,{recursive:true});await page.locator('#search-form').screenshot({path:path.join(process.env.HOTEL_UI_SCREENSHOTS,'guest-selector-'+width+'.png')});}
  }
  // Re-read capacity on search, keeping the selected group size when the catalog grows.
  await setCapacity(25);await page.locator('#search-form [type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('select[name="guests"]').options.length===25);
  assert.equal(await page.locator('select[name="guests"]').inputValue(),'20');checks++;
  await setCapacity(10);await page.locator('#search-form [type="submit"]').click();
  await page.waitForFunction(()=>document.querySelector('#room-results').textContent.includes('từ 1 đến 10'));
  assert.equal(await page.locator('select[name="guests"]').inputValue(),'20');assert.equal(await page.locator('[data-room]').count(),0);checks+=2;
  await setCapacity(20);await page.locator('#search-form [type="submit"]').click();
  await page.locator('[data-room="'+large.id+'"]').waitFor();
  await page.locator('[data-room="'+large.id+'"]').click();await page.locator('#booking-form').waitFor();
  assert.match(await page.locator('#booking-form header p').innerText(),/20 khách/);checks++;
  await page.locator('#booking-form [type="submit"]').click();await page.waitForURL('**/payment.html?bookingId=*');
  await page.waitForFunction(()=>document.querySelector('#summary-stay-info').textContent.includes('20 khách'));
  const bookedId=Number(new URL(page.url()).searchParams.get('bookingId'));
  assert.equal((await api('GET',`/api/CustomerPortal/bookings/${bookedId}`,undefined,200,guest.token)).booking.guestCount,20);checks++;
  // Failure to load capacity is explicit and retryable; it must not fabricate four-guest limits.
  let fail=true;await page.route('**/api/Bookings/guest-options',r=>fail?r.fulfill({status:503,contentType:'application/json',body:'{}'}):r.continue());
  await page.goto(base+'/hotel.html');await page.getByRole('button',{name:'Thử lại',exact:true}).waitFor();
  assert.equal(await page.locator('select[name="guests"]').isDisabled(),true);checks++;
  fail=false;await page.getByRole('button',{name:'Thử lại',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('select[name="guests"]').options.length===20&&!document.querySelector('select[name="guests"]').disabled);
  assert.deepEqual(errors,[]);checks++;
  await context.close();await browser.close();browser=null;
  console.log('PASS: Edge desktop/mobile selection above four guests, exact room filtering and real 20-guest booking; catalog growth/shrink preserves group size; load failure and retry work.');
 }
 console.log(`PASS: ${checks} dynamic guest capacity checks.`);
}finally{await browser?.close();if(server?.exitCode===null){const done=once(server,'exit');server.kill();await done;}await rm(root,{recursive:true,force:true});}

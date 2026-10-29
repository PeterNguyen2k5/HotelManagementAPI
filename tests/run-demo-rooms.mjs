import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(import.meta.dirname,'..'),runtime=await mkdtemp(path.join(tmpdir(),'hotel-demo-rooms-'));
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(resolve=>socket.close(resolve));
let server,root,token,checks=0;
async function stop(){if(server&&server.exitCode===null){const done=once(server,'exit');server.kill();await done;}server=null;}
async function start(name){await stop();root=path.join(runtime,name);await mkdir(root,{recursive:true});server=await startTestServer({project,root,database:path.join(root,'hotel.db'),base});token=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).token;}
async function api(method,url,body,status=200,auth=token){const r=await fetch(base+url,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(auth?{authorization:'Bearer '+auth}:{})},body:body===undefined?undefined:JSON.stringify(body)});const value=r.status===204?null:await r.json();assert.ok((Array.isArray(status)?status:[status]).includes(r.status),`${url}: ${r.status} ${JSON.stringify(value)}`);checks++;return value;}
function counts(){const db=new DatabaseSync(path.join(root,'hotel.db'));try{return Object.fromEntries(['Customers','CustomerAccounts','Users','Bookings','BookingPayments','Services'].map(table=>[table,db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n]));}finally{db.close();}}
const create=(status=200,auth=token)=>api('POST','/api/Administration/demo-rooms',undefined,status,auth);
async function verifyCatalog(){
 const rooms=(await api('GET','/api/Rooms?PageSize=100')).items,types=(await api('GET','/api/RoomTypes?PageSize=100')).items;
 assert.equal(rooms.length,6);assert.equal(types.length,3);assert.equal(new Set(rooms.map(x=>x.roomNumber)).size,6);assert.ok(rooms.every(x=>x.status===0&&[2,4].includes(x.capacity)));
 assert.deepEqual([...new Set(rooms.map(x=>x.price))].sort((a,b)=>a-b),[450000,750000,1100000]);
 const today=(await api('GET','/api/HotelConfiguration')).today,day=new Date(today+'T12:00:00Z');day.setUTCDate(day.getUTCDate()+1);
 const available=await api('GET',`/api/Bookings/available-rooms?CheckInDate=${today}&CheckOutDate=${day.toISOString().slice(0,10)}&GuestCount=2`,undefined,200,null);assert.equal(available.length,6);
 for(const room of rooms){const content=await api('GET','/api/RoomPresentation/'+room.id,undefined,200,null);assert.ok(content.isIllustration);assert.equal(content.gallery.length,2);assert.ok(content.amenities.length>=4);assert.match(content.description,/Dữ liệu mẫu/);const image=await fetch(base+content.gallery[0]);assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/svg/);checks++;}
 return rooms;
}
try{
 await start('empty');const clerk=await api('POST','/api/Users',{username:'democlerk',password:'Fixture-clerk-123!',fullName:'Demo clerk',role:'Receptionist'},201);const staff=(await api('POST','/api/Auth/login',{username:clerk.username,password:'Fixture-clerk-123!'},200,null)).token;
 const guest=await api('POST','/api/CustomerAuth/register',{username:'demoguest',password:'Fixture-guest-123!',fullName:'Demo guest',phone:'0901234567',email:'demo@example.test'},201,null);
 for(const [auth,status] of [[null,401],[staff,403],[guest.token,403]])await create(status,auth);
 assert.equal((await api('GET','/api/Rooms')).totalCount,0);const before=counts();
 const first=await create();assert.equal(first.created,true);assert.equal(first.roomsCreated,6);const original=await verifyCatalog();assert.deepEqual(counts(),before);
 assert.equal((await create()).created,false);assert.deepEqual((await api('GET','/api/Rooms?PageSize=100')).items,original);await start('empty');assert.equal((await create()).created,false);assert.equal((await api('GET','/api/Rooms')).totalCount,6);
 await start('existing');const type=await api('POST','/api/RoomTypes',{name:'Real catalog fixture'},201);const room=await api('POST','/api/Rooms',{roomNumber:'REAL101',roomTypeId:type.id,price:123456,capacity:3,description:'Must remain unchanged'},201);assert.equal((await create()).created,false);assert.deepEqual(await api('GET','/api/Rooms/'+room.id),room);assert.equal((await api('GET','/api/RoomTypes')).totalCount,1);
 await start('concurrent');const attempts=await Promise.all(Array.from({length:8},()=>create([200,409])));assert.equal(attempts.filter(x=>x.created===true).length,1);await verifyCatalog();assert.equal((await create()).created,false);
 if(process.env.HOTEL_DEMO_UI==='1'){
  await start('browser');const require=createRequire(import.meta.url),module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';const {chromium}=require(module),{expect}=require(module+'/test');const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});try{
   const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient'));
   await page.goto(base+'/index.html');await page.locator('#username').fill('admin');await page.locator('#password').fill(testAdminPassword);await page.locator('#login-form [type="submit"]').click();await expect(page.locator('.dashboard-head')).toBeVisible();await page.locator('.nav-item[data-view="rooms"]').click();await expect(page.locator('[data-act="demo-rooms"]')).toBeVisible();await page.locator('[data-act="demo-rooms"]').click();await expect(page.locator('[data-act="demo-rooms"]')).toHaveCount(0);await expect(page.locator('#main')).toContainText('M101');await expect(page.locator('#main')).toContainText('Family (mẫu)');await verifyCatalog();
   await page.goto(base+'/hotel.html');await expect(page.locator('#room-results')).toContainText('Standard (mẫu)');await expect(page.locator('#room-results')).toContainText('Deluxe (mẫu)');await expect(page.locator('#room-results')).toContainText('Family (mẫu)');assert.deepEqual(errors,[]);console.log('PASS: Edge Admin creates the catalog once; guest site displays demo rooms/prices and the create button disappears.');
  }finally{await browser.close();}
 }
 console.log(`PASS: ${checks} demo catalog API/UI checks plus permissions, atomic retry/race, existing-room preservation, availability and illustration assertions; no bookings, customers, payments or bank settings are seeded.`);
}finally{await stop();const resolved=path.resolve(runtime);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('hotel-demo-rooms-'))throw Error('Unsafe cleanup');await rm(resolved,{recursive:true,force:true});console.log('Temporary demo servers/data removed; live hotel data was not used.');}

import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,readFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {startTestServer} from './test-server.mjs';

const project=path.resolve(import.meta.dirname,'..'),root=await mkdtemp(path.join(tmpdir(),'hotel-contact-')),database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(r=>socket.close(r));
const contact={phone:'0965793437',phoneUrl:'tel:0965793437',email:'1923050059@dntu.edu.vn',emailUrl:'mailto:1923050059@dntu.edu.vn',facebookUrl:'https://www.facebook.com/profile.php?id=61596179751603'};
let server,browser,checks=0;
async function stop(){if(server?.exitCode===null){const done=once(server,'exit');server.kill();await done;}server=null;}
async function start(args=[]){await stop();server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root,...args]});}
async function get(){const r=await fetch(base+'/api/HotelContact');assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');checks+=2;return r.json();}
const args=['--HotelContact:Phone',' '+contact.phone+' ','--HotelContact:Email',contact.email,'--HotelContact:FacebookUrl',contact.facebookUrl,
 '--CustomerEmail:From','smtp-only@example.test','--CustomerEmail:Smtp:Password','fixture-secret-never-public'];
try{
 await start();assert.deepEqual(await get(),{phone:'',phoneUrl:null,email:'',emailUrl:null,facebookUrl:null});checks++;
 await start(args);assert.deepEqual(await get(),contact);checks++;
 assert.deepEqual(Object.keys(await get()).sort(),Object.keys(contact).sort());checks++;
 const shipped=JSON.parse(await readFile(path.join(project,'appsettings.json'),'utf8')).HotelContact;
 assert.equal(shipped.Phone,contact.phone);assert.equal(shipped.Email,contact.email);assert.equal(shipped.FacebookUrl,contact.facebookUrl);checks+=3;
 for(const file of ['hotel.html','payment.html','customer.html']){
  const html=await (await fetch(base+'/'+file)).text();assert.match(html,/hotel-contact\.js/);assert.match(html,/data-hotel-contact/);assert.ok(!html.includes('1900 6868'));checks+=3;
 }
 if(process.env.HOTEL_PLAYWRIGHT_MODULE){
  const {chromium}=createRequire(import.meta.url)(process.env.HOTEL_PLAYWRIGHT_MODULE);
  browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:950});
   for(const file of ['hotel.html#contact','payment.html?bookingId=20','customer.html']){
    await page.goto(base+'/'+file);await page.locator('[data-contact-kind="phone"]').waitFor();
    assert.equal(await page.locator('[data-contact-kind="phone"]').getAttribute('href'),contact.phoneUrl);
    assert.equal(await page.locator('[data-contact-kind="email"]').getAttribute('href'),contact.emailUrl);
    assert.equal(await page.locator('[data-contact-kind="facebook"]').getAttribute('href'),contact.facebookUrl);
    assert.equal(await page.locator('[data-contact-kind="facebook"]').getAttribute('target'),'_blank');
    assert.match(await page.locator('[data-contact-kind="facebook"]').getAttribute('rel'),/noopener/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks+=6;
    if(process.env.HOTEL_UI_SCREENSHOTS&&file.startsWith('hotel.html')){
     await mkdir(process.env.HOTEL_UI_SCREENSHOTS,{recursive:true});
     await page.locator('#contact').scrollIntoViewIfNeeded();
     await page.screenshot({path:path.join(process.env.HOTEL_UI_SCREENSHOTS,'hotel-contact-'+width+'.png')});
    }
   }
  }
  // Contact failure cannot prevent room search or display stale example details.
  let failed=true;
  await page.route('**/api/HotelContact',route=>failed?route.fulfill({status:503,contentType:'application/json',body:'{}'}):route.continue());
  await page.goto(base+'/hotel.html#contact');await page.getByRole('button',{name:'Tải lại thông tin liên hệ'}).waitFor();
  assert.equal(await page.locator('[data-contact-kind]').count(),0);checks++;
  failed=false;await page.getByRole('button',{name:'Tải lại thông tin liên hệ'}).click();await page.locator('[data-contact-kind="phone"]').waitFor();checks++;
  await page.unroute('**/api/HotelContact');
  // Even a malformed response must not turn a contact button into executable JavaScript.
  await page.route('**/api/HotelContact',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({phone:'<img src=x onerror=alert(1)>',phoneUrl:'javascript:alert(1)',email:'<svg onload=alert(1)>',emailUrl:'javascript:alert(1)',facebookUrl:'https://www.facebook.com.evil.test/profile'})}));
  await page.reload();await page.waitForFunction(()=>document.querySelector('[data-hotel-contact]').textContent.includes('chưa cập nhật'));
  assert.equal(await page.locator('[data-contact-kind]').count(),0);assert.equal(await page.locator('[data-hotel-contact] img,[data-hotel-contact] svg').count(),0);assert.deepEqual(errors,[]);checks+=3;
  await context.close();await browser.close();browser=null;
  console.log('PASS: Edge desktop/mobile public contact, customer/payment pages without login, exact call/email/Facebook targets, retry and safe links. No calls, messages or emails were sent.');
 }
 for(const facebook of ['javascript:alert(1)','http://www.facebook.com/profile','https://www.facebook.com.evil.test/profile','https://www.facebook.com@evil.test/profile','https://www.facebook.com:444/profile']){
  await start(['--HotelContact:Phone','<script>','--HotelContact:Email','Display <smtp-only@example.test>','--HotelContact:FacebookUrl',facebook]);
  assert.deepEqual(await get(),{phone:'',phoneUrl:null,email:'',emailUrl:null,facebookUrl:null});checks++;
 }
 await start(['--HotelContact:Phone','+84 (965) 793-437','--HotelContact:Email',' contact@example.test ','--HotelContact:FacebookUrl',contact.facebookUrl]);
 const formatted=await get();assert.equal(formatted.phoneUrl,'tel:+84965793437');assert.equal(formatted.emailUrl,'mailto:contact@example.test');checks+=2;
 console.log(`PASS: ${checks} contact configuration, public API, content and UI checks.`);
}finally{await browser?.close();await stop();await rm(root,{recursive:true,force:true});}

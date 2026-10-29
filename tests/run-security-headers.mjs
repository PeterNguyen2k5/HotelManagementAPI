import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {createServer as createHttpServer,request as httpRequest} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(import.meta.dirname,'..'),root=await mkdtemp(path.join(tmpdir(),'hotel-security-headers-')),database=path.join(root,'hotel.db'),bankFile=path.join(root,'bank.json');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(r=>socket.close(r));
let server,browser,attacker,admin,checks=0;
const trusted={host:'security.hotel.test','x-forwarded-for':'198.51.100.2','x-forwarded-proto':'https'};
async function stop(){if(server?.exitCode===null){const done=once(server,'exit');server.kill();await done;}server=null;}
async function start(environment='Production'){
 await stop();server=await startTestServer({project,root,database,base,environment,extraArgs:['--Storage:DataDirectory',root,'--Payments:BankConfigFile',bankFile,'--ReverseProxy:Enabled','true','--ReverseProxy:KnownProxies:0','127.0.0.1']});
}
function headers(response,{hsts=false,swagger=false}={}){
 assert.equal(response.headers.get('x-frame-options'),'DENY');
 assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 assert.equal(response.headers.get('referrer-policy'),'strict-origin-when-cross-origin');
 const csp=response.headers.get('content-security-policy');assert.ok(csp);
 for(const directive of ["default-src 'self'","base-uri 'none'","object-src 'none'","frame-ancestors 'none'","frame-src 'none'","form-action 'self'","script-src-attr 'none'","font-src 'self' data:"]){assert.ok(csp.includes(directive),directive);checks++;}
 const script=csp.split(';').find(x=>x.trim().startsWith('script-src '));assert.ok(!script.includes('unsafe-inline')&&!script.includes('unsafe-eval'));assert.equal(script.includes('sha256-'),swagger);
 assert.equal(response.headers.get('strict-transport-security'),hsts?'max-age=15552000':null);checks+=7;
 return csp;
}
async function api(method,url,body,status=200,token=admin,extra={},options={}){
 const response=await new Promise((resolve,reject)=>{
  const request=httpRequest(base+url,{method,headers:{...extra,...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})}},incoming=>{let text='';incoming.setEncoding('utf8');incoming.on('data',x=>text+=x);incoming.on('end',()=>resolve(new Response(method==='HEAD'||[204,205,304].includes(incoming.statusCode)?null:text,{status:incoming.statusCode,headers:incoming.headers})));});request.on('error',reject);request.end(body===undefined?undefined:JSON.stringify(body));
 });
 assert.equal(response.status,status,method+' '+url);checks++;
 headers(response,options);
 const text=method==='HEAD'||status===304?'':await response.text();let data;try{data=JSON.parse(text);}catch{data=text;}
 return {response,data};
}
try{
 await start();
 for(const url of ['/','/index.html','/hotel.html','/customer.html','/payment.html','/invoice.html','/hotel.js','/hotel.css','/fonts.css','/images/hero.jpg','/health/live','/health/ready'])await api('GET',url,undefined,200,null);
 await api('HEAD','/hotel.html',undefined,200,null);
 const asset=await api('GET','/hotel.html',undefined,200,null,trusted,{hsts:true});
 await api('GET','/hotel.html',undefined,304,null,{...trusted,'if-none-match':asset.response.headers.get('etag')},{hsts:true});
 await api('GET','/health/ready',undefined,200,null,trusted,{hsts:true});
 await api('GET','/health/ready',undefined,200,null,{...trusted,host:'localhost'});
 await api('GET','/health/ready',undefined,200,null,{...trusted,host:'127.0.0.1'});
 await api('GET','/api/Rooms',undefined,401,null,trusted,{hsts:true});
 await api('GET','/api/NoSuchRoute',undefined,404,null,trusted,{hsts:true});
 await api('GET','/api/Bookings/available-rooms?checkInDate=2026-01-01&checkOutDate=2026-01-02',undefined,400,null,trusted,{hsts:true});
 await api('POST','/hotel.html',{},405,null,trusted,{hsts:true});
 admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).data.token;
 const guest=(await api('POST','/api/CustomerAuth/register',{username:'headersguest',password:'Fixture-guest-123!',email:'headers@example.test',fullName:'Headers fixture',phone:'0901234567'},201,null)).data;
 await api('GET','/api/Rooms',undefined,403,guest.token,trusted,{hsts:true});
 const type=(await api('POST','/api/RoomTypes',{name:'Headers fixture'},201)).data;
 const room=(await api('POST','/api/Rooms',{roomNumber:'SEC1',roomTypeId:type.id,price:100000,capacity:20},201)).data;
 const today=(await api('GET','/api/HotelConfiguration')).data.today;
 const end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+1);
 const checkIn=end.toISOString().slice(0,10);end.setUTCDate(end.getUTCDate()+1);
 const booking=(await api('POST','/api/Bookings',{customerId:guest.account.customerId,roomId:room.id,guestCount:2,checkInDate:checkIn,checkOutDate:end.toISOString().slice(0,10)},201)).data;
 const bank={bankId:'MB',bankName:'Fixture bank',accountNumber:'0000000000001',accountName:'FIXTURE ONLY',sepayApiKey:'fixture-headers-key'};
 await api('POST','/api/BookingOperations/bank-config',bank);
 await writeFile(bankFile,'invalid JSON isolated fault');
 await api('GET','/api/BookingOperations/bank-config',undefined,500,null,trusted,{hsts:true});
 await api('POST','/api/BookingOperations/bank-config',bank);
 for(let i=0;i<5;i++)await api('POST','/api/CustomerAuth/login',{username:'wrong',password:'wrong'},401,null);
 await api('POST','/api/CustomerAuth/login',{username:'wrong',password:'wrong'},429,null);
 console.log('PASS: headers cover HTML/assets, HEAD/304, health short circuits, HTTPS behind proxy, localhost/HTTP exclusions and 400/401/403/404/405/429/500 errors.');

 if(process.env.HOTEL_PLAYWRIGHT_MODULE){
  const {chromium}=createRequire(import.meta.url)(process.env.HOTEL_PLAYWRIGHT_MODULE);
  browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:950}}),page=await context.newPage();
  await context.addInitScript(token=>{sessionStorage.setItem('hotel.customer.token',token);window.cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.cspViolations.push({directive:e.effectiveDirective,blocked:e.blockedURI}));},guest.token);
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  await page.route('https://img.vietqr.io/**',r=>r.fulfill({status:200,contentType:'image/png',body:image}));
  await page.goto(base+'/hotel.html');await page.locator('[data-room="'+room.id+'"]').waitFor();
  await page.waitForFunction(()=>!['loading',undefined].includes(document.querySelector('#home').dataset.fxState));
  await page.evaluate(()=>document.fonts.ready);assert.ok(await page.evaluate(()=>Array.from(document.fonts).some(x=>x.status==='loaded')));checks++;
  assert.deepEqual(await page.evaluate(()=>window.cspViolations),[]);checks++;
  await page.locator('[data-room-detail="'+room.id+'"]').first().click();await page.locator('#room-main-image').waitFor();
  await page.waitForFunction(()=>document.querySelector('#room-main-image').naturalWidth>0);checks++;
  await page.goto(base+'/customer.html');await page.locator('[data-portal-booking="'+booking.id+'"]').waitFor();assert.deepEqual(await page.evaluate(()=>window.cspViolations),[]);checks++;
  await page.goto(base+'/payment.html?bookingId='+booking.id);await page.waitForFunction(()=>document.querySelector('#qr-image').naturalWidth>0&&!document.querySelector('#qr-image').hidden);
  assert.deepEqual(await page.evaluate(()=>window.cspViolations),[]);checks++;
  const adminUser=(await api('GET','/api/Auth/me')).data;
  await context.addInitScript(session=>{sessionStorage.setItem('hotel.token',session.token);sessionStorage.setItem('hotel.user',JSON.stringify(session.user));},{token:admin,user:adminUser});
  await page.goto(base+'/index.html');await page.locator('[data-act="booking-add"]').waitFor();await page.locator('[data-view="settings"]').click();await page.getByText('Tài khoản của tôi',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.cspViolations),[]);checks++;
  // Test real parser/CSP enforcement, rather than merely checking header text.
  await page.evaluate(()=>{const script=document.createElement('script');script.textContent='window.injectedScriptRan=true';document.head.append(script);});
  await page.waitForFunction(()=>window.cspViolations.some(x=>x.directive.startsWith('script-src')));
  assert.equal(await page.evaluate(()=>window.injectedScriptRan===true),false);checks++;
  await context.close();
  const framingContext=await browser.newContext(),framingPage=await framingContext.newPage();
  const frameErrors=[];framingPage.on('console',m=>{if(m.type()==='error')frameErrors.push(m.text());});
  attacker=createHttpServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><iframe src="'+base+'/hotel.html"></iframe>');}).listen(0,'127.0.0.1');await once(attacker,'listening');
  await framingPage.goto('http://127.0.0.1:'+attacker.address().port);
  for(let i=0;i<40&&!frameErrors.some(x=>/frame-ancestors|X-Frame-Options/i.test(x));i++)await framingPage.waitForTimeout(100);
  assert.ok(frameErrors.some(x=>/frame-ancestors|X-Frame-Options/i.test(x)));checks++;
  await framingContext.close();await new Promise(r=>attacker.close(r));attacker=null;
  console.log('PASS: browser enforces CSP/iframe blocking while guest/staff pages, local fonts, 3D modules, room images and mocked VietQR load without CSP violations.');
 }
 await start('Development');
 const swagger=await api('GET','/swagger/index.html',undefined,200,null,{}, {swagger:true});
 const csp=swagger.response.headers.get('content-security-policy');
 for(const script of [...swagger.data.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(x=>!x[1].includes('src=')&&x[2].trim())){
  const hash=createHash('sha256').update(script[2].replace(/\r\n?/g,'\n')).digest('base64');assert.ok(csp.includes("'sha256-"+hash+"'"),'Swagger initializer hash changed. Recheck the pinned CSP hashes.');checks++;
 }
 await api('GET','/hotel.html',undefined,200,null,trusted);
 if(browser){const context=await browser.newContext(),page=await context.newPage();const violations=[];
  await page.addInitScript(()=>{window.cspViolations=[];document.addEventListener('securitypolicyviolation',e=>window.cspViolations.push(e.effectiveDirective));});
  page.on('pageerror',e=>violations.push(e.message));await page.goto(base+'/swagger/index.html');await page.locator('.swagger-ui .info').waitFor();
  assert.deepEqual(await page.evaluate(()=>window.cspViolations),[]);assert.deepEqual(violations,[]);checks+=2;await context.close();
 }
 console.log(`PASS: ${checks} security header/CSP/HSTS checks, including pinned Swagger initialization without unsafe-inline scripts.`);
}finally{await browser?.close();if(attacker)await new Promise(r=>attacker.close(r));await stop();await rm(root,{recursive:true,force:true});}

import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,writeFile,rename,readdir,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {request as httpRequest} from 'node:http';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomBytes,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dll=process.env.HOTEL_TEST_DLL||path.join(project,'bin/Debug/net8.0/HotelManagementAPI.dll');
const root=await mkdtemp(path.join(tmpdir(),'hotel-deployment-'));
const content=path.join(root,'content'),state=path.join(root,'state');await mkdir(content);await mkdir(state);
const bootstrap=path.join(root,'bootstrap.txt'),scrapeFile=path.join(root,'scrape.txt');
const initial='Isolated-deployment-initial-123!',password='Isolated-deployment-final-456!',scrape=randomBytes(32).toString('hex');
await writeFile(bootstrap,initial+'\n');await writeFile(scrapeFile,scrape+'\n');
const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(resolve=>socket.close(resolve));
let server,closed,logs='',allLogs='',token,checks=0;
const trusted={'x-forwarded-for':'198.51.100.10','x-forwarded-proto':'https',host:'hotel.test'};
const day=(zone,offset=0)=>{const day=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10)};
async function stop(){if(server&&server.exitCode===null){server.kill();await closed}server=null}
async function start({proxy='127.0.0.1',enabled=true,https=true,zone='Asia/Ho_Chi_Minh',environment='Production',failed=false}={}){
 await stop();logs='';
 const args=[dll,'--contentRoot',content,'--webroot',path.join(project,'wwwroot'),'--urls',base,'--environment',environment,
  '--Storage:DataDirectory',state,'--BootstrapAdmin:PasswordFile',bootstrap,'--Monitoring:ScrapeKeyFile',scrapeFile,
  '--Payments:BankConfigFile',path.join(state,'bank-config.json'),'--Hotel:TimeZone',zone,'--Deployment:RequireHttps',String(https),
  '--ReverseProxy:Enabled',String(enabled),'--CustomerEmail:Mode','Pickup','--CustomerEmail:PublicBaseUrl',base];
 if(proxy)args.push('--ReverseProxy:KnownProxies:0',proxy);
 server=spawn('dotnet',args,{cwd:content,env:{...process.env,TZ:'UTC'},stdio:['ignore','pipe','pipe']});
 closed=once(server,'close');for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{logs+=data;allLogs+=data});
 for(let i=0;i<100;i++){
  if(server.exitCode!==null){await closed;assert.ok(failed,'Temporary deployment server must start.');return}
  let response;try{response=await fetch(base+'/health/live',{signal:AbortSignal.timeout(1000)})}catch{}
  if(response?.status===200){assert.equal(failed,false);return}
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 throw Error('Temporary deployment server did not become ready.');
}
async function api(method,route,body,status=200,auth=token,headers=trusted){
 const response=await new Promise((resolve,reject)=>{
  const request=httpRequest(base+route,{method,headers:{...headers,...(body===undefined?{}:{'content-type':'application/json'}),...(auth?{authorization:'Bearer '+auth}:{})}},response=>{
   let raw='';response.setEncoding('utf8');response.on('data',data=>raw+=data);
   response.on('end',()=>resolve(new Response([204,205,304].includes(response.statusCode)?null:raw,{status:response.statusCode,headers:response.headers})));
  });request.on('error',reject);request.end(body===undefined?undefined:JSON.stringify(body));
 });
 assert.equal(response.status,status,`${method} ${route}: expected ${status}, got ${response.status}`);checks++;
 const raw=await response.text();let data;try{data=JSON.parse(raw)}catch{data=raw}
 return {response,data,raw};
}
async function metrics(){return (await api('GET','/metrics',undefined,200,scrape,{})).raw}
try{
 await start();
 for(const probe of ['/health/live','/health/ready']){
  const health=await api('GET',probe,undefined,200,undefined,{});
  assert.deepEqual(health.data,{status:'Healthy'});assert.equal(health.response.headers.get('cache-control'),'no-store');
 }
 const redirected=await api('GET','/api/Rooms',undefined,307,undefined,{host:'hotel.test'});
 assert.equal(redirected.response.headers.get('location'),'https://hotel.test/api/Rooms');
 const asset=await api('GET','/index.html',undefined,200,undefined,trusted);
 assert.match(asset.response.headers.get('strict-transport-security'),/max-age=/);
 const session=(await api('POST','/api/Auth/login',{username:'admin',password:initial},200,undefined)).data;
 assert.equal(session.user.mustChangePassword,true);
 await api('POST','/api/Auth/change-password',{oldPassword:initial,newPassword:password},200,session.token);
 token=(await api('POST','/api/Auth/login',{username:'admin',password},200,undefined)).data.token;
 await api('GET','/api/Rooms');
 await api('GET','/metrics',undefined,401,undefined,{});await api('GET','/metrics',undefined,401,'wrong',{});
 assert.match(await metrics(),/^hotel_ready 1$/m);
 assert.match(await metrics(),/hotel_api_requests_total\{status_class="2xx"\} [1-9]/);
 assert.ok(!logs.includes(initial)&&!logs.includes(password)&&!logs.includes(scrape));
 const config=(await api('GET','/api/HotelConfiguration',undefined,200,undefined)).data;
 assert.equal(config.timeZone,'Asia/Ho_Chi_Minh');assert.equal(config.today,day(config.timeZone));
 const files=await readdir(state);assert.ok(files.includes('hotel.db')&&files.includes('jwt.key')&&files.includes('data-protection-keys'));
 assert.ok(!(await readdir(content)).includes('hotel.db'));
 const healthProcess=spawn('dotnet',[dll,'--healthcheck'],{cwd:content,env:{...process.env,HEALTHCHECK_URL:base+'/health/ready'},stdio:'ignore'});
 assert.equal((await once(healthProcess,'exit'))[0],0);
 console.log('PASS: HTTPS redirect/HSTS, explicit proxy trust, private authenticated metrics, readiness and container healthcheck command; state files stay in the data directory.');

 for(let i=0;i<5;i++)await api('POST','/api/Auth/login',{username:'unknown',password:'wrong'},401,undefined,{...trusted,'x-forwarded-for':'198.51.100.11'});
 await api('POST','/api/Auth/login',{username:'unknown',password:'wrong'},429,undefined,{...trusted,'x-forwarded-for':'198.51.100.11'});
 await api('POST','/api/Auth/login',{username:'unknown',password:'wrong'},401,undefined,{...trusted,'x-forwarded-for':'198.51.100.12'});
 await start({proxy:'192.0.2.200'});
 await api('GET','/api/Rooms',undefined,307,undefined,trusted);
 await start({proxy:'192.0.2.200',https:false});
 for(let i=0;i<5;i++)await api('POST','/api/Auth/login',{username:'unknown',password:'wrong'},401,undefined,{...trusted,'x-forwarded-for':'198.51.100.11'});
 await api('POST','/api/Auth/login',{username:'unknown',password:'wrong'},429,undefined,{...trusted,'x-forwarded-for':'198.51.100.12'});
 await start({enabled:false});await api('GET','/api/Rooms',undefined,307,undefined,trusted);
 console.log('PASS: trusted forwarded client IPs have separate rate limits; unknown/disabled proxies cannot spoof HTTPS or escape the shared peer-IP limit.');

 const hostDay=day(Intl.DateTimeFormat().resolvedOptions().timeZone);
 const zone=['Pacific/Honolulu','Pacific/Kiritimati'].find(zone=>day(zone)!==hostDay);assert.ok(zone);
 await start({zone});
 const timezone=(await api('GET','/api/HotelConfiguration',undefined,200,undefined)).data;
 assert.equal(timezone.timeZone,zone);assert.equal(timezone.today,day(zone));assert.notEqual(timezone.today,hostDay);
 const customer=(await api('POST','/api/Customers',{fullName:'Deployment customer'},201)).data;
 assert.equal(customer.createdAt.slice(0,10),day(zone));
 const type=(await api('POST','/api/RoomTypes',{name:'Deployment room type'},201)).data;
 const room=(await api('POST','/api/Rooms',{roomNumber:'DEP101',roomTypeId:type.id,price:100000},201)).data;
 await api('POST','/api/Bookings',{customerId:customer.id,roomId:room.id,checkInDate:day(zone,-1),checkOutDate:day(zone,1)},400);
 const booking=(await api('POST','/api/Bookings',{customerId:customer.id,roomId:room.id,checkInDate:day(zone),checkOutDate:day(zone,1)},201)).data;
 await api('POST','/api/Bookings/'+booking.id+'/check-in');
 const service=(await api('POST','/api/Services',{name:'Deployment service',unit:'Unit',price:1},201)).data;
 const usage=(await api('POST','/api/Services/usage',{requestId:randomUUID(),bookingId:booking.id,serviceId:service.id,quantity:1},201)).data;
 assert.equal(usage.usedAt.slice(0,10),day(zone));
 const audit=(await api('GET','/api/Administration/audit')).data;
 for(const [entity,id] of [['Customer',customer.id],['Booking',booking.id],['ServiceUsage',usage.id]]){
  const row=audit.items.find(row=>row.entity===entity&&row.entityId===String(id));
  assert.ok(row);assert.equal(row.createdAt.slice(0,10),day(zone));
 }
 const backup=(await api('POST','/api/Administration/backups')).data;
 assert.equal(backup.createdAt.slice(0,10),day(zone));assert.ok(backup.fileName.startsWith('hotel-'+day(zone).replaceAll('-','')));
 if(process.env.HOTEL_DEPLOYMENT_UI==='1'){
  const require=createRequire(import.meta.url),module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';
  const {chromium}=require(module),{expect}=require(module+'/test');
  const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  try{
   const context=await browser.newContext({timezoneId:'America/Los_Angeles',extraHTTPHeaders:{'x-forwarded-for':trusted['x-forwarded-for'],'x-forwarded-proto':'https'}});
   await context.addInitScript(session=>{sessionStorage.setItem('hotel.token',session.token);sessionStorage.setItem('hotel.user',JSON.stringify(session.user))},{token,user:{username:'admin',role:'Admin'}});
   const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
   await page.goto(base);await page.locator('[data-act="booking-add"]').click();
   await expect(page.locator('#f-checkInDate')).toHaveValue(day(zone));await expect(page.locator('#f-checkInDate')).toHaveAttribute('min',day(zone));
   await page.goto(base+'/hotel.html');await expect(page.locator('[name="checkInDate"]')).toHaveValue(day(zone));
   assert.deepEqual(errors,[]);
  }finally{await browser.close()}
  console.log('PASS: browsers in another time zone use the configured hotel calendar for staff and guest booking forms.');
 }
 console.log('PASS: hotel calendar differs from the host calendar consistently across booking validation, check-in, new entity timestamps, audit and backups.');

 await stop();
 const backupPath=path.join(state,'App_Data','backups');assert.ok(path.resolve(backupPath).startsWith(path.resolve(root)+path.sep));
 await rename(backupPath,backupPath+'-saved');await writeFile(backupPath,'Isolated backup fault fixture');
 const stale=new DatabaseSync(path.join(state,'hotel.db'));
 try{stale.prepare('UPDATE DatabaseBackups SET CreatedAt = ?').run(day(zone,-2)+' 00:00:00')}finally{stale.close()}
 await start({zone});
 const failedBackup=await api('POST','/api/Administration/backups',undefined,500);
 assert.ok(failedBackup.data.traceId);assert.ok(!JSON.stringify(failedBackup.data).includes(backupPath));
 assert.match(await metrics(),/hotel_api_requests_total\{status_class="5xx"\} [1-9]/);
 assert.match(await metrics(),/hotel_background_failures_total\{operation="backup"\} [1-9]/);
 const db=new DatabaseSync(path.join(state,'hotel.db'));
 try{db.exec('ALTER TABLE Users RENAME TO Users_unavailable')}finally{db.close()}
 await api('GET','/health/live',undefined,200,undefined,{});
 const notReady=await api('GET','/health/ready',undefined,503,undefined,{});assert.deepEqual(notReady.data,{status:'Unhealthy'});
 assert.match(await metrics(),/^hotel_ready 0$/m);
 const restore=new DatabaseSync(path.join(state,'hotel.db'));try{restore.exec('ALTER TABLE Users_unavailable RENAME TO Users')}finally{restore.close()}
 await api('GET','/health/ready',undefined,200,undefined,{});
 assert.ok(!allLogs.includes(initial)&&!allLogs.includes(password)&&!allLogs.includes(scrape)&&!allLogs.includes(token));
 assert.ok(allLogs.includes(failedBackup.data.traceId));
 const jsonLogs=logs.split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));assert.ok(jsonLogs.some(line=>line.LogLevel==='Error'));
 console.log('PASS: real API/background failures are counted with trace IDs and structured logs; readiness detects missing application schema while liveness stays healthy; no credentials appear in telemetry.');
 await stop();await writeFile(path.join(state,'App_Data','mail'),'Isolated email fault fixture');
 await start({zone,environment:'Development',enabled:false,https:false});
 const recoveryEmail='recovery-sensitive@example.test';
 await api('POST','/api/CustomerAuth/register',{username:'deploymentguest',password:'Deployment-guest-123',fullName:'Deployment Guest',phone:'0901234567',email:recoveryEmail},201,undefined,{});
 await api('POST','/api/CustomerAuth/forgot-password',{email:recoveryEmail},200,undefined,{});
 assert.match(await metrics(),/hotel_background_failures_total\{operation="email"\} [1-9]/);
 assert.ok(!logs.includes(recoveryEmail));
 console.log('PASS: failed recovery email delivery increments monitoring without logging the recipient or reset token.');
 await start({proxy:null,failed:true});assert.match(logs,/KnownProxies/);
 await start({zone:'Not-A-Time-Zone',failed:true});
 console.log(`Deployment: ${checks} HTTP checks plus healthcheck, storage, proxy, clock, fault and configuration checks passed.`);
}finally{
 await stop();const resolved=path.resolve(root);
 if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('hotel-deployment-'))throw Error('Unsafe cleanup path');
 await rm(resolved,{recursive:true,force:true});console.log('Temporary deployment servers, secrets and data removed. Project data was not used.');
}

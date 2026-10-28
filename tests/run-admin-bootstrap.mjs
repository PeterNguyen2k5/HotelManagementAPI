import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=await mkdtemp(path.join(tmpdir(),'hotel-admin-bootstrap-'));
const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(resolve=>socket.close(resolve));
let server,closed,output='',number=0,checks=0;
async function stop(){if(server&&server.exitCode===null){server.kill();await closed}server=null}
async function start(root,initial,failed=false,environment='Production'){
 await stop();output='';
 const env={...process.env,ASPNETCORE_ENVIRONMENT:environment,DOTNET_ENVIRONMENT:environment};
 delete env.BootstrapAdmin__Password;delete env['BootstrapAdmin:Password'];
 if(initial!==undefined)env.BootstrapAdmin__Password=initial;
 server=spawn('dotnet',[process.env.HOTEL_TEST_DLL||path.join(project,'bin/Debug/net8.0/HotelManagementAPI.dll'),'--contentRoot',root,
  '--webroot',path.join(project,'wwwroot'),'--urls',base,'--environment',environment,
  '--ConnectionStrings:DefaultConnection',`Data Source=${path.join(root,'hotel.db')};Default Timeout=1`,'--Deployment:RequireHttps','false'],
  {cwd:root,env,stdio:['ignore','pipe','pipe']});
 closed=once(server,'close');server.stdout.on('data',data=>output+=data);server.stderr.on('data',data=>output+=data);
 for(let i=0;i<100;i++){
  if(server.exitCode!==null){await closed;assert.ok(failed,'Configured application should start.');assert.notEqual(server.exitCode,0);return}
  let response;try{response=await fetch(base+'/api/NoSuchRoute',{signal:AbortSignal.timeout(1000)})}catch{}
  if(response?.status===404){assert.equal(failed,false,'Invalid bootstrap must never start listening.');return}
  await new Promise(resolve=>setTimeout(resolve,200));
 }
 throw Error('Bootstrap test startup timed out.');
}
async function api(method,route,body,status=200,token){
 const response=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal(response.status,status,`${method} ${route}: expected ${status}, got ${response.status}`);checks++;
 return {response,data:response.status===204?null:await response.json()};
}
const login=async(password,status=200,username='admin')=>(await api('POST','/api/Auth/login',{username,password},status)).data;
const change=(session,oldPassword,newPassword,status=200)=>api('POST','/api/Auth/change-password',{oldPassword,newPassword},status,session.token);
const initial='Isolated-initial-admin-123!';
const finalPassword='Isolated-final-admin-456!';
try{
 for(const [value,environment] of [[undefined,'Production'],['admin123','Production'],['too-short','Production'],['á'.repeat(40),'Production'],[undefined,'Development']]){
  const root=path.join(runtime,'invalid-'+(++number));await mkdir(root);await start(root,value,true,environment);
  assert.match(output,/BootstrapAdmin__Password/);
  if(value)assert.ok(!output.includes(value),'Do not log the rejected password.');
  const db=new DatabaseSync(path.join(root,'hotel.db'));try{assert.equal(db.prepare('SELECT COUNT(*) AS count FROM Users').get().count,0)}finally{db.close()}
 }
 console.log('PASS: new installations fail closed on missing/default/weak/oversized bootstrap passwords; no user is created and passwords are not logged.');
 if(process.env.HOTEL_ADMIN_UI==='1'){
  const uiRoot=path.join(runtime,'browser');await mkdir(uiRoot);await start(uiRoot,initial);
  const require=createRequire(import.meta.url);
  const module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';
  const {chromium}=require(module),{expect}=require(module+'/test');
  const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  try{
   const page=await browser.newPage();page.setDefaultTimeout(10000);
   const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>requests.push(new URL(request.url()).pathname));
   await page.goto(base);await page.locator('#username').fill('admin');await page.locator('#password').fill(initial);
   await page.locator('#login-form [type="submit"]').click();
   await expect(page.locator('#required-password-form')).toBeVisible();
   assert.ok(!requests.includes('/api/Rooms')&&!requests.includes('/api/Notifications'),'No business requests before completing the first password change.');
   const initialToken=await page.evaluate(()=>sessionStorage.getItem('hotel.token'));
   await page.evaluate(()=>{const user=JSON.parse(sessionStorage.getItem('hotel.user'));user.mustChangePassword=false;sessionStorage.setItem('hotel.user',JSON.stringify(user))});
   await page.reload();await expect(page.locator('#required-password-form')).toBeVisible();
   for(const width of [390,1440]){
    await page.setViewportSize({width,height:1000});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    if(process.env.HOTEL_UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.HOTEL_UI_SCREENSHOT_DIR,`admin-first-password-${width}.png`),fullPage:true});
   }
   await page.locator('#initial-password').fill(initial);
   const changesBefore=requests.filter(p=>p==='/api/Auth/change-password').length;
   await page.locator('#initial-new-password').fill('á'.repeat(37));await page.locator('#initial-confirm-password').fill('á'.repeat(37));
   await page.locator('#required-password-form [type="submit"]').click();
   await expect(page.locator('#required-password-error')).toContainText('72 byte UTF-8');
   assert.equal(requests.filter(p=>p==='/api/Auth/change-password').length,changesBefore,'Do not send oversized first-change passwords.');
   await page.locator('#initial-password').fill(initial+'x'.repeat(72));
   await page.locator('#initial-new-password').fill(finalPassword);await page.locator('#initial-confirm-password').fill(finalPassword);
   await page.locator('#required-password-form [type="submit"]').click();
   await expect(page.locator('#required-password-error')).toContainText('72 byte UTF-8');
   assert.equal(requests.filter(p=>p==='/api/Auth/change-password').length,changesBefore,'Do not verify a truncated old password.');
   await page.locator('#initial-password').fill(initial);await page.locator('#initial-new-password').fill(finalPassword);await page.locator('#initial-confirm-password').fill('Does-not-match-123!');
   await page.locator('#required-password-form [type="submit"]').click();await expect(page.locator('#required-password-error')).toContainText('chưa khớp');
   await page.locator('#initial-confirm-password').fill(finalPassword);await page.locator('#required-password-form [type="submit"]').click();
   await expect(page.locator('#login-form')).toBeVisible();await api('GET','/api/Auth/me',undefined,401,initialToken);
   await page.locator('#username').fill('admin');await page.locator('#password').fill(finalPassword);await page.locator('#login-form [type="submit"]').click();
   await expect(page.locator('.shell')).toBeVisible();await expect(page.locator('#required-password-form')).toHaveCount(0);
   assert.deepEqual(errors,[]);
   console.log('PASS: Edge enforces the first-password screen, reload ignores tampered browser state, confirmation works, and signing in again opens administration. Layouts fit 390/1440 px.');
  }finally{await browser.close()}
 }
 const root=path.join(runtime,'valid');await mkdir(root);await start(root,initial);
 await login('admin123',401);
 let pending=await login(initial);assert.equal(pending.user.mustChangePassword,true);
 assert.equal(pending.user.passwordHash,undefined);
 assert.ok(!JSON.stringify(pending).includes(initial));
 assert.equal((await api('GET','/API/auth/ME/',undefined,200,pending.token)).data.mustChangePassword,true);
 for(const [method,route,body] of [
  ['GET','/api/Rooms'],['GET','/api/Users'],['GET','/api/Notifications'],['GET','/api/Administration/backups'],
  ['GET','/api/BookingOperations/1/invoice'],['GET','/api/BookingOperations/bank-config'],
  ['POST','/api/Auth/register',{username:'bypass',password:'Example12345',fullName:'Bypass'}],
  ['PUT','/api/Users/'+pending.user.id,{fullName:'Bypass',role:'Admin',isActive:true,mustChangePassword:false}]
 ]){
  const blocked=await api(method,route,body,403,pending.token);
  assert.equal(blocked.data.code,'PASSWORD_CHANGE_REQUIRED');assert.equal(blocked.data.mustChangePassword,true);
  assert.equal(blocked.response.headers.get('cache-control'),'no-store');
 }
 await start(root,undefined);
 assert.equal((await api('GET','/api/Auth/me',undefined,200,pending.token)).data.mustChangePassword,true);
 await api('GET','/api/Rooms',undefined,403,pending.token);
 await change(pending,initial,initial,400);await change(pending,initial,'short',400);
 await change(pending,initial,'admin123',400);await change(pending,initial,'á'.repeat(40),400);
 await change(pending,initial,finalPassword);
 await api('GET','/api/Auth/me',undefined,401,pending.token);
 await login(initial,401);
 let admin=await login(finalPassword);assert.equal(admin.user.mustChangePassword,false);
 await api('GET','/api/Rooms',undefined,200,admin.token);
 await change(admin,finalPassword,'admin123',400);
 const extra=(await api('POST','/api/Users',{username:'anotheradmin',password:'Another-initial-123!',fullName:'Another Admin',role:'Admin',mustChangePassword:false},201,admin.token)).data;
 assert.equal(extra.mustChangePassword,true);
 const extraSession=await login('Another-initial-123!',200,'anotheradmin');
 await api('GET','/api/Rooms',undefined,403,extraSession.token);
 await start(root,'Different-bootstrap-789!');
 admin=await login(finalPassword);await login('Different-bootstrap-789!',401);
 assert.equal(admin.user.mustChangePassword,false);await api('GET','/api/Rooms',undefined,200,admin.token);
 console.log('PASS: first-login restriction is enforced by API across restart and cannot be cleared through user updates; a real password change revokes the initial JWT and unlocks administration. Bootstrap configuration never overwrites existing credentials.');

 // Reconstruct an installation from the preceding schema using only the temporary database.
 const legacy=(await api('POST','/api/Users',{username:'legacyadmin',password:'admin123',fullName:'Legacy Admin',role:'Admin'},201,admin.token)).data;
 await stop();
 let db=new DatabaseSync(path.join(root,'hotel.db'));
 try{
  db.prepare('UPDATE Users SET Username = ? WHERE Id = ?').run('secureadmin',admin.user.id);
  db.prepare('UPDATE Users SET Username = ?, MustChangePassword = 0 WHERE Id = ?').run('admin',legacy.id);
 }finally{db.close()}
 await start(root,undefined);
 pending=await login('admin123');assert.equal(pending.user.mustChangePassword,true);
 // This token remains cryptographically valid, so enforcement must read the database flag.
 await stop();db=new DatabaseSync(path.join(root,'hotel.db'));
 try{
  db.exec('ALTER TABLE Users DROP COLUMN MustChangePassword');
  db.prepare('DELETE FROM __EFMigrationsHistory WHERE MigrationId LIKE ?').run('%RequireInitialAdminPasswordChange');
 }finally{db.close()}
 await start(root,undefined);
 await api('GET','/api/Rooms',undefined,403,pending.token);
 assert.equal((await api('GET','/api/Auth/me',undefined,200,pending.token)).data.mustChangePassword,true);
 const secure=await login(finalPassword,200,'secureadmin');assert.equal(secure.user.mustChangePassword,false);
 await api('GET','/api/Rooms',undefined,200,secure.token);
 await change(pending,'admin123','Legacy-final-admin-456!');
 await api('GET','/api/Auth/me',undefined,401,pending.token);
 const migrated=await login('Legacy-final-admin-456!');assert.equal(migrated.user.mustChangePassword,false);
 assert.ok(!output.includes(initial)&&!output.includes(finalPassword));
 console.log('PASS: the existing schema migrates without data loss; legacy admin/admin123 is restricted while secure administrators retain access.');
 console.log(`Administrator bootstrap: ${checks} API checks and five startup-failure cases passed using temporary data.`);
}finally{
 await stop();const resolved=path.resolve(runtime);
 if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('hotel-admin-bootstrap-'))throw Error('Unsafe cleanup path');
 await rm(resolved,{recursive:true,force:true});console.log('Temporary bootstrap servers/databases removed. Live hotel data was not used.');
}

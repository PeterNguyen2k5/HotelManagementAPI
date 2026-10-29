import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHmac} from 'node:crypto';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=await mkdtemp(path.join(tmpdir(),'hotel-session-lifecycle-')),database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(resolve=>socket.close(resolve));
let server,admin,checks=0;
async function stop(){if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}server=null;}
async function start(){await stop();server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root]});}
async function api(method,route,body,status=200,token=admin){
 const response=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${method} ${route}: expected ${status}, got ${response.status}`);checks++;
 return {status:response.status,data:response.status===204?null:await response.json()};
}
const login=async(username,password,status=200)=>(await api('POST','/api/Auth/login',{username,password},status,null)).data;
const me=(session,status=200)=>api('GET','/api/Auth/me',undefined,status,session.token);
function dbUser(id){const sql=new DatabaseSync(database);try{return sql.prepare('SELECT * FROM Users WHERE Id=?').get(id);}finally{sql.close();}}
try{
 await start();const rootSession=await login('admin',testAdminPassword);admin=rootSession.token;
 const password='Lifecycle-staff-password-123!';
 const staff=(await api('POST','/api/Users',{username:'lifecycle',password,fullName:'Nhân viên vòng đời',role:'Receptionist',sessionVersion:-1},201)).data;
 const other=(await api('POST','/api/Users',{username:'unaffected',password,fullName:'Nhân viên khác',email:'other@example.test',role:'Receptionist'},201)).data;
 const first=await login(staff.username,password),second=await login(staff.username,password),otherSession=await login(other.username,password);
 assert.equal(staff.sessionVersion,undefined);assert.equal(dbUser(staff.id).SessionVersion,0);
 const guest=(await api('POST','/api/CustomerAuth/register',{username:'lifecycleguest',password:'Customer-fixture-123!',fullName:'Khách thử',phone:'0901234567',email:'lifecycle@example.test'},201,null)).data;
 const update=(values={},status=200)=>api('PUT','/api/Users/'+staff.id,{fullName:staff.fullName,role:'Receptionist',isActive:true,...values},status);

 // Simulate the previous schema/token format using only fixture credentials/signing key.
 const legacyData=dbUser(staff.id),key=await readFile(path.join(root,'jwt.key'));
 const legacyPayload=JSON.parse(Buffer.from(first.token.split('.')[1],'base64url'));
 legacyPayload.staff_credential_stamp=createHmac('sha256',key).update(`HotelManagementAPI:staff-session:v1:${staff.id}:${legacyData.PasswordHash}`).digest('hex').toUpperCase();
 const unsigned=first.token.split('.')[0]+'.'+Buffer.from(JSON.stringify(legacyPayload)).toString('base64url');
 const legacyToken=unsigned+'.'+createHmac('sha256',key).update(unsigned).digest('base64url');
 await stop();const sql=new DatabaseSync(database);try{sql.exec('ALTER TABLE Users DROP COLUMN SessionVersion');sql.prepare('DELETE FROM __EFMigrationsHistory WHERE MigrationId LIKE ?').run('%AddStaffSessionVersion');}finally{sql.close();}
 await start();assert.equal(dbUser(staff.id).PasswordHash,legacyData.PasswordHash);assert.equal(dbUser(staff.id).SessionVersion,0);
 await me({token:legacyToken},401);await me(first);await api('GET','/api/CustomerAuth/me',undefined,200,guest.token);

 await update({fullName:'Hồ sơ đã sửa',email:'changed@example.test',sessionVersion:12345});
 await me(first);await me(second);assert.equal(dbUser(staff.id).SessionVersion,0);
 await api('DELETE','/api/Users/'+rootSession.user.id,undefined,409);
 await api('PUT','/api/Users/'+rootSession.user.id,{fullName:'Root',role:'Receptionist',isActive:true},409);
 await api('DELETE','/api/Users/'+staff.id,undefined,204);
 const disabledVersion=dbUser(staff.id).SessionVersion;assert.equal(disabledVersion,1);
 await api('DELETE','/api/Users/'+staff.id,undefined,204);assert.equal(dbUser(staff.id).SessionVersion,disabledVersion);
 await me(first,401);await me(second,401);await login(staff.username,password,401);
 await update();assert.equal(dbUser(staff.id).SessionVersion,2);
 await me(first,401);await me(second,401);await me(otherSession);await api('GET','/api/CustomerAuth/me',undefined,200,guest.token);
 await start();await me(first,401);await me(second,401);
 const reopened=await login(staff.username,password);await me(reopened);assert.notEqual(reopened.token,first.token);
 await update({role:'Admin'});assert.equal(dbUser(staff.id).SessionVersion,3);await me(reopened,401);
 const promoted=await login(staff.username,password);await api('GET','/api/Reports/rooms',undefined,200,promoted.token);
 await update();assert.equal(dbUser(staff.id).SessionVersion,4);await me(promoted,401);
 await update({role:'Admin'});assert.equal(dbUser(staff.id).SessionVersion,5);await me(promoted,401);
 const restored=await login(staff.username,password);await me(restored);
 await update({role:'Admin',isActive:false});assert.equal(dbUser(staff.id).SessionVersion,6);await me(restored,401);
 await update({role:'Admin'});assert.equal(dbUser(staff.id).SessionVersion,7);await me(restored,401);
 const active=await login(staff.username,password);await me(active);
 // Failure must roll back both the role change and revocation version.
 await update({email:'other@example.test'},409);assert.equal(dbUser(staff.id).SessionVersion,7);await me(active);
 await start();await me(active);for(const session of [first,second,reopened,promoted,restored])await me(session,401);
 await me(otherSession);await api('GET','/api/CustomerAuth/me',undefined,200,guest.token);
 const locks=await Promise.all([api('DELETE','/api/Users/'+staff.id,undefined,[204,409]),api('DELETE','/api/Users/'+staff.id,undefined,[204,409])]);
 assert.ok(locks.some(x=>x.status===204));assert.equal(dbUser(staff.id).SessionVersion,8);
 await update({role:'Admin'});assert.equal(dbUser(staff.id).SessionVersion,9);await me(active,401);
 const beforeRoleRace=await login(staff.username,password);
 const roleRace=await Promise.all([update(),update({role:'Admin'})]);assert.ok(roleRace.every(x=>x.status===200));
 const raceVersion=dbUser(staff.id).SessionVersion;assert.ok(raceVersion>=10&&raceVersion<=11);await me(beforeRoleRace,401);
 await update({role:'Admin'});
 const finalAdmin=await login(staff.username,password);
 // Two admins disabling each other must not remove all active administrators.
 const crossDisable=await Promise.all([api('DELETE','/api/Users/'+staff.id,undefined,[204,401,409]),api('DELETE','/api/Users/'+rootSession.user.id,undefined,[204,401,409],finalAdmin.token)]);
 assert.equal(crossDisable.filter(x=>x.status===204).length,1);
 const remaining=new DatabaseSync(database);try{assert.ok(remaining.prepare("SELECT COUNT(*) AS count FROM Users WHERE Role='Admin' AND IsActive=1").get().count>=1);}finally{remaining.close();}
 console.log(`PASS: ${checks} lifecycle API checks: old JWT remains revoked after DELETE/PUT lock-unlock and role reversal, restart persistence, unchanged profiles/passwords, unaffected sessions, failed-update rollback, concurrent mutations and previous-schema/v1-token upgrade.`);
 if(process.env.HOTEL_STAFF_SESSION_UI==='1'){
  await start();
  const sql=new DatabaseSync(database);let survivor;try{survivor=sql.prepare("SELECT Username FROM Users WHERE Role='Admin' AND IsActive=1 LIMIT 1").get().Username;}finally{sql.close();}
  admin=(await login(survivor,survivor==='admin'?testAdminPassword:password)).token;
  const uiUser=(await api('POST','/api/Users',{username:'uisession',password,fullName:'UI session fixture',role:'Receptionist'},201)).data;
  const require=createRequire(import.meta.url),module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';
  const {chromium}=require(module),{expect}=require(module+'/test');
  const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  try{
   const page=await browser.newPage();page.setDefaultTimeout(15000);
   await page.goto(base);await page.locator('#username').fill(uiUser.username);await page.locator('#password').fill(password);await page.locator('#login-form [type="submit"]').click();
   await expect(page.locator('.dashboard-head')).toBeVisible();
   const oldToken=await page.evaluate(()=>sessionStorage.getItem('hotel.token'));
   await api('DELETE','/api/Users/'+uiUser.id,undefined,204);
   await api('PUT','/api/Users/'+uiUser.id,{fullName:uiUser.fullName,role:'Receptionist',isActive:true});
   await page.reload();await expect(page.locator('#login-form')).toBeVisible();
   assert.equal(await page.evaluate(()=>sessionStorage.getItem('hotel.token')),null);
   await api('GET','/api/Rooms',undefined,401,oldToken);
   await page.locator('#username').fill(uiUser.username);await page.locator('#password').fill(password);await page.locator('#login-form [type="submit"]').click();await expect(page.locator('.dashboard-head')).toBeVisible();
   assert.notEqual(await page.evaluate(()=>sessionStorage.getItem('hotel.token')),oldToken);
   console.log('PASS: Edge discards the old session after lock/unlock and requires fresh sign-in before returning to staff functions.');
  }finally{await browser.close();}
 }
}finally{
 await stop();
 if(path.dirname(path.resolve(root))!==path.resolve(tmpdir())||!path.basename(root).startsWith('hotel-session-lifecycle-'))throw new Error('Unsafe cleanup path');
 await rm(root,{recursive:true,force:true});console.log('Temporary session test data removed. Live staff accounts were not changed.');
}

import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=await mkdtemp(path.join(tmpdir(),'hotel-staff-password-'));
const listener=createServer().listen(0,'127.0.0.1');await once(listener,'listening');
const base=`http://127.0.0.1:${listener.address().port}`;await new Promise(resolve=>listener.close(resolve));
let server,admin,checks=0;
const cases=[{name:'ascii',valid:'A'.repeat(72),invalid:'A'.repeat(73)},
 {name:'vietnamese',valid:'á'.repeat(36),invalid:'á'.repeat(37)},
 {name:'emoji',valid:'🔒'.repeat(18),invalid:'🔒'.repeat(18)+'x'},
 {name:'mixed',valid:'ệ'.repeat(23)+'abc',invalid:'ệ'.repeat(23)+'abcd'}];
async function stop(){if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}server=null;}
async function start(){await stop();server=await startTestServer({project,root,database:path.join(root,'hotel.db'),base,environment:'Production',extraArgs:['--Storage:DataDirectory',root]});}
async function api(method,route,body,status=200,token=admin){
 const response=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal(response.status,status,`${method} ${route}: expected ${status}, got ${response.status}`);checks++;
 return response.status===204?null:response.json();
}
function lengthError(data,password,field){
 assert.ok(data.errors?.[field]?.some(message=>message.includes('72 byte UTF-8')),'Byte-limit error should identify the field.');
 assert.ok(!JSON.stringify(data).includes(password),'Do not echo a rejected password.');
}
try{
 await start();
 admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).token;
 const accounts=[];
 for(const [route,label] of [['/api/Users','users'],['/api/Auth/register','register']]){
  for(const sample of cases){
   assert.equal(Buffer.byteLength(sample.valid,'utf8'),72);
   assert.ok(Buffer.byteLength(sample.invalid,'utf8')>72);
   const username=label+'_'+sample.name;
   const payload={username,password:sample.invalid,fullName:'Kiểm thử giới hạn mật khẩu',role:'Receptionist'};
   lengthError(await api('POST',route,payload,400),sample.invalid,'Password');
   const before=await api('GET','/api/Users');assert.equal(before.some(user=>user.username===username),false);
   const account=await api('POST',route,{...payload,password:sample.valid},201);
   accounts.push({...sample,username:account.username});
  }
 }
 for(const account of accounts){
  await start(); // Fresh rate-limit window for each independent boundary case.
  const session=await api('POST','/api/Auth/login',{username:account.username,password:account.valid},200,null);
  for(const suffix of ['X','Y']){
   const oversized=account.valid+suffix;
   lengthError(await api('POST','/api/Auth/login',{username:account.username,password:oversized},400,null),oversized,'Password');
  }
  await api('POST','/api/Auth/login',{username:account.username,password:'B'.repeat(72)},401,null);
  const oversizedOld=account.valid+'X';
  lengthError(await api('POST','/api/Auth/change-password',{oldPassword:oversizedOld,newPassword:'Valid-new-password-123!'},400,session.token),oversizedOld,'OldPassword');
  lengthError(await api('POST','/api/Auth/change-password',{oldPassword:account.valid,newPassword:account.invalid},400,session.token),account.invalid,'NewPassword');
  await api('GET','/api/Auth/me',undefined,200,session.token);
  const replacement='N'.repeat(72);
  await api('POST','/api/Auth/change-password',{oldPassword:account.valid,newPassword:replacement},200,session.token);
  await api('GET','/api/Auth/me',undefined,401,session.token);
  await api('POST','/api/Auth/login',{username:account.username,password:replacement},200,null);
 }
 await start();
 const unknownOversized='U'.repeat(73);
 lengthError(await api('POST','/api/Auth/login',{username:'missing-user',password:unknownOversized},400,null),unknownOversized,'Password');
 // Spaces are password content, not normalization: exactly 72 bytes must survive unchanged.
 const spaced=' '+('s'.repeat(70))+' ';
 await api('POST','/api/Users',{username:'spaced',password:spaced,fullName:'Space fixture',role:'Receptionist'},201);
 await api('POST','/api/Auth/login',{username:'spaced',password:spaced},200,null);
 await api('POST','/api/Auth/login',{username:'spaced',password:spaced.trim()},401,null);
 console.log(`PASS: ${checks} API checks: both staff creation routes, ASCII/Vietnamese/emoji/mixed 72-byte boundaries, different oversized suffixes, old/new password validation, no mutation on failure, JWT revocation, no secret echoes and no trimming.`);

 if(process.env.HOTEL_STAFF_PASSWORD_UI==='1'){
  await start();
  const require=createRequire(import.meta.url),module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';
  const {chromium}=require(module),{expect}=require(module+'/test');
  const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
  try{
   const page=await browser.newPage();page.setDefaultTimeout(15000);
   const sent={login:0,create:0,change:0};
   page.on('request',request=>{if(request.method()!=='POST')return;const p=new URL(request.url()).pathname;if(p==='/api/Auth/login')sent.login++;if(p==='/api/Users')sent.create++;if(p==='/api/Auth/change-password')sent.change++;});
   await page.goto(base);
   await page.locator('#username').fill('admin');await page.locator('#password').fill('á'.repeat(37));
   await page.locator('#login-form [type="submit"]').click();
   await expect(page.locator('#login-error')).toContainText('72 byte UTF-8');assert.equal(sent.login,0);
   await page.locator('#password').fill(testAdminPassword);await page.locator('#login-form [type="submit"]').click();
   await expect(page.locator('.dashboard-head')).toBeVisible();
   await page.locator('.sidebar [data-view="users"]').click();
   await page.locator('[data-act="user-add"]').click();
   await page.locator('#f-username').fill('ui-too-long');await page.locator('#f-password').fill('A'.repeat(73));await page.locator('#f-fullName').fill('UI fixture');
   assert.equal((await page.locator('#f-password').inputValue()).length,73,'Do not silently truncate pasted input.');
   await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('#modal-error')).toContainText('72 byte UTF-8');assert.equal(sent.create,0);
   await page.locator('#modal-cancel').click();
   await page.locator('[data-view="settings"]').click();await page.locator('#main [data-act="password"]').click();
   await page.locator('#f-oldPassword').fill(testAdminPassword);await page.locator('#f-newPassword').fill('🔒'.repeat(19));
   await page.locator('#modal-form [type="submit"]').click();await expect(page.locator('#modal-error')).toContainText('72 byte UTF-8');assert.equal(sent.change,0);
   console.log('PASS: Edge blocks oversized staff login/create/change before sending API requests; pasted passwords remain intact.');
  }finally{await browser.close();}
 }
}finally{
 await stop();
 if(path.dirname(path.resolve(root))!==path.resolve(tmpdir())||!path.basename(root).startsWith('hotel-staff-password-'))throw new Error('Unsafe cleanup path');
 await rm(root,{recursive:true,force:true});
 console.log('Temporary password test database/server removed. Live staff accounts were not changed.');
}

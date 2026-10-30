import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(import.meta.dirname,'..'),root=await mkdtemp(path.join(tmpdir(),'hotel-staff-management-')),database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(r=>socket.close(r));
let server,browser,checks=0,admin;
async function api(method,url,body,status=200,token=admin){const r=await fetch(base+url,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=r.status===204?null:await r.json();assert.equal(r.status,status,`${url}: ${JSON.stringify(data)}`);checks++;return data;}
try {
 server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root]});
 admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).token;
 const require=createRequire(import.meta.url),module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';const {chromium}=require(module),{expect}=require(module+'/test');
 browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/index.html');await page.locator('#username').fill('admin');await page.locator('#password').fill(testAdminPassword);await page.locator('#login-form [type=submit]').click();
 // Click before dashboard API calls finish: its old response must not replace this page.
 await page.locator('.sidebar [data-view=users]').click();await expect(page.getByRole('heading',{name:'Quản lý nhân viên',exact:true})).toBeVisible();
 await expect(page.locator('.sidebar .nav-item.active')).toHaveCount(1);checks+=2;
 await page.locator('[data-act=user-add]').click();await page.locator('#f-username').fill('managed');await page.locator('#f-password').fill('Managed-fixture-123!');await page.locator('#f-fullName').fill('Nhân viên thử');await page.locator('#f-email').fill('managed@example.test');await page.locator('#f-role').selectOption('Receptionist');await page.locator('#modal-form [type=submit]').click();await expect(page.locator('#modal')).not.toBeVisible();
 let row=page.locator('#main tbody tr').filter({hasText:'managed'});await expect(row).toContainText('Lễ tân');await expect(row).toContainText('Hoạt động');checks+=2;
 const managed=(await api('GET','/api/Users')).find(x=>x.username==='managed');assert.ok(managed);checks++;
 const before=(await api('POST','/api/Auth/login',{username:'managed',password:'Managed-fixture-123!'},200,null)).token;
 await row.getByRole('button',{name:'Sửa',exact:true}).click();await page.locator('#f-fullName').fill('Nhân viên đã sửa');await page.locator('#modal-form [type=submit]').click();await expect(row).toContainText('Nhân viên đã sửa');checks++;
 page.once('dialog',d=>d.accept());await row.getByRole('button',{name:'Khóa',exact:true}).click();await expect(row).toContainText('Đã khóa');await expect(row.getByRole('button',{name:'Mở khóa',exact:true})).toBeVisible();checks+=2;
 await api('GET','/api/Auth/me',undefined,401,before);await api('POST','/api/Auth/login',{username:'managed',password:'Managed-fixture-123!'},401,null);
 page.once('dialog',d=>d.accept());await row.getByRole('button',{name:'Mở khóa',exact:true}).click();await expect(row).toContainText('Hoạt động');checks++;
 await api('GET','/api/Auth/me',undefined,401,before);
 const reopened=(await api('POST','/api/Auth/login',{username:'managed',password:'Managed-fixture-123!'},200,null)).token;
 await api('GET','/api/Users',undefined,403,reopened);
 const self=page.locator('#main tbody tr').filter({hasText:'Tài khoản của bạn'});await expect(self.getByRole('button',{name:'Khóa',exact:true})).toHaveCount(0);checks++;
 await api('DELETE','/api/Users/1',undefined,409);
 await page.locator('.sidebar [data-view=settings]').click();await expect(page.locator('#main [data-view=users]')).toContainText('Quản lý nhân viên');await page.locator('#main [data-view=users]').click();await expect(page.getByRole('heading',{name:'Quản lý nhân viên',exact:true})).toBeVisible();checks+=2;
 if(process.env.HOTEL_UI_SCREENSHOTS){await mkdir(process.env.HOTEL_UI_SCREENSHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.HOTEL_UI_SCREENSHOTS,'staff-management-desktop.png'),fullPage:true});}
 // Restart the disposable server before a sixth login to reset the intentional login limiter.
 const stopped=once(server,'exit');server.kill();await stopped;
 server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root]});
 await api('GET','/api/Auth/me',undefined,401,before);
 const clerk=await browser.newPage();await clerk.goto(base+'/index.html');await clerk.locator('#username').fill('managed');await clerk.locator('#password').fill('Managed-fixture-123!');await clerk.locator('#login-form [type=submit]').click();await expect(clerk.locator('.dashboard-head')).toBeVisible();await expect(clerk.locator('.sidebar [data-view=users]')).toHaveCount(0);await clerk.locator('.sidebar [data-view=settings]').click();await expect(clerk.locator('#main [data-view=users]')).toHaveCount(0);checks+=2;
 assert.deepEqual(errors,[]);checks++;
 console.log(`PASS: ${checks} staff management checks: Admin sidebar/active state, real UI create/edit/lock/unlock, old JWT remains revoked after unlock, self-lock denied, settings shortcut, Receptionist hidden/403, no browser errors. Disposable fixture only.`);
} finally {
 await browser?.close();if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}
 if(path.dirname(path.resolve(root))!==path.resolve(tmpdir())||!path.basename(root).startsWith('hotel-staff-management-'))throw new Error('Unsafe fixture cleanup');
 await rm(root,{recursive:true,force:true});
}

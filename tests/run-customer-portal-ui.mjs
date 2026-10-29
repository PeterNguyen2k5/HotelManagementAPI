import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright');
const {expect}=require(process.env.HOTEL_PLAYWRIGHT_MODULE?process.env.HOTEL_PLAYWRIGHT_MODULE+'/test':'playwright/test');
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=await mkdtemp(path.join(tmpdir(),'hotel-account-ui-'));
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(resolve=>socket.close(resolve));
let server,browser,admin;
async function api(method,route,body,token=admin){
 const response=await fetch(base+route,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
 assert.ok(response.ok,`${method} ${route}: ${response.status}`);return response.json();
}
try{
 server=await startTestServer({project,root,database:path.join(root,'hotel.db'),base,environment:'Development',extraArgs:['--Storage:DataDirectory',root,'--CustomerEmail:Mode','Pickup','--CustomerEmail:PublicBaseUrl',base]});
 admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},null)).token;
 const guest=await api('POST','/api/CustomerAuth/register',{username:'accountuitest',password:'Fixture-guest-123!',fullName:'Nguyễn Minh Anh',phone:'0901234567',email:'account-ui@example.test'},null);
 const today=(await api('GET','/api/HotelConfiguration')).today;
 const day=n=>{const date=new Date(today+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+n);return date.toISOString().slice(0,10)};
 const types=[];
 for(const name of ['Deluxe hướng biển','Superior vườn xanh','Suite An Nhiên'])types.push(await api('POST','/api/RoomTypes',{name}));
 const bookings=[];
 for(let i=0;i<7;i++){
  const room=await api('POST','/api/Rooms',{roomNumber:String(201+i),roomTypeId:types[i%3].id,price:[850000,650000,1250000][i%3],capacity:2});
  const booking=await api('POST','/api/Bookings',{customerId:guest.account.customerId,roomId:room.id,guestCount:2,checkInDate:day(i>=5?0:5),checkOutDate:day(i>=5?2:7)});
  bookings.push(booking);
  if(i>=5)await api('POST',`/api/Bookings/${booking.id}/check-in`);
  if(i===6)await api('POST',`/api/Bookings/${booking.id}/check-out`);
  if(i===4)await api('POST',`/api/Bookings/${booking.id}/cancel`);
 }
 browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
 const context=await browser.newContext({viewport:{width:1440,height:1050}});
 await context.addInitScript(token=>sessionStorage.setItem('hotel.customer.token',token),guest.token);
 const page=await context.newPage();page.setDefaultTimeout(15000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
 await page.goto(base+'/customer.html#overview');
 await expect(page.locator('.portal-status-tabs')).toBeVisible();
 await expect(page.locator('[data-portal-booking]')).toHaveCount(6);
 assert.equal(await page.locator('.portal-metrics,.portal-welcome,[data-portal-view="overview"]').count(),0);
 await page.getByRole('button',{name:'Trang sau',exact:true}).click();
 await expect(page.locator('[data-portal-booking]')).toHaveCount(1);
 await page.locator('[data-portal-status="CheckedOut"]').click();
 await expect(page.locator('[data-portal-booking]')).toHaveCount(1);
 await expect(page.locator('[data-portal-booking] .portal-badge')).toHaveText('Đã trả phòng');
 await expect(page.getByRole('link',{name:'Hóa đơn / PDF'})).toHaveAttribute('href',`/invoice.html?bookingId=${bookings[6].id}&customer=1`);
  await page.getByRole('link',{name:'Xem chi tiết',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Lịch sử thanh toán',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Chi phí kỳ nghỉ',exact:true})).toBeVisible();
  await page.locator('[data-portal-view="bookings"]').click();
  await expect(page.locator('[data-portal-status="CheckedOut"]')).toHaveAttribute('aria-pressed','true');
 await page.locator('[data-portal-status="Reserved"]').click();
 await expect(page.locator('[data-portal-booking]')).toHaveCount(4);
 await page.locator('[name="keyword"]').fill('#'+bookings[0].id);
 await page.getByRole('button',{name:'Tìm kiếm',exact:true}).click();
 await expect(page.locator('[data-portal-booking]')).toHaveCount(1);
 await expect(page.locator('[data-portal-booking]')).toHaveAttribute('data-portal-booking',String(bookings[0].id));
 await page.getByRole('button',{name:'Yêu cầu hủy',exact:true}).click();
 await page.locator('#guest-request-form [name="reason"]').fill('Kiểm thử yêu cầu từ danh sách đặt phòng mới.');
 await page.locator('#guest-request-form [type="submit"]').click();
 await expect(page.locator('.portal-request')).toHaveCount(1);
 await expect(page.locator('.portal-request .portal-badge')).toHaveText('Chờ xử lý');
 await page.locator('[data-portal-view="profile"]').click();
 await expect(page.getByRole('heading',{name:'Hồ sơ của tôi',exact:true})).toBeVisible();
 await expect(page.locator('.portal-info')).toContainText('account-ui@example.test');
 await page.locator('#portal-main').getByRole('button',{name:'Sửa hồ sơ',exact:true}).click();
 await expect(page.locator('#customer-dialog input[name="email"]')).toHaveValue('account-ui@example.test');
 await page.locator('#customer-dialog [data-close]').click();
 await page.locator('[data-portal-view="bookings"]').click();
 await page.locator('.portal-date-filter summary').click();
 await page.getByRole('button',{name:'Xóa bộ lọc',exact:true}).click();
 await expect(page.locator('[data-portal-booking]')).toHaveCount(6);
 if(process.env.HOTEL_UI_SCREENSHOTS)await mkdir(process.env.HOTEL_UI_SCREENSHOTS,{recursive:true});
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:1050});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Page overflow at ${width}px`);
  await expect(page.locator('[data-portal-status=""]').first()).toBeVisible();
  if(process.env.HOTEL_UI_SCREENSHOTS&&[1440,390].includes(width))await page.screenshot({path:path.join(process.env.HOTEL_UI_SCREENSHOTS,`customer-account-${width}.png`)});
 }
 await page.locator('[data-portal-status="Cancelled"]').scrollIntoViewIfNeeded();
 await page.locator('[data-portal-status="Cancelled"]').click();
 await expect(page.locator('[data-portal-booking]')).toHaveCount(1);
 await expect(page.locator('[data-portal-booking] .portal-badge')).toHaveText('Đã hủy');
 await page.route('**/api/CustomerPortal/bookings?**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Lỗi thử nghiệm"}'}));
 await page.locator('[data-portal-status=""]').click();
 await expect(page.getByRole('button',{name:'Thử lại',exact:true})).toBeVisible();
 await page.unroute('**/api/CustomerPortal/bookings?**');
 await page.getByRole('button',{name:'Thử lại',exact:true}).click();
 await expect(page.locator('[data-portal-booking]')).toHaveCount(6);
 assert.deepEqual(errors,[]);
 console.log('PASS: account layout, legacy links, status tabs, page reset, search, request submission, profile editing, invoice link, error/retry and 320/390/768/1440px layouts.');
 await browser.close();browser=null;
 const regression=spawn(process.execPath,[path.join(project,'tests/customer-portal.mjs')],{cwd:root,env:{...process.env,HOTEL_URL:base,HOTEL_TEST_ISOLATED:'1'},stdio:'inherit'});
 const [code]=await once(regression,'exit');assert.equal(code,0,'Customer portal API regression failed');
}finally{
 if(browser)await browser.close();
 if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}
 if(path.dirname(path.resolve(root))!==path.resolve(tmpdir())||!path.basename(root).startsWith('hotel-account-ui-'))throw new Error('Unsafe cleanup path');
 await rm(root,{recursive:true,force:true});
 console.log('Temporary account UI server and database removed. Live accounts and SMTP were not used.');
}

import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright');
assert.equal(process.env.HOTEL_TEST_ISOLATED,'1','Run through the isolated project harness.');
const base=process.env.HOTEL_URL;
async function api(route,body,token){
 const response=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
 assert.ok(response.ok,route+': '+response.status);return response.json();
}
const admin=(await api('/api/Auth/login',{username:'admin',password:'Fixture-admin-final-123!'})).token;
const guest=await api('/api/CustomerAuth/register',{username:'bankuitest',password:'Guest12345',fullName:'UI test guest',phone:'0901234567',email:'bank-ui@example.test'});
const type=await api('/api/RoomTypes',{name:'Bank UI test'},admin);
const room=await api('/api/Rooms',{roomNumber:'QRUI101',roomTypeId:type.id,price:500000,capacity:2},admin);
const date=n=>{const d=new Date();d.setDate(d.getDate()+n);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)};
const booking=await api('/api/Bookings/public',{fullName:'UI test guest',phone:'0901234567',roomId:room.id,guestCount:1,checkInDate:date(1),checkOutDate:date(2)},guest.token);
const config={bankId:'MB',bankName:'Test bank only',accountNumber:'0000000000',accountName:'TEST FIXTURE ONLY'};
const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});
try{
 const context=await browser.newContext();
 await context.addInitScript(token=>sessionStorage.setItem('hotel.customer.token',token),guest.token);
 const page=await context.newPage();
 page.setDefaultTimeout(10000);
 const {expect}=require(process.env.HOTEL_PLAYWRIGHT_MODULE?process.env.HOTEL_PLAYWRIGHT_MODULE+'/test':'playwright/test');
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let imageRequests=0,failImage=true,failConfig=false;
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  if(url.hostname==='img.vietqr.io'||url.pathname==='/custom-test-qr.png'){
   imageRequests++;
   if(failImage)return route.abort('failed');
   return route.fulfill({contentType:'image/png',body:image});
  }
  if(failConfig&&url.pathname==='/api/BookingOperations/bank-config')return route.fulfill({status:503,contentType:'application/json',body:'{"message":"Test outage"}'});
  if(url.origin!==base)return route.abort('blockedbyclient');
  return route.continue();
 });
 const open=async(id=booking.id)=>{await page.goto(base+'/payment.html?bookingId='+id);await expect(page.locator('#pay-content')).toBeVisible()};
 const layout=async name=>{
  for(const width of [390,1440]){
   await page.setViewportSize({width,height:1000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Unexpected horizontal overflow at '+width);
   if(process.env.HOTEL_UI_SCREENSHOT_DIR)await page.screenshot({path:path.join(process.env.HOTEL_UI_SCREENSHOT_DIR,`payment-${name}-${width}.png`),fullPage:true});
  }
 };
 await open();
 await expect(page.locator('#bank-unavailable')).toContainText('chưa cấu hình');
 for(const value of ['Deposit','Payment'])await expect(page.locator(`input[value="${value}"]`)).toBeDisabled();
 await expect(page.locator('input[value="Direct"]')).toBeChecked();
 await expect(page.locator('#direct-section')).toBeVisible();
 await expect(page.locator('#qr-section')).toBeHidden();
 await page.locator('#card-online .method-head strong').click({force:true});
 await expect(page.locator('input[value="Direct"]')).toBeChecked();
 assert.equal(imageRequests,0);
 assert.ok(!(await page.content()).includes('090123456789'));
 await page.locator('#btn-confirm-direct').click();
 await expect(page.locator('#success-dialog')).toBeVisible();
 await expect(page.locator('#suc-title')).toHaveText('Đã ghi nhận lựa chọn thanh toán');
 await expect(page.locator('#suc-payment-type')).toHaveText('Chọn thanh toán tại khách sạn');
 await expect(page.locator('#suc-payment-method')).toHaveText('Tiền mặt tại quầy');
 await expect(page.locator('#suc-paid-now')).toContainText('Chờ thanh toán');
 const payments=await fetch(base+'/api/BookingOperations/'+booking.id+'/payments',{headers:{authorization:'Bearer '+admin}}).then(r=>r.json());
 assert.equal(payments.items.length,1);assert.equal(payments.items[0].amount,0);
 console.log('PASS: unconfigured bank blocks both transfer choices and all QR requests; pay-at-hotel still records zero received.');

 await api('/api/BookingOperations/bank-config',config,admin);
 await open();
 await expect(page.locator('#bank-unavailable')).toBeHidden();
 await expect(page.locator('#qr-status-message')).toContainText('Không tải được mã QR');
 await expect(page.locator('#qr-image')).toBeHidden();
 assert.equal(await page.locator('#qr-image').getAttribute('src'),null);
 await expect(page.locator('#bank-account-num')).toHaveText(config.accountNumber);
 await expect(page.locator('#btn-retry-qr')).toBeVisible();
 await layout('qr-error');
 const beforeRetry=imageRequests;failImage=false;
 await page.locator('#btn-retry-qr').click();
 await expect(page.locator('#qr-image')).toBeVisible();
 await expect(page.locator('#qr-status')).toBeHidden();
 await expect(page.locator('#qr-image')).toHaveJSProperty('naturalWidth',1);
 assert.ok(imageRequests>beforeRetry);
 const qr=new URL(await page.locator('#qr-image').getAttribute('src'));
 assert.equal(qr.searchParams.get('amount'),'500000');assert.equal(qr.searchParams.get('addInfo'),'ANNHIEN '+booking.id);
 await page.locator('input[value="Deposit"]').check();
 await expect(page.locator('#qr-image')).toBeVisible();
 assert.equal(new URL(await page.locator('#qr-image').getAttribute('src')).searchParams.get('amount'),'150000');
 await page.locator('input[value="Direct"]').check();
 await expect(page.locator('#qr-section')).toBeHidden();
 assert.equal(await page.locator('#qr-image').getAttribute('src'),null);
 console.log('PASS: failed VietQR shows a clear error without a substitute image; retry loads the requested account/amount and switching method clears the old QR.');

 failImage=true;
 await api('/api/BookingOperations/bank-config',{...config,qrImageUrl:base+'/custom-test-qr.png'},admin);
 await open();
 await expect(page.locator('#qr-status-message')).toContainText('Không tải được mã QR');
 failImage=false;await page.locator('#btn-retry-qr').click();
 await expect(page.locator('#qr-image')).toBeVisible();
 assert.equal(await page.locator('#qr-image').getAttribute('src'),base+'/custom-test-qr.png');
 console.log('PASS: custom QR uses the same error and retry handling.');

 // Seed actual earlier deposits, rather than mocking the balance, to cover paying the remainder.
 await api('/api/BookingOperations/bank-config',{...config,sepayApiKey:'isolated-deposit-webhook-key'},admin);
 const qrAmount=async amount=>{
  await expect(page.locator('#qr-image')).toBeVisible();
  await expect.poll(async()=>new URL(await page.locator('#qr-image').getAttribute('src')).searchParams.get('amount')).toBe(String(amount));
  assert.equal(await page.locator('[data-copy="bank-transfer-amount-raw"]').getAttribute('data-copy-val'),String(amount));
 };
 const format=value=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:2}).format(value);
 let fixtureIndex=0,partial;
 for(const [due,thirty,fifty] of [
  [0.01,0.01,0.01],[20000,20000,20000],[20000.99,20000.99,20000.99],
  [49999.99,49999.99,49999.99],[50000,50000,50000],[50000.01,50000,50000],
  [80000,50000,50000],[500000,150000,250000]
 ]){
  const offset=3+fixtureIndex++*2;
  const fixture=await api('/api/Bookings',{customerId:guest.account.customerId,roomId:room.id,guestCount:1,checkInDate:date(offset),checkOutDate:date(offset+1)},admin);
  if(due<500000)await api('/api/BookingOperations/'+fixture.id+'/payments',{type:'Deposit',method:'Cash',amount:500000-due,requestId:randomUUID()},admin);
  await open(fixture.id);
  await page.locator('#btn-confirm-transfer').click();
  await expect(page.locator('#transfer-error')).toContainText('Chưa ghi nhận khoản chuyển khoản mới');
  await expect(page.locator('#success-dialog')).not.toBeVisible();
  await expect(page.locator('#summary-balance-amount')).toHaveText(format(due));
  await page.locator('input[value="Deposit"]').check();
  await expect(page.locator('#dep-30-val')).toHaveText(format(thirty));
  await expect(page.locator('#dep-50-val')).toHaveText(format(fifty));
  await qrAmount(thirty);
  await page.locator('[data-percent="50"]').click();await qrAmount(fifty);
  await page.locator('[data-percent="custom"]').click();
  const input=page.locator('#custom-deposit-input');
  await expect(input).toHaveAttribute('min',String(Math.min(50000,due)));
  await expect(input).toHaveAttribute('max',String(due));
  assert.ok(await input.evaluate(el=>el.validity.valid));
  await input.fill('999999');await qrAmount(due);
  await input.blur();await expect(input).toHaveValue(String(due));
  assert.ok(await input.evaluate(el=>el.validity.valid));
  if(due===80000){
   partial=fixture;
   for(const [value,amount] of [['-1',50000],['',50000],['65000.25',65000.25]]){
    await input.fill(value);await qrAmount(amount);await input.blur();await expect(input).toHaveValue(String(amount));
    assert.ok(await input.evaluate(el=>el.validity.valid));
   }
  }
  if(due===20000)await layout('deposit-capped');
 }
 console.log('PASS: 30%/50% and custom deposits stay within actual balances from 0.01 to 500,000; custom min/max, rounding, labels, QR and copy amount agree. Old deposits do not trigger success.');

 // New incoming payments refresh the authoritative balance; never subtract them twice.
 await open(partial.id);
 const incoming=async(id,amount)=>{
  const response=await fetch(base+'/api/BookingOperations/sepay-webhook',{method:'POST',headers:{'content-type':'application/json',authorization:'Apikey isolated-deposit-webhook-key'},body:JSON.stringify({id,transferType:'in',transferAmount:amount,accountNumber:config.accountNumber,content:'ANNHIEN '+partial.id})});
  assert.equal(response.status,200);return response.json();
 };
 await incoming(901,50000);
 await expect(page.locator('#success-dialog')).toBeVisible({timeout:10000});
 await expect(page.locator('#sepay-status-label')).toHaveText('✓ Đã ghi nhận khoản thanh toán mới.');
 await expect(page.locator('#suc-payment-type')).toHaveText('Đặt cọc');
 await expect(page.locator('#suc-payment-method')).toHaveText('Chuyển khoản ngân hàng');
 await expect(page.locator('#suc-remaining-due')).toHaveText(format(30000));
 await open(partial.id);
 await page.locator('input[value="Deposit"]').check();await qrAmount(30000);
 await incoming(902,30000);
 await expect(page.locator('#success-dialog')).toBeVisible({timeout:10000});
 await expect(page.locator('#suc-remaining-due')).toHaveText(format(0));
 const requestsBeforeSettled=imageRequests;await open(partial.id);
 await expect(page.locator('#settled-section')).toBeVisible();
 await expect(page.locator('#qr-section')).toBeHidden();
 await expect(page.locator('#direct-section')).toBeHidden();
 for(const value of ['Deposit','Payment','Direct'])await expect(page.locator(`input[value="${value}"]`)).toBeDisabled();
 assert.equal(await page.locator('#qr-image').getAttribute('src'),null);
 assert.equal(imageRequests,requestsBeforeSettled);
 console.log('PASS: webhook payments reduce the remainder correctly; fully paid bookings generate no QR and offer no further collection.');

 // Polling observes all ledger receipts, including staff-entered cash/manual transfers.
 for(const [method,type,typeLabel,methodLabel] of [
  ['Cash','Deposit','Đặt cọc','Tiền mặt tại quầy'],
  ['Cash','Payment','Thanh toán','Tiền mặt tại quầy'],
  ['Transfer','Deposit','Đặt cọc','Chuyển khoản ngân hàng'],
  ['Transfer','Payment','Thanh toán','Chuyển khoản ngân hàng']
 ]){
  await open(booking.id);
  await expect(page.locator('#sepay-status-label')).toHaveText('Đang theo dõi trạng thái thanh toán...');
  await api('/api/BookingOperations/'+booking.id+'/payments',{type,method,amount:1000,requestId:randomUUID(),...(method==='Transfer'?{reference:'STAFF-BANK-'+randomUUID()}:{})},admin);
  await expect(page.locator('#success-dialog')).toBeVisible({timeout:10000});
  await expect(page.locator('#sepay-status-label')).toHaveText('✓ Đã ghi nhận khoản thanh toán mới.');
  await expect(page.locator('#suc-title')).toHaveText('Đã ghi nhận khoản thanh toán');
  await expect(page.locator('#suc-payment-type')).toHaveText(typeLabel);
  await expect(page.locator('#suc-payment-method')).toHaveText(methodLabel);
  await expect(page.locator('#suc-paid-now')).toHaveText(format(1000));
  assert.ok(!/SePay|online|Thẻ/.test(await page.locator('#suc-payment-type').textContent()+' '+await page.locator('#suc-payment-method').textContent()));
 }
 console.log('PASS: cash and manual transfer deposits/payments show the recorded type and method; webhook receipts use the same neutral confirmation without claiming an unsupported source.');

 failConfig=true;const beforeOutage=imageRequests;await open();
 await expect(page.locator('#bank-unavailable')).toContainText('Chưa tải được thông tin ngân hàng');
 await expect(page.locator('input[value="Payment"]')).toBeDisabled();
 await expect(page.locator('#direct-section')).toBeVisible();
 assert.equal(imageRequests,beforeOutage);
 assert.deepEqual(errors,[]);
 console.log('PASS: bank-config outage keeps pay-at-hotel available without generating QR; no browser script errors.');
 await layout('bank-unavailable');
}finally{await browser.close()}

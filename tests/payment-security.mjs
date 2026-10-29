import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFile,rm} from 'node:fs/promises';
assert.equal(process.env.HOTEL_TEST_ISOLATED,'1');
const base=process.env.HOTEL_URL;
let admin,checks=0;
async function api(method,route,body,status=200,token=admin,headers={}){
 const r=await fetch(base+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 assert.equal(r.status,status,`${method} ${route}: expected ${status}, got ${r.status}`);checks++;
 return r.status===204?null:r.json();
}
admin=(await api('POST','/api/Auth/login',{username:'admin',password:'Fixture-admin-final-123!'},200,'')).token;
const bankRoute='/api/BookingOperations/bank-config';
function unconfigured(config){
 assert.equal(config.bankConfigured,false);
 for(const field of ['bankId','bankName','accountNumber','accountName'])assert.equal(config[field],'');
 assert.equal(config.qrImageUrl,null);assert.equal(config.sepayApiKey,undefined);
}
unconfigured(await api('GET',bankRoute,undefined,200,''));
const configResponse=await fetch(base+bankRoute);assert.equal(configResponse.headers.get('cache-control'),'no-store');
await api('POST',bankRoute,{},400);
await api('POST',bankRoute,{bankId:'MB',bankName:'Bank',accountNumber:' ',accountName:'Hotel'},400);
const legacyConfig={BankId:'MB',BankName:'MB Bank (Ngân hàng Quân Đội)',AccountNumber:'090123456789',AccountName:'AN NHIEN HOTEL AND RESORT',SepayApiKey:'test-only-legacy-key'};
await api('POST',bankRoute,legacyConfig,400);
if(process.env.HOTEL_TEST_BANK_CONFIG){
 const file=process.env.HOTEL_TEST_BANK_CONFIG;
 // The harness passes only its isolated configuration file; never use the project's real file.
 await writeFile(file,JSON.stringify(legacyConfig));
 unconfigured(await api('GET',bankRoute,undefined,200,''));
 await api('POST','/api/BookingOperations/sepay-webhook',{id:900,accountNumber:legacyConfig.AccountNumber,transferType:'in',transferAmount:1,content:'ANNHIEN 1'},503,'',{Authorization:'Apikey '+legacyConfig.SepayApiKey});
 await writeFile(file,JSON.stringify({...legacyConfig,AccountNumber:'123456789',AccountName:''}));
 unconfigured(await api('GET',bankRoute,undefined,200,''));
 await rm(file);
}
const clerk=await api('POST','/api/Users',{username:'paymentclerk',password:'Clerk12345',fullName:'Lễ tân thử',role:'Receptionist'},201);
const clerkToken=(await api('POST','/api/Auth/login',{username:clerk.username,password:'Clerk12345'},200,'')).token;
const guest=await api('POST','/api/CustomerAuth/register',{username:'paymentguest',password:'Guest12345',fullName:'Khách thử',phone:'0901234567',email:'guest@example.test'},201,'');
const other=await api('POST','/api/CustomerAuth/register',{username:'paymentother',password:'Guest12345',fullName:'Khách khác',phone:'0901234568',email:'other@example.test'},201,'');
const type=await api('POST','/api/RoomTypes',{name:'Payment integration'},201);
const room=await api('POST','/api/Rooms',{roomNumber:'PAY101',roomTypeId:type.id,price:500000,capacity:2},201);
const day=n=>{const d=new Date();d.setDate(d.getDate()+n);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)};
const reservation={fullName:'Ignored',phone:'0900000000',roomId:room.id,guestCount:2,checkInDate:day(1),checkOutDate:day(2)};
const booking=await api('POST','/api/Bookings/public',reservation,201,guest.token);
const own='/api/BookingOperations/'+booking.id;
for(const suffix of ['/public-info','/payment-status']){
 await api('GET',own+suffix,undefined,401,'');await api('GET',own+suffix,undefined,404,other.token);
 await api('GET',own+suffix,undefined,200,guest.token);await api('GET',own+suffix,undefined,200,clerkToken);
}
await api('GET','/api/BookingOperations/all-payments',undefined,403,guest.token);
await api('POST',own+'/amend',{},403,guest.token);
await api('GET',own+'/payments',undefined,403,guest.token);
await api('POST',own+'/payments',{},403,guest.token);
const direct={type:'Direct',method:'Cash',amount:0,requestId:randomUUID()};
await api('POST',own+'/customer-payment',direct,401,'');
await api('POST',own+'/customer-payment',direct,404,other.token);
await api('POST',own+'/customer-payment',direct,200,guest.token);
await api('POST',own+'/customer-payment',direct,200,guest.token);
assert.equal((await api('GET',own+'/payments')).items.length,1);
const status=await api('GET',own+'/payment-status',undefined,200,guest.token);
assert.equal(status.hasPaid,false);assert.equal(status.payAtHotel,true);assert.equal(status.paid,0);
await api('POST',own+'/customer-payment',{type:'Payment',method:'Transfer',amount:100,reference:'Unverified',requestId:randomUUID()},409,guest.token);
await api('POST',own+'/customer-payment',{...direct,amount:100.999,requestId:randomUUID()},400,guest.token);
const simulation=own+'/simulate-sepay-payment';
await api('POST',simulation,{amount:50000},401,'');
await api('POST',simulation,{amount:50000},403,guest.token);
await api('POST',simulation,{amount:50000},403,clerkToken);
const development=process.env.HOTEL_TEST_ENV==='Development';
await api('POST',simulation,{amount:50000},development?200:404);
assert.equal((await api('GET','/api/BookingOperations/bank-config')).canSimulate,development);
assert.equal((await api('GET','/api/BookingOperations/bank-config',undefined,200,guest.token)).canSimulate,false);
const webhook={id:1,gateway:'MBBank',transferType:'in',transferAmount:100.99,accountNumber:'0000000000',content:'ANNHIEN '+booking.id};
await api('POST','/api/BookingOperations/sepay-webhook',webhook,503,'');
const key=randomBytes(24).toString('hex');
const config={bankId:'MB',bankName:'Test bank',accountNumber:'0000000000',accountName:'TEST ONLY',sepayApiKey:key};
await api('POST','/api/BookingOperations/bank-config',config,403,guest.token);
await api('POST','/api/BookingOperations/bank-config',config,403,clerkToken);
const saved=await api('POST','/api/BookingOperations/bank-config',config);
assert.equal(saved.bankConfigured,true);assert.equal(saved.accountNumber,config.accountNumber);
assert.equal(saved.sepayApiKey,undefined);assert.equal(saved.sepayConfigured,true);
const publicConfig=await api('GET','/api/BookingOperations/bank-config',undefined,200,'');
assert.equal(publicConfig.bankConfigured,true);
assert.equal(publicConfig.sepayApiKey,undefined);assert.equal(publicConfig.canSimulate,false);
await api('POST','/api/BookingOperations/sepay-webhook',webhook,401,'');
await api('POST','/api/BookingOperations/sepay-webhook',webhook,401,'',{Authorization:'Apikey wrong'});
const auth={Authorization:'Apikey '+key};
await api('POST','/api/BookingOperations/sepay-webhook',{...webhook,accountNumber:'wrong'},400,'',auth);
await api('POST','/api/BookingOperations/sepay-webhook',{...webhook,transferAmount:100.999},400,'',auth);
// Invalid or outgoing directions must not change payments/balance or consume this transaction ID.
const beforeDirectionTests=await api('GET',own+'/payments');
const allBeforeDirectionTests=await api('GET','/api/BookingOperations/all-payments');
const {transferType:ignoredDirection,...missingDirection}=webhook;
for(const body of [missingDirection,...[null,'',' ','unexpected','incoming','income','credit',' in','in ','in\n','in\u0000',0,true,[],{}].map(transferType=>({...webhook,transferType}))]){
 const rejected=await api('POST','/api/BookingOperations/sepay-webhook',body,400,'',auth);
 assert.ok(rejected.message||rejected.errors,'Rejected direction must explain the error.');
 assert.deepEqual(await api('GET',own+'/payments'),beforeDirectionTests,'Rejected transfer must not change booking payments/balance.');
}
for(const transferType of ['out','OUT','Out','oUt']){
 const ignored=await api('POST','/api/BookingOperations/sepay-webhook',{...webhook,transferType},200,'',auth);
 assert.equal(ignored.success,true);assert.match(ignored.message,/Bỏ qua giao dịch tiền ra/);
 assert.deepEqual(await api('GET',own+'/payments'),beforeDirectionTests,'Outgoing transfer must not create a charge/refund.');
}
assert.deepEqual(await api('GET','/api/BookingOperations/all-payments'),allBeforeDirectionTests,'Invalid/outgoing webhooks must not add any payments.');
await api('POST','/api/BookingOperations/sepay-webhook',webhook,200,'',auth);
await api('POST','/api/BookingOperations/sepay-webhook',webhook,200,'',auth);
const afterIncoming=await api('GET',own+'/payments');
assert.equal(afterIncoming.items.length,beforeDirectionTests.items.length+1,'The same transaction ID is still available for a real incoming transfer.');
assert.equal(afterIncoming.balance.paid,beforeDirectionTests.balance.paid+webhook.transferAmount);
// Direction validation must run even for a transaction already recorded successfully.
await api('POST','/api/BookingOperations/sepay-webhook',{...webhook,transferType:'invalid'},400,'',auth);
assert.deepEqual(await api('GET',own+'/payments'),afterIncoming);
const excessive=await api('POST','/api/BookingOperations/sepay-webhook',{...webhook,id:2,transferAmount:999999},200,'',auth);
assert.equal(excessive.status,'Pending');
await api('POST','/api/BookingOperations/bank-config',{...config,sepayApiKey:''});
await api('POST','/api/BookingOperations/sepay-webhook',{...webhook,id:2,transferAmount:0.01},409,'',auth);
await api('POST','/api/BookingOperations/sepay-webhook',{...webhook,id:3,transferAmount:0.01},200,'',auth);
assert.equal((await api('GET',own+'/payment-status',undefined,200,guest.token)).paid,(development?50000:0)+101);
assert.equal((await api('GET','/api/BookingOperations/all-payments')).totalCount,development?4:3);
await api('POST','/api/Bookings/'+booking.id+'/cancel');
await api('POST',simulation,{amount:100},development?409:404);
const cancelledTransfer=await api('POST','/api/BookingOperations/sepay-webhook',{...webhook,id:4,transferAmount:1},200,'',auth);
assert.equal(cancelledTransfer.status,'Pending');
const caseBooking=await api('POST','/api/Bookings/public',reservation,201,guest.token);
const casePath='/api/BookingOperations/'+caseBooking.id;
const beforeCaseTests=await api('GET',casePath+'/payments');
let transactionId=500;
for(const transferType of ['IN','In','iN']){
 const body={...webhook,id:transactionId++,transferType,transferAmount:1,content:'ANNHIEN '+caseBooking.id};
 await api('POST','/api/BookingOperations/sepay-webhook',body,200,'',auth);
 await api('POST','/api/BookingOperations/sepay-webhook',body,200,'',auth);
}
const afterCaseTests=await api('GET',casePath+'/payments');
assert.equal(afterCaseTests.items.length,beforeCaseTests.items.length+3,'Case variants remain idempotent.');
assert.equal(afterCaseTests.balance.paid,beforeCaseTests.balance.paid+3);
console.log(`PASS: ${checks} payment/security checks in ${process.env.HOTEL_TEST_ENV}; no real provider was contacted.`);

import assert from 'node:assert/strict';
const base=process.env.HOTEL_URL || 'http://localhost:5057';
let checks=0;
async function api(method,path,body,status=200,token='') {
  const r=await fetch(base+path,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  const raw=await r.text();let data;try{data=JSON.parse(raw)}catch{data=raw}
  assert.equal(r.status,status,method+' '+path+': '+raw);checks++;return data;
}
const stamp=Date.now().toString().slice(-8);
const payload={username:'guest'+stamp,password:'Guest12345',fullName:'Khách tài khoản',phone:'0901234567',email:'guest'+stamp+'@example.com',role:'Admin',customerId:1};
const first=await api('POST','/api/CustomerAuth/register',payload,201);
assert.equal(first.account.username,payload.username);
assert.equal(first.account.passwordHash,undefined);
const second=await api('POST','/api/CustomerAuth/register',{...payload,username:'other'+stamp,email:'other'+stamp+'@example.com'},201);
await api('POST','/api/CustomerAuth/register',{...payload,email:'duplicate'+stamp+'@example.com'},409);
await api('POST','/api/CustomerAuth/register',{...payload,username:'duplicate'+stamp,email:payload.email.toUpperCase()},409);
await api('POST','/api/CustomerAuth/register',{...payload,password:'123'},400);
await api('POST','/api/CustomerAuth/login',{username:payload.username,password:'wrong'},401);
const login=await api('POST','/api/CustomerAuth/login',{username:payload.username.toUpperCase(),password:payload.password});
assert.equal(login.account.id,first.account.id);
assert.equal((await api('GET','/api/CustomerAuth/me',null,200,first.token)).customerId,first.account.customerId);
const staff=await api('POST','/api/Auth/login',{username:'admin',password:process.env.HOTEL_ADMIN_PASSWORD || 'Fixture-admin-final-123!'});
await api('POST','/api/Auth/login',{username:payload.username,password:payload.password},401);
await api('POST','/api/CustomerAuth/login',{username:'admin',password:'Fixture-admin-final-123!'},401);
await api('GET','/api/CustomerAuth/me',null,403,staff.token);
await api('GET','/api/CustomerAuth/bookings',null,401);
for(const path of ['/api/Rooms','/api/RoomTypes','/api/Customers','/api/Bookings','/api/Services','/api/Reports/rooms','/api/Users','/api/Auth/me'])
  await api('GET',path,null,403,first.token);
await api('GET','/api/Bookings/1',null,403,first.token);
await api('POST','/api/Bookings',{},403,first.token);
for(const path of ['/api/Bookings/1/check-in','/api/Bookings/1/check-out','/api/Bookings/1/cancel','/api/Services/1/activate','/api/Auth/change-password'])
  await api('POST',path,{},403,first.token);
const type=await api('POST','/api/RoomTypes',{name:'Customer test '+stamp},201,staff.token);
const room=await api('POST','/api/Rooms',{roomNumber:'G'+stamp,roomTypeId:type.id,price:500000,capacity:2},201,staff.token);
const day=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')};
const bookingBody={fullName:'Không dùng tên giả này',phone:'0900000000',email:payload.email,roomId:room.id,guestCount:2,checkInDate:day(1),checkOutDate:day(2),customerId:second.account.customerId};
const booking=await api('POST','/api/Bookings/public',bookingBody,201,first.token);
const history=await api('GET','/api/CustomerAuth/bookings',null,200,first.token);
assert.equal(history.totalCount,1);
assert.equal(history.items[0].id,booking.id);
assert.equal(history.items[0].customerId,first.account.customerId);
assert.equal(history.items[0].customerName,payload.fullName);
assert.equal((await api('GET','/api/CustomerAuth/bookings?customerId='+first.account.customerId,null,200,second.token)).totalCount,0);
await api('POST','/api/Bookings/public',{...bookingBody,checkInDate:day(3),checkOutDate:day(4)},401,'invalid-token');
await api('POST','/api/Bookings/public',{...bookingBody,checkInDate:day(3),checkOutDate:day(4)},401);
await api('POST','/api/Bookings/public',bookingBody,403,staff.token);
await api('POST','/api/Bookings/public',{},401);
assert.equal((await api('GET','/api/CustomerAuth/bookings',null,200,first.token)).totalCount,1);
await api('POST','/api/Bookings/'+booking.id+'/cancel',null,200,staff.token);
assert.equal((await api('GET','/api/CustomerAuth/bookings',null,200,first.token)).items[0].status,'Cancelled');
await api('POST','/api/CustomerAuth/login',{username:payload.username,password:'wrong'},401);
await api('POST','/api/CustomerAuth/login',{username:payload.username,password:'wrong'},401);
await api('POST','/api/CustomerAuth/login',{username:payload.username,password:'wrong'},429);
console.log('PASS: '+checks+' customer authentication, ownership, and permission checks');

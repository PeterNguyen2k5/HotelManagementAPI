import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

assert.equal(process.env.HOTEL_TEST_ISOLATED,'1');
assert.ok(process.env.HOTEL_TEST_DB);
const base=process.env.HOTEL_URL;assert.ok(base);
let token,checks=0;
async function api(method,route,body,status=200,auth=token){
  const r=await fetch(base+route,{method,headers:{...(auth?{authorization:'Bearer '+auth}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(r.status,status,`${method} ${route}: expected ${status}, got ${r.status}`);checks++;
  return r.status===204?null:r.json();
}
await api('GET','/api/Notifications',undefined,401,'');
token=(await api('POST','/api/Auth/login',{username:'admin',password:process.env.HOTEL_ADMIN_PASSWORD||'Fixture-admin-final-123!'},200,'')).token;
assert.deepEqual((await api('GET','/api/Notifications')).items,[]);
const stamp=Date.now().toString().slice(-8);
const clerk=await api('POST','/api/Users',{username:'noticeclerk'+stamp,password:'Fixture123',fullName:'Lễ tân thử',role:'Receptionist'},201);
const clerkSession=await api('POST','/api/Auth/login',{username:clerk.username,password:'Fixture123'},200,'');
const guest=await api('POST','/api/CustomerAuth/register',{username:'noticeguest'+stamp,password:'Fixture123',fullName:'Khách thông báo',phone:'0901234567',email:'notice'+stamp+'@example.test'},201,'');
await api('GET','/api/Notifications',undefined,403,guest.token);
await api('GET','/api/Bookings?attention=invalid',undefined,400);
const type=await api('POST','/api/RoomTypes',{name:'Notifications '+stamp},201);
const rooms=[];for(let index=0;index<5;index++)rooms.push(await api('POST','/api/Rooms',{roomNumber:'N'+stamp.slice(-6)+index,roomTypeId:type.id,capacity:2,price:100000},201));
const customer=await api('POST','/api/Customers',{fullName:'Khách thông báo thử'},201);
const day=offset=>{const value=new Date();value.setDate(value.getDate()+offset);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(value)};
const make=(index,start=0,end=1)=>api('POST','/api/Bookings',{customerId:customer.id,roomId:rooms[index].id,checkInDate:day(start),checkOutDate:day(end),guestCount:1},201);
const arrival=await make(0);
const departure=await make(1);await api('POST',`/api/Bookings/${departure.id}/check-in`);
const overdue=await make(2);await api('POST',`/api/Bookings/${overdue.id}/check-in`);
const cleanedBooking=await make(3);await api('POST',`/api/Bookings/${cleanedBooking.id}/check-in`);await api('POST',`/api/Bookings/${cleanedBooking.id}/check-out`);
const guestBooking=await api('POST','/api/Bookings/public',{fullName:'Khách thông báo',phone:'0901234567',roomId:rooms[4].id,guestCount:1,checkInDate:day(1),checkOutDate:day(2)},201,guest.token);
const request=await api('POST',`/api/BookingRequests/${guestBooking.id}`,{type:'Cancel',reason:'Yêu cầu thử'},201,guest.token);
// Time-based fixtures affect only this disposable database; production has no time override.
const database=new DatabaseSync(process.env.HOTEL_TEST_DB);
try{
  database.prepare('UPDATE Bookings SET CheckOutDate = ? WHERE Id = ?').run(day(0)+' 00:00:00',departure.id);
  database.prepare('UPDATE Bookings SET CheckInDate = ?, CheckOutDate = ?, ActualCheckInAt = ?, CurrentRoomSince = ? WHERE Id = ?')
    .run(day(-2)+' 00:00:00',day(-1)+' 00:00:00',day(-2)+' 12:00:00',day(-2)+' 00:00:00',overdue.id);
}finally{database.close()}
const notices=await api('GET','/api/Notifications');
assert.equal(notices.totalCount,5);assert.equal(notices.items.length,5);
assert.equal(new Set(notices.items.map(item=>item.kind)).size,5);
for(const item of notices.items){assert.equal(item.count,1);assert.equal(typeof item.title,'string');assert.equal(item.customerId,undefined)}
const clerkNotices=await api('GET','/api/Notifications',undefined,200,clerkSession.token);
assert.deepEqual(clerkNotices.items,notices.items);
for(const [kind,id] of [['arrivals',arrival.id],['departures',departure.id],['overdue',overdue.id]]){
  const list=await api('GET','/api/Bookings?attention='+kind);
  assert.equal(list.totalCount,1);assert.equal(list.items[0].id,id);
  assert.equal((await api('GET','/api/Bookings?attention='+kind+'&pageNumber=2&pageSize=1')).items.length,0);
}
await api('POST',`/api/BookingRequests/${request.id}/resolve`,{approve:false,note:'Đã xem'},200,clerkSession.token);
assert.ok(!(await api('GET','/api/Notifications')).items.some(item=>item.kind==='requests'));
await api('POST',`/api/Bookings/${arrival.id}/check-in`,undefined,200,clerkSession.token);
assert.ok(!(await api('GET','/api/Notifications')).items.some(item=>item.kind==='arrivals'));
await api('POST',`/api/Bookings/${departure.id}/check-out`,undefined,200,clerkSession.token);
assert.ok(!(await api('GET','/api/Notifications')).items.some(item=>item.kind==='departures'));
await api('POST',`/api/Bookings/${overdue.id}/check-out`,undefined,200,clerkSession.token);
assert.ok(!(await api('GET','/api/Notifications')).items.some(item=>item.kind==='overdue'));
const remaining=await api('GET','/api/Notifications');assert.equal(remaining.totalCount,3);assert.equal(remaining.items[0].kind,'housekeeping');
for(const index of [1,2,3])await api('POST',`/api/Housekeeping/${rooms[index].id}/complete`,undefined,200,clerkSession.token);
const empty=await api('GET','/api/Notifications');assert.equal(empty.totalCount,0);assert.deepEqual(empty.items,[]);
console.log(`Notifications: ${checks} API checks passed (all 5 groups, Admin/Receptionist permissions, exact booking filters and updates after resolving work).`);

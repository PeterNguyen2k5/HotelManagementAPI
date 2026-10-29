import assert from 'node:assert/strict';

assert.equal(process.env.HOTEL_TEST_ISOLATED,'1');
const base=process.env.HOTEL_URL;assert.ok(base);
let token,checks=0;
async function api(method,path,body,status=200,auth=token){
  const r=await fetch(base+path,{method,headers:{...(auth?{authorization:'Bearer '+auth}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(r.status,status,`${method} ${path}: expected ${status}, got ${r.status}`);checks++;
  return r.status===204?null:r.json();
}
await api('GET','/api/Bookings?customerKeyword=test',undefined,401,'');
token=(await api('POST','/api/Auth/login',{username:'admin',password:process.env.HOTEL_ADMIN_PASSWORD||'Fixture-admin-final-123!'},200,'')).token;
const stamp=Date.now().toString().slice(-7);
const clerk=await api('POST','/api/Users',{username:'filterclerk'+stamp,password:'Fixture123',fullName:'Lễ tân bộ lọc',role:'Receptionist'},201);
const clerkSession=await api('POST','/api/Auth/login',{username:clerk.username,password:'Fixture123'},200,'');
const guest=await api('POST','/api/CustomerAuth/register',{username:'filterguest'+stamp,password:'Fixture123',fullName:'Khách kiểm thử',phone:'0901234567',email:'filterguest'+stamp+'@example.test'},201,'');
await api('GET','/api/Bookings?roomNumber=101',undefined,403,guest.token);
const type=await api('POST','/api/RoomTypes',{name:'Filter '+stamp},201);
const room1=await api('POST','/api/Rooms',{roomNumber:'101',roomTypeId:type.id,price:100000},201);
const room2=await api('POST','/api/Rooms',{roomNumber:'102',roomTypeId:type.id,price:200000},201);
const alpha=await api('POST','/api/Customers',{fullName:'Khách Search Alpha',phone:'0912345001',email:'alpha@example.test',identityCard:'ALPHA123'},201);
const beta=await api('POST','/api/Customers',{fullName:'Khách 100%_\\ Beta',email:'beta@example.test'},201);
const day=offset=>{const value=new Date();value.setDate(value.getDate()+offset);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(value)};
const create=(customer,room,start,end)=>api('POST','/api/Bookings',{customerId:customer.id,roomId:room.id,guestCount:1,checkInDate:day(start),checkOutDate:day(end)},201);
const a=await create(alpha,room1,0,2);
const b=await create(alpha,room1,2,4);
const c=await create(beta,room2,1,3);
const d=await create(alpha,room2,4,5);await api('POST',`/api/Bookings/${d.id}/cancel`);
const all=[a,b,c,d];
async function expect(params,expected,auth=token){
  const response=await api('GET','/api/Bookings?'+new URLSearchParams(params),undefined,200,auth);
  assert.equal(response.totalCount,expected.length);
  assert.deepEqual(response.items.map(item=>item.id).sort((x,y)=>x-y),expected.map(item=>item.id).sort((x,y)=>x-y));
  return response;
}
await expect({},all);
await expect({customerKeyword:'alpha'},[a,b,d]);
await expect({customerKeyword:'  Search Alpha  '},[a,b,d]);
await expect({customerKeyword:'Khách'},all);
await expect({customerKeyword:'2345001'},[a,b,d]);
await expect({customerKeyword:'ALPHA@EXAMPLE.TEST'},[a,b,d]);
await expect({customerKeyword:'ALPHA123'},[a,b,d]);
for(const term of ['%','_','\\','100%_\\'])await expect({customerKeyword:term},[c]);
await expect({customerKeyword:"' OR 1=1 --"},[]);
await expect({customerKeyword:'not-found'},[]);
await expect({customerKeyword:'   '},all);
await expect({roomNumber:'101'},[a,b]);
await expect({roomNumber:' 102 '},[c,d]);
await expect({roomNumber:'10'},all);
await expect({roomNumber:'%'},[]);
await expect({fromDate:day(2),toDate:day(2)},[b,c]);
await expect({fromDate:day(1),toDate:day(2)},[a,b,c]);
await expect({fromDate:day(0),toDate:day(0)},[a]);
await expect({fromDate:day(4)},[d]);
await expect({toDate:day(1)},[a,c]);
await expect({fromDate:day(-10),toDate:day(-1)},[]);
await expect({fromDate:day(3),toDate:day(3)},[b]);
await expect({fromDate:day(2)+'T18:00:00',toDate:day(2)+'T06:00:00'},[b,c]);
await expect({customerKeyword:'alpha',roomNumber:'101',fromDate:day(2),toDate:day(3),status:'Reserved'},[b]);
await expect({customerKeyword:'alpha',status:'Cancelled'},[d]);
await expect({customerId:alpha.id,roomId:room2.id,roomNumber:'102'},[d]);
await expect({attention:'arrivals',customerKeyword:'alpha',roomNumber:'101',fromDate:day(0),toDate:day(0)},[a]);
await expect({customerKeyword:'alpha',roomNumber:'101'},[a,b],clerkSession.token);
const params={customerKeyword:'alpha',roomNumber:'10',pageSize:'1'};
for(let page=1;page<=3;page++){
  const result=await api('GET','/api/Bookings?'+new URLSearchParams({...params,pageNumber:String(page)}));
  assert.equal(result.totalCount,3);assert.equal(result.totalPages,3);assert.equal(result.items[0].id,[d,b,a][page-1].id);
}
const beyond=await api('GET','/api/Bookings?'+new URLSearchParams({...params,pageNumber:'4'}));assert.deepEqual(beyond.items,[]);assert.equal(beyond.totalCount,3);
for(const invalid of [
  {fromDate:day(3),toDate:day(1)}, {toDate:'9999-12-31'}, {fromDate:'not-a-date'},
  {toDate:'2026-02-30'}, {customerKeyword:'x'.repeat(201)}, {roomNumber:'x'.repeat(11)}
])await api('GET','/api/Bookings?'+new URLSearchParams(invalid),undefined,400);
await expect({},all);
console.log(`Booking filters: ${checks} API checks passed (customer/room search, literal wildcards, overlapping dates and boundaries, combined attention/status, pagination, permissions and invalid ranges).`);

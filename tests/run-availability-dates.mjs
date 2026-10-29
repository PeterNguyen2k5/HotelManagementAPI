import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {once} from 'node:events';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(import.meta.dirname,'..'),root=await mkdtemp(path.join(tmpdir(),'hotel-availability-dates-')),database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(r=>socket.close(r));
let server,admin,guest,room,checks=0,differentFromUtc=false;
async function stop(){if(server?.exitCode===null){const done=once(server,'exit');server.kill();await done;}server=null;}
async function api(method,url,body,status=200,token=admin){
 const response=await fetch(base+url,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=await response.json();assert.equal(response.status,status,`${method} ${url}: ${JSON.stringify(data)}`);checks++;
 if(status>=400){assert.equal(response.headers.get('cache-control'),'no-store');checks++;}
 return data;
}
function counts(){const db=new DatabaseSync(database);try{return ['Rooms','Bookings','BookingPayments'].map(table=>db.prepare('SELECT COUNT(*) n FROM '+table).get().n);}finally{db.close();}}
try{
 for(const zone of ['Asia/Ho_Chi_Minh','Pacific/Kiritimati','Etc/GMT+12']){
  await stop();server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root,'--Hotel:TimeZone',zone]});
  admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).token;
  const config=await api('GET','/api/HotelConfiguration',undefined,200,null),today=config.today;
  const localDay=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  assert.equal(today,localDay);checks++;
  differentFromUtc ||= today!==new Date().toISOString().slice(0,10);
  const day=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
  const available=(start,end,status=200,token=null)=>api('GET','/api/Bookings/available-rooms?'+new URLSearchParams({checkInDate:start,checkOutDate:end,guestCount:'2'}),undefined,status,token);
  if(!room){
   await available(day(-1),day(1),400);
   const type=await api('POST','/api/RoomTypes',{name:'Availability dates fixture'},201);
   room=await api('POST','/api/Rooms',{roomNumber:'DATE1',roomTypeId:type.id,price:100000,capacity:2},201);
   guest=await api('POST','/api/CustomerAuth/register',{username:'datefixture',password:'Fixture-guest-123!',fullName:'Dates fixture',phone:'0901234567',email:'dates@example.test'},201,null);
  }
  const before=counts();
  for(const token of [null,admin,guest.token]){
   for(const [start,end] of [['2026-01-01','2026-01-02'],[day(-1),today],[day(-1),day(1)]]){
    assert.match((await available(start,end,400,token)).message,/Ngày nhận phòng.*quá khứ/);checks++;
   }
  }
  assert.ok((await available(today,day(1))).some(x=>x.id===room.id));checks++;
  assert.ok((await available(day(1),day(2))).some(x=>x.id===room.id));checks++;
  await available(today,today,400);await available(day(1),today,400);
  await api('GET','/api/Bookings/available-rooms?checkOutDate='+day(1),undefined,400,null);
  const booking={customerId:guest.account.customerId,roomId:room.id,guestCount:2,checkInDate:day(-1),checkOutDate:day(1)};
  await api('POST','/api/Bookings',booking,400);
  await api('POST','/api/Bookings/public',{...booking,fullName:guest.account.fullName,phone:guest.account.phone,email:guest.account.email},400,guest.token);
  assert.deepEqual(counts(),before);checks++;
  console.log('PASS: past availability rejected, today/future accepted and no bookings/payments changed in '+zone+'.');
 }
 assert.equal(differentFromUtc,true,'At least one fixture must distinguish hotel calendar days from the UTC calendar.');checks++;
 console.log(`PASS: ${checks} availability date, validation and hotel timezone checks.`);
}finally{await stop();await rm(root,{recursive:true,force:true});}

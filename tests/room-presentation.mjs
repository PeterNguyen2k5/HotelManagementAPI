import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

assert.equal(process.env.HOTEL_TEST_ISOLATED,'1');
const base=process.env.HOTEL_URL;assert.ok(base);
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let token,checks=0;
async function api(method,route,body,status=200,auth=token){
  const response=await fetch(base+route,{method,headers:{...(auth?{authorization:'Bearer '+auth}:{}),...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  assert.equal(response.status,status,`${method} ${route}: expected ${status}, got ${response.status}`);checks++;
  return response.status===204?null:response.json();
}
token=(await api('POST','/api/Auth/login',{username:'admin',password:process.env.HOTEL_ADMIN_PASSWORD||'Fixture-admin-final-123!'},200,'')).token;
if(process.env.HOTEL_TEST_LEGACY_SQL){
  const legacy=(await api('GET','/api/Rooms?keyword=LEGACY001')).items[0];
  assert.equal(legacy.price,123.45);assert.equal(legacy.capacity,2);assert.equal(legacy.description,'Kept legacy description');
  assert.equal((await api('GET','/api/Customers?keyword=Legacy customer')).length,1);
  assert.equal((await api('GET','/api/RoomPresentation/'+legacy.id,undefined,200,'')).isIllustration,true);
}
const stamp=Date.now().toString().slice(-8);
const type=await api('POST','/api/RoomTypes',{name:'Presentation '+stamp},201);
const room=await api('POST','/api/Rooms',{roomNumber:'P'+stamp,roomTypeId:type.id,price:123.45,capacity:3,description:'Mô tả cũ'},201);
const other=await api('POST','/api/Rooms',{roomNumber:'Q'+stamp,roomTypeId:type.id,price:200000},201);
const clerk=await api('POST','/api/Users',{username:'contentclerk'+stamp,password:'Fixture123',fullName:'Lễ tân thử',role:'Receptionist'},201);
const clerkSession=await api('POST','/api/Auth/login',{username:clerk.username,password:'Fixture123'},200,'');
const guest=await api('POST','/api/CustomerAuth/register',{username:'contentguest'+stamp,password:'Fixture123',fullName:'Khách thử',phone:'0901234567',email:'content'+stamp+'@example.test'},201,'');
const route='/api/RoomPresentation/'+room.id;
const initial=await api('GET',route,undefined,200,'');
assert.equal(initial.description,'Mô tả cũ');assert.deepEqual(initial.amenities,[]);assert.deepEqual(initial.images,[]);assert.equal(initial.gallery.length,2);assert.equal(initial.isIllustration,true);
const otherContent=await api('GET','/api/RoomPresentation/'+other.id,undefined,200,'');assert.notEqual(initial.gallery[0],otherContent.gallery[0]);
for(const image of initial.gallery){const r=await fetch(base+image);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/image\/svg/);assert.match(await r.text(),/Hình minh họa/);checks++}
const empty={description:'Mô tả chi tiết riêng',area:32.5,beds:'1 giường đôi, 1 giường đơn',amenities:['Wi-Fi',' Điều hòa ','Wi-Fi','Máy sấy tóc'],images:[]};
await api('PUT',route,empty,401,'');await api('PUT',route,empty,403,clerkSession.token);await api('PUT',route,empty,403,guest.token);
await api('GET','/api/RoomPresentation/2147483647',undefined,404,'');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=','base64');
const jpg=await readFile(path.join(project,'wwwroot/images/room.jpg'));
async function upload(buffer,name,mime,status=201,auth=token,id=room.id){
  const form=new FormData();form.append('file',new Blob([buffer],{type:mime}),name);
  const r=await fetch(base+`/api/RoomPresentation/${id}/images`,{method:'POST',headers:auth?{authorization:'Bearer '+auth}:{},body:form});
  assert.equal(r.status,status,`Upload expected ${status}, got ${r.status}`);checks++;return r.json();
}
await upload(png,'room.png','image/png',401,'');await upload(png,'room.png','image/png',403,clerkSession.token);await upload(png,'room.png','image/png',403,guest.token);
await upload(Buffer.from('<svg onload="alert(1)"></svg>'),'image.jpg','image/jpeg',400);
await upload(Buffer.alloc(0),'empty.png','image/png',400);
await upload(Buffer.alloc(5*1024*1024+1),'large.png','image/png',400);
await upload(png,'room.png','image/png',404,token,2147483647);
const image1=(await upload(jpg,'../../unsafe-name.html','image/jpeg')).url;
const image2=(await upload(png,'second.png','image/png')).url;
assert.match(image1,new RegExp('^/api/RoomPresentation/'+room.id+'/images/[a-f0-9]{32}\\.jpg$'));
assert.equal((await api('GET',route,undefined,200,'')).images.length,0,'Uploading must not change published gallery before Save.');
const saved=await api('PUT',route,{...empty,images:[image2,image1]});
assert.deepEqual(saved.images,[image2,image1]);assert.deepEqual(saved.amenities,['Wi-Fi','Điều hòa','Máy sấy tóc']);assert.equal(saved.area,32.5);assert.equal(saved.isIllustration,false);
const published=await api('GET',route,undefined,200,'');assert.deepEqual(published,saved);
const cover=await fetch(base+route+'/cover',{redirect:'manual'});assert.equal(cover.status,302);assert.equal(cover.headers.get('location'),image2);checks++;
for(const [url,bytes,mime]of [[image1,jpg,'image/jpeg'],[image2,png,'image/png']]){
  const r=await fetch(base+url);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),mime);assert.equal(r.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);checks++;
}
for(const change of [
  {area:0},{area:1001},{description:'x'.repeat(4001)},{beds:'x'.repeat(101)},
  {amenities:['']},{amenities:[null]},{amenities:['x'.repeat(81)]},{amenities:Array(31).fill('Wi-Fi')},
  {images:Array(11).fill(image1)},{images:[null]},{images:['https://example.com/image.jpg']},
  {images:['javascript:alert(1)']},{images:['/api/RoomPresentation/'+other.id+'/images/'+image1.split('/').at(-1)]},
  {images:[route+'/images/'+'0'.repeat(32)+'.png']},{images:[route+'/images/../room.jpg']}
])await api('PUT',route,{...empty,...change},400);
assert.deepEqual((await api('GET',route,undefined,200,'')).images,[image2,image1]);
await api('PUT','/api/Rooms/'+room.id,{roomNumber:room.roomNumber,roomTypeId:type.id,capacity:3,price:150,status:0,description:'Mô tả cũ đã sửa'});
assert.equal((await api('GET',route,undefined,200,'')).description,empty.description);
assert.equal((await api('GET',route,undefined,200,'')).price,150);
const customer=await api('POST','/api/Customers',{fullName:'Khách ảnh phòng'},201);
const day=offset=>{const d=new Date();d.setDate(d.getDate()+offset);return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).format(d)};
const booking=await api('POST','/api/Bookings',{customerId:customer.id,roomId:room.id,guestCount:2,checkInDate:day(1),checkOutDate:day(3)},201);
assert.equal(booking.roomTotal,300);
await api('DELETE','/api/Rooms/'+room.id,undefined,409);
await api('PUT',route,{...empty,images:[]});assert.equal((await api('GET',route,undefined,200,'')).isIllustration,true);
await api('PUT','/api/RoomPresentation/'+other.id,{...empty,images:[]});await api('DELETE','/api/Rooms/'+other.id,undefined,204);
await api('GET','/api/RoomPresentation/'+other.id,undefined,404,'');
console.log(`Room presentation: ${checks} API checks passed (gallery/amenities, permissions, safe upload paths, validation, published cover, existing room updates and booking preservation).`);

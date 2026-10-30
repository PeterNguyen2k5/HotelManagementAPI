import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(import.meta.dirname,'..');
const root=await mkdtemp(path.join(tmpdir(),'hotel-va-')),database=path.join(root,'hotel.db');
const socket=createServer().listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(r=>socket.close(r));
let server,token,checks=0,roomIndex=0,eventId=90000;
const bank={bankId:'BIDV',bankName:'Fixture bank',accountNumber:'FIXTUREVA001',webhookAccountNumber:'00000000001',accountName:'FIXTURE ONLY',sepayApiKey:'isolated-va-test-key'};
async function api(method,url,body,status=200,auth=token,headers={}) {
 const r=await fetch(base+url,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(auth?{authorization:'Bearer '+auth}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 const result=r.status===204?null:await r.json();assert.equal(r.status,status,`${method} ${url}: ${JSON.stringify(result)}`);checks++;return result;
}
const deliver=(data,status=200)=>api('POST','/api/BookingOperations/sepay-webhook',data,status,null,{Authorization:'Apikey '+bank.sepayApiKey});
const payments=id=>api('GET',`/api/BookingOperations/${id}/payments`);
try {
 server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root,'--Payments:BankConfigFile',path.join(root,'bank-config.json')]});
 token=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).token;
 const customer=await api('POST','/api/Customers',{fullName:'VA fixture'},201);
 const type=await api('POST','/api/RoomTypes',{name:'VA fixture'},201);
 const today=(await api('GET','/api/HotelConfiguration')).today;
 const day=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 async function booking(){const room=await api('POST','/api/Rooms',{roomNumber:'VA'+(++roomIndex),roomTypeId:type.id,price:100000,capacity:2},201);return api('POST','/api/Bookings',{customerId:customer.id,roomId:room.id,guestCount:1,checkInDate:day(1),checkOutDate:day(2)},201);}
 const cfg=await api('POST','/api/BookingOperations/bank-config',bank);
 assert.equal(cfg.accountNumber,bank.accountNumber);assert.equal(cfg.webhookAccountNumber,bank.webhookAccountNumber);assert.equal(cfg.sepayApiKey,undefined);checks+=3;
 const a=await booking();
 const event={id:++eventId,gateway:'BIDV',transactionDate:today+' 09:24:31',accountNumber:bank.webhookAccountNumber,subAccount:bank.accountNumber,code:null,content:`MBVCB.FIXTURE.ANNHIEN ${a.id}.CT toi FIXTUREVA001`,description:`ANNHIEN ${a.id}`,transferType:'in',transferAmount:10000,referenceCode:randomUUID(),accumulated:0};
 for(const change of [{accountNumber:bank.accountNumber},{accountNumber:'wrong-main'},{subAccount:null},{subAccount:''},{subAccount:'wrong-va'},{subAccount:bank.accountNumber.toLowerCase()},{gateway:'Vietcombank'},{transferType:'unknown'}])await deliver({...event,...change},400);
 assert.equal((await payments(a.id)).balance.paid,0);assert.equal((await api('GET','/api/BankTransfers')).totalCount,0);checks+=2;
 assert.equal((await deliver(event)).status,'Matched');assert.equal((await deliver(event)).status,'Matched');
 const first=(await payments(a.id)).items;assert.equal(first.length,1);assert.equal(first[0].amount,10000);checks+=2;
 await deliver({...event,transferAmount:10001},409);
 // Another SePay ID with the same bank transaction cannot credit money twice.
 await deliver({...event,id:++eventId});assert.equal((await payments(a.id)).items.length,1);checks++;
 const b=await booking(),ref=randomUUID();
 const manual={requestId:randomUUID(),type:'Deposit',method:'Transfer',amount:10000,reference:ref,bankId:bank.bankId,bankAccountNumber:bank.accountNumber};
 const paid=await api('POST',`/api/BookingOperations/${b.id}/payments`,manual);
 await deliver({...event,id:++eventId,referenceCode:ref,content:`ANNHIEN ${b.id}`,description:''});
 assert.equal((await payments(b.id)).items.length,1);assert.equal((await payments(b.id)).items[0].id,paid.id);checks+=2;
 // Webhook-first and manual-first share the main-account transaction identity.
 await api('POST',`/api/BookingOperations/${a.id}/payments`,{...manual,requestId:randomUUID(),reference:event.referenceCode});assert.equal((await payments(a.id)).items.length,1);checks++;
 // Newly persisted VA receipts cannot be replayed as a different VA after configuration changes.
 await api('POST','/api/BookingOperations/bank-config',{...bank,accountNumber:'FIXTUREVA002',sepayApiKey:''});
 await deliver({...event,subAccount:'FIXTUREVA002'},409);
 await api('POST','/api/BookingOperations/bank-config',{...bank,sepayApiKey:''});
 assert.equal((await deliver(event)).status,'Matched');checks++;
 // Existing non-VA configuration and pre-VA fingerprints remain valid.
 await api('POST','/api/BookingOperations/bank-config',{...bank,accountNumber:bank.webhookAccountNumber,webhookAccountNumber:null,sepayApiKey:''});
 const c=await booking(),legacy={...event,id:++eventId,content:`ANNHIEN ${c.id}`,description:'',subAccount:bank.accountNumber,referenceCode:randomUUID()};
 await deliver(legacy);
 await api('POST','/api/BookingOperations/bank-config',{...bank,sepayApiKey:''});assert.equal((await deliver(legacy)).status,'Matched');assert.equal((await payments(c.id)).items.length,1);checks+=2;
 // Cancellation/expiry still takes precedence; a real late receipt must be retained for review.
 const d=await booking();await api('POST',`/api/Bookings/${d.id}/cancel`);
 const late=await deliver({...event,id:++eventId,content:`ANNHIEN ${d.id}`,description:'',referenceCode:randomUUID()});assert.equal(late.status,'Pending');assert.equal((await payments(d.id)).items.length,0);checks+=2;
 // Clerks may have used the VA as the account identity before this feature.
 const e=await booking(),oldRef=randomUUID();
 await api('POST','/api/BookingOperations/bank-config',{...bank,webhookAccountNumber:null,sepayApiKey:''});
 await api('POST',`/api/BookingOperations/${e.id}/payments`,{...manual,requestId:randomUUID(),reference:oldRef});
 await api('POST','/api/BookingOperations/bank-config',{...bank,sepayApiKey:''});
 assert.equal((await deliver({...event,id:++eventId,content:`ANNHIEN ${e.id}`,description:'',referenceCode:oldRef})).status,'Pending');
 await api('POST',`/api/BookingOperations/${e.id}/payments`,{...manual,requestId:randomUUID(),reference:oldRef},409);
 assert.equal((await payments(e.id)).items.length,1);checks+=2;
 const db=new DatabaseSync(database,{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) n FROM BookingPayments').get().n,4);checks++;}finally{db.close();}
 console.log(`PASS: ${checks} VA checks; exact main+VA matching, real-shaped incoming payload, authenticated retries, cross-channel reference dedup, old config, legacy retries and late receipt handling. No live bank was contacted.`);
} finally {
 if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}
 if(path.dirname(path.resolve(root))!==path.resolve(tmpdir())||!path.basename(root).startsWith('hotel-va-'))throw new Error('Unsafe fixture cleanup');
 await rm(root,{recursive:true,force:true});
}

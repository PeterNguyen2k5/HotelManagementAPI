import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {startTestServer,testAdminPassword} from './test-server.mjs';

const project=path.resolve(import.meta.dirname,'..'),root=await mkdtemp(path.join(tmpdir(),'hotel-native-clients-')),database=path.join(root,'hotel.db');
const listener=createServer().listen(0,'127.0.0.1');await once(listener,'listening');const base='http://127.0.0.1:'+listener.address().port;await new Promise(r=>listener.close(r));
let server;
try{
 server=await startTestServer({project,root,database,base,extraArgs:['--Storage:DataDirectory',root,'--Payments:BankConfigFile',path.join(root,'bank-config.json')]});
 const json=async(method,url,body,token,status=200)=>{const r=await fetch(base+url,{method,headers:{...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});const value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;};
 const staff=(await json('POST','/api/Auth/login',{username:'admin',password:testAdminPassword})).token;
 const type=await json('POST','/api/RoomTypes',{name:'Native client test'},staff,201);
 for(let i=1;i<=4;i++)await json('POST','/api/Rooms',{roomNumber:'N'+i,roomTypeId:type.id,price:10000,capacity:i+1},staff,201);
 await json('POST','/api/BookingOperations/bank-config',{bankId:'BIDV',bankName:'Fixture bank',accountNumber:'FIXTUREVA001',webhookAccountNumber:'00000000001',accountName:'FIXTURE ONLY',sepayApiKey:'fixture-native-key'},staff);
 const dotnet=process.env.HOTEL_CLIENT_DOTNET||'dotnet',checks=process.env.HOTEL_CLIENT_CHECKS_DLL||path.join(project,'clients/HotelManagement.Client.Checks/bin/Release/net8.0/HotelManagement.Client.Checks.dll');
 const run=spawn(dotnet,[checks,base],{stdio:'inherit',env:{...process.env,HOTEL_FIXTURE_ADMIN_PASSWORD:testAdminPassword}});const [exitCode]=await once(run,'exit');assert.equal(exitCode,0,'Native .NET client checks');
 if(process.env.HOTEL_NATIVE_UI_FIXTURE==='1'){
  await writeFile(path.join(project,'App_Data/native-ui-fixture.json'),JSON.stringify({base,root,serverPid:server.pid,staffUsername:'admin',staffPassword:testAdminPassword,guestUsername:'nativeguest',guestPassword:'Native-fixture-123!'},null,2));
  console.log('Temporary UI fixture available at '+base+'. Only fictitious local data. Stop this harness after UI checks.');
  await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});
 }
}finally{
 if(server&&server.exitCode===null){const ended=once(server,'exit');server.kill();await ended;}
 if(path.dirname(path.resolve(root))!==path.resolve(tmpdir())||!path.basename(root).startsWith('hotel-native-clients-'))throw new Error('Unsafe fixture cleanup');
 await rm(root,{recursive:true,force:true});console.log('Native client fixture stopped and removed. No production data or bank/SMTP service used.');
}

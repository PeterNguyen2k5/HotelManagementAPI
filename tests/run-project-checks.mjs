import {startTestServer} from './test-server.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=await mkdtemp(path.join(tmpdir(),'hotel-project-checks-'));
const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');
const base=`http://127.0.0.1:${socket.address().port}`;await new Promise(resolve=>socket.close(resolve));
let server,root,environment,number=0;
async function stop(){if(server&&server.exitCode===null&&server.signalCode===null){const end=once(server,'exit');server.kill();await end}server=null}
async function start(){
 server=await startTestServer({project,root,database:path.join(root,'hotel.db'),base,environment,extraArgs:['--Payments:BankConfigFile',path.join(root,'bank-config.json'),'--CustomerEmail:Mode','Pickup','--CustomerEmail:PublicBaseUrl',base]});
}
async function suite(file,env='Production',ipc=false){
 await stop();environment=env;root=path.join(runtime,'run-'+(++number));await mkdir(root);
 if(file==='room-presentation.mjs'&&process.env.HOTEL_TEST_LEGACY_SQL){const db=new DatabaseSync(path.join(root,'hotel.db'));try{
 db.exec(await readFile(process.env.HOTEL_TEST_LEGACY_SQL,'utf8'));
 db.exec("INSERT INTO RoomTypes (Id,Name,Description) VALUES (900,'Legacy type','Unchanged'); INSERT INTO Rooms (Id,RoomNumber,RoomTypeId,Price,Status,Description,Capacity) VALUES (900,'LEGACY001',900,12345,0,'Kept legacy description',2); INSERT INTO Customers (Id,FullName,CreatedAt) VALUES (900,'Legacy customer','2026-01-01 00:00:00');");
 }finally{db.close()}}
 await start();
 const test=spawn(process.execPath,[path.join(project,'tests',file)],{cwd:root,env:{...process.env,HOTEL_URL:base,HOTEL_TEST_ISOLATED:'1',HOTEL_ADMIN_PASSWORD:'Fixture-admin-final-123!',HOTEL_TEST_ENV:environment,
 HOTEL_TEST_DB:path.join(root,'hotel.db'),HOTEL_TEST_BANK_CONFIG:path.join(root,'bank-config.json'),HOTEL_TEST_MAIL_FOLDER:path.join(root,'App_Data/mail'),HOTEL_TEST_LEGACY_SQL:file==='room-presentation.mjs'?process.env.HOTEL_TEST_LEGACY_SQL||'':''},stdio:ipc?['ignore','inherit','inherit','ipc']:'inherit'});
 let restartError;
 if(ipc)test.on('message',async message=>{try{assert.equal(message.type,'restart');await stop();await start();test.send({type:'restarted'})}catch(error){restartError=error;test.kill()}});
 const [code]=await once(test,'exit');if(restartError)throw restartError;assert.equal(code,0,file+' failed');
}
try{
 if(process.env.HOTEL_PAYMENT_ONLY!=='1'){
  for(const file of ['customer-portal.mjs','smoke.mjs','customer-auth.mjs','operations.mjs','price-precision.mjs','notifications.mjs','booking-filters.mjs','room-presentation.mjs','service-checkout-concurrency.mjs','room-status-concurrency.mjs'])await suite(file);
  await suite('staff-token-revocation.mjs','Production',true);
  await suite('customer-account-tools.mjs','Development',true);
 }
 await suite('payment-security.mjs','Production');await suite('payment-security.mjs','Development');
 if(process.env.HOTEL_PAYMENT_UI==='1')await suite('payment-bank-ui.mjs','Production');
}finally{
 await stop();const resolved=path.resolve(runtime);
 if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('hotel-project-checks-'))throw new Error('Unsafe temporary cleanup path');
 await rm(resolved,{recursive:true,force:true});console.log('Temporary test servers/databases removed. Project database was not used.');
}

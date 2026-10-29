import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rename,unlink,rm,access} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {startTestServer,testAdminPassword} from './test-server.mjs';
import {readZip,writeZip} from './backup-zip.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dll=process.env.HOTEL_TEST_DLL||path.join(project,'bin/Debug/net8.0/HotelManagementAPI.dll');
const root=await mkdtemp(path.join(tmpdir(),'hotel-full-backup-')),source=path.join(root,'source'),replica=path.join(root,'replica');await mkdir(source);
async function port(){const server=createServer().listen(0,'127.0.0.1');await once(server,'listening');const value=server.address().port;await new Promise(resolve=>server.close(resolve));return `http://127.0.0.1:${value}`;}
const base=await port(),restoredBase=await port(),externalBank=path.join(root,'bank-outside-data.json');
const bankKey='fixture-sepay-backup-key',smtpSecret='fixture-smtp-backup-password',scrape='fixture-monitoring-backup-key-123456789';
let server,restoredServer,admin,clerk,checks=0;
const database=path.join(source,'hotel.db'),backupFolder=path.join(source,'App_Data/backups');
async function stop(){if(server&&server.exitCode===null){const done=once(server,'exit');server.kill();await done;}server=null;}
async function start(extra=[]){await stop();server=await startTestServer({project,root:source,database,base,environment:'Development',extraArgs:[
 '--Storage:DataDirectory',source,'--Payments:BankConfigFile',externalBank,'--Hotel:TimeZone','Asia/Tokyo','--CustomerEmail:Mode','Pickup','--CustomerEmail:PublicBaseUrl',base,
 '--CustomerEmail:From','fixture@example.test','--CustomerEmail:Smtp:Host','127.0.0.1','--CustomerEmail:Smtp:Username','fixture','--CustomerEmail:Smtp:Password',smtpSecret,
 '--HotelContact:Phone','0900000123','--HotelContact:Email','backup-contact@example.test','--HotelContact:FacebookUrl','https://www.facebook.com/backup.fixture',
 '--Monitoring:ScrapeKey',scrape,'--Backup:MaxBackups','2','--Backup:RetentionDays','14','--Backup:ReplicaDirectory',replica,...extra]});}
async function api(method,route,body,status=200,token=admin,host=base){
 const response=await fetch(host+route,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const data=response.status===204?null:await response.json();assert.equal(response.status,status,`${method} ${route}: ${response.status} ${JSON.stringify(data)}`);checks++;return {data,response};
}
async function cli(args,expected=0){
 const child=spawn('dotnet',[dll,...args],{cwd:root,env:{...process.env,APPDATA:path.join(root,'cli-profile')},stdio:['ignore','pipe','pipe']});let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);
 const [code]=await once(child,'close');assert.equal(code,expected,`Backup CLI failed: ${error}`);assert.ok(!output.includes(smtpSecret)&&!error.includes(smtpSecret));checks++;return output;
}
function sql(action){const db=new DatabaseSync(database);try{return action(db);}finally{db.close();}}
const catalog=async()=>(await api('GET','/api/Administration/backups')).data;
async function create(){const result=await api('POST','/api/Administration/backups');assert.equal(result.response.headers.get('cache-control'),'no-store');assert.ok(result.data.fileName.endsWith('.zip'));return result.data;}
async function waitFor(check){for(let i=0;i<100;i++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('Timed out waiting for backup maintenance');}
const exists=async p=>access(p).then(()=>true,()=>false);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex').toUpperCase();
try{
 await start();admin=(await api('POST','/api/Auth/login',{username:'admin',password:testAdminPassword},200,null)).data.token;
 const staff=(await api('POST','/api/Users',{username:'backupclerk',password:'Fixture-clerk-123!',fullName:'Clerk fixture',role:'Receptionist'},201)).data;
 clerk=(await api('POST','/api/Auth/login',{username:staff.username,password:'Fixture-clerk-123!'},200,null)).data.token;
 const guest=(await api('POST','/api/CustomerAuth/register',{username:'backupguest',password:'Fixture-guest-123!',fullName:'Backup guest',email:'backup-guest@example.test',phone:'0901234567'},201,null)).data;
 const type=(await api('POST','/api/RoomTypes',{name:'Backup fixture'},201)).data;
 const roomBody={roomNumber:'BK101',roomTypeId:type.id,price:500000,capacity:2};const room=(await api('POST','/api/Rooms',roomBody,201)).data;
 const today=(await api('GET','/api/HotelConfiguration')).data.today,day=n=>{const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10)};
 const booking=(await api('POST','/api/Bookings',{customerId:guest.account.customerId,roomId:room.id,guestCount:1,checkInDate:day(1),checkOutDate:day(2)},201)).data;
 await api('POST',`/api/BookingOperations/${booking.id}/payments`,{requestId:randomUUID(),type:'Deposit',method:'Cash',amount:25000});
 const bank={bankId:'MB',bankName:'Fixture bank',accountNumber:'0000000000001',accountName:'FIXTURE ONLY',sepayApiKey:bankKey};await api('POST','/api/BookingOperations/bank-config',bank);
 const image=await readFile(path.join(project,'wwwroot/images/room.jpg')),form=new FormData();form.append('file',new Blob([image],{type:'image/jpeg'}),'fixture.jpg');
 const uploaded=await fetch(base+`/api/RoomPresentation/${room.id}/images`,{method:'POST',headers:{authorization:'Bearer '+admin},body:form});assert.equal(uploaded.status,201);checks++;const imageUrl=(await uploaded.json()).url;
 await api('PUT',`/api/RoomPresentation/${room.id}`,{description:'Restorable gallery',beds:'1 bed',area:30,amenities:['Wi-Fi'],images:[imageUrl]});
 await api('POST','/api/CustomerAuth/forgot-password',{email:guest.account.email},200,null);
 const mailNames=(await readdir(path.join(source,'App_Data/mail'))).filter(n=>n.endsWith('.eml'));assert.equal(mailNames.length,1);
 const mail=await readFile(path.join(source,'App_Data/mail',mailNames[0]),'utf8'),split=mail.search(/\r?\n\r?\n/),headers=mail.slice(0,split);
 let message=mail.slice(split).trim();if(/Content-Transfer-Encoding:\s*base64/i.test(headers))message=Buffer.from(message.replace(/\s/g,''),'base64').toString('utf8');else if(/Content-Transfer-Encoding:\s*quoted-printable/i.test(headers))message=message.replace(/=\r?\n/g,'').replace(/=([0-9A-F]{2})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
 const resetToken=new URLSearchParams(new URL(message.match(/https?:\/\/[^\s<>]+/)[0]).hash.slice(1)).get('resetToken');assert.ok(resetToken);
 const good=await create(),archive=path.join(root,'verified-original.zip'),download=await fetch(base+`/api/Administration/backups/${good.id}/download`,{headers:{authorization:'Bearer '+admin}});
 assert.equal(download.status,200);assert.equal(download.headers.get('content-type'),'application/zip');assert.equal(download.headers.get('cache-control'),'no-store');checks++;
 const bytes=Buffer.from(await download.arrayBuffer());await writeFile(archive,bytes);const files=readZip(bytes),manifest=JSON.parse(files.find(f=>f.name==='manifest.json').data);
 for(const entry of manifest.files){const file=files.find(f=>f.name===entry.path);assert.equal(file.data.length,entry.size);assert.equal(digest(file.data),entry.sha256);}
 assert.ok(files.some(f=>f.name.startsWith('data-protection-keys/')));assert.ok(files.some(f=>f.name==='App_Data/room-images/'+room.id+'/'+path.basename(imageUrl)));
 const recoveredSettings=JSON.parse(files.find(f=>f.name==='recovery-settings.json').data);assert.equal(recoveredSettings['CustomerEmail:Smtp:Password'],smtpSecret);assert.equal(recoveredSettings['Hotel:TimeZone'],'Asia/Tokyo');
 assert.equal(recoveredSettings['HotelContact:Phone'],'0900000123');assert.equal(recoveredSettings['HotelContact:Email'],'backup-contact@example.test');assert.equal(recoveredSettings['HotelContact:FacebookUrl'],'https://www.facebook.com/backup.fixture');checks+=3;
 assert.ok(files.find(f=>f.name==='jwt.key').data.equals(await readFile(path.join(source,'jwt.key'))));assert.equal(JSON.parse(files.find(f=>f.name==='bank-config.json').data).SepayApiKey,bankKey);
 assert.ok((await readFile(path.join(replica,good.fileName))).equals(bytes));
 for(const token of [null,clerk,guest.token])await api('GET',`/api/Administration/backups/${good.id}/download`,undefined,token?403:401,token);
 const exposed=await fetch(base+'/App_Data/backups/'+good.fileName);assert.notEqual(Buffer.from(await exposed.arrayBuffer()).subarray(0,4).toString('hex'),'504b0304');checks++;
 await cli(['--verify-backup',archive]);
 const restored=path.join(root,'restored');await cli(['--restore-backup',archive,'--restore-target',restored]);
 await api('PUT',`/api/Rooms/${room.id}`,{...roomBody,price:600000,status:0});
 restoredServer=spawn('dotnet',[dll,'--contentRoot',project,'--webroot',path.join(project,'wwwroot'),'--Storage:DataDirectory',restored,'--urls',restoredBase,'--environment','Development','--Deployment:RequireHttps','false'],{cwd:root,env:{...process.env,APPDATA:path.join(root,'restored-profile'),DOTNET_ENVIRONMENT:'Development',ASPNETCORE_ENVIRONMENT:'Development'},stdio:'ignore'});
 await waitFor(async()=>{if(restoredServer.exitCode!==null)throw Error('Restored server exited');try{return (await fetch(restoredBase+'/health/ready')).status===200}catch{return false;}});
 assert.equal((await api('GET','/api/Auth/me',undefined,200,admin,restoredBase)).data.username,'admin');
 assert.equal((await api('GET','/api/Rooms/'+room.id,undefined,200,admin,restoredBase)).data.price,500000);
 assert.equal((await api('GET','/api/Rooms/'+room.id)).data.price,600000);
 assert.equal((await api('GET','/api/HotelConfiguration',undefined,200,null,restoredBase)).data.timeZone,'Asia/Tokyo');
 const restoredContact=(await api('GET','/api/HotelContact',undefined,200,null,restoredBase)).data;
 assert.equal(restoredContact.phone,'0900000123');assert.equal(restoredContact.email,'backup-contact@example.test');assert.equal(restoredContact.facebookUrl,'https://www.facebook.com/backup.fixture');checks+=3;
 assert.equal((await api('GET',`/api/BookingOperations/${booking.id}/payments`,undefined,200,admin,restoredBase)).data.balance.paid,25000);
 assert.ok(Buffer.from(await (await fetch(restoredBase+imageUrl)).arrayBuffer()).equals(image));checks++;
 const restoredBank=(await api('GET','/api/BookingOperations/bank-config',undefined,200,null,restoredBase)).data;assert.equal(restoredBank.accountNumber,bank.accountNumber);assert.ok(!JSON.stringify(restoredBank).includes(bankKey));
 await api('POST','/api/BookingOperations/sepay-webhook',{id:123456,gateway:'MBBank',accountNumber:bank.accountNumber,transferType:'out',transferAmount:1},401,null,restoredBase);
 {
  const r=await fetch(restoredBase+'/api/BookingOperations/sepay-webhook',{method:'POST',headers:{'content-type':'application/json',Authorization:'Apikey '+bankKey},body:JSON.stringify({id:123456,gateway:'MBBank',accountNumber:bank.accountNumber,transferType:'out',transferAmount:1})});assert.equal(r.status,200);checks++;
 }
 await api('GET','/api/CustomerAuth/me',undefined,200,guest.token,restoredBase);
 await api('POST','/api/CustomerAuth/reset-password',{token:resetToken,newPassword:'Fixture-restored-reset-456!'},200,null,restoredBase);
 await api('GET','/api/CustomerAuth/me',undefined,401,guest.token,restoredBase);await api('GET','/api/CustomerAuth/me',undefined,200,guest.token);
 const restoredExit=once(restoredServer,'exit');restoredServer.kill();await restoredExit;restoredServer=null;
 console.log('PASS: full archive hashes, external bank config, replica, access controls and real restore to another root; room/image/payment/timezone, original JWT and old reset token work after restore.');

 // Corrupt/untrusted bundles must fail without committing a restore directory.
 const rewrite=(changed)=>{const output=changed.map(f=>({...f,data:Buffer.from(f.data)}));const m=JSON.parse(output.find(f=>f.name==='manifest.json').data);m.files=output.filter(f=>f.name!=='manifest.json').map(f=>({path:f.name,size:f.data.length,sha256:digest(f.data)}));output.find(f=>f.name==='manifest.json').data=Buffer.from(JSON.stringify(m));return output;};
 const attacks=[
  ['corrupt',files.map(f=>f.name==='hotel.db'?{...f,data:Buffer.from('broken database')}:f)],
  ['missing-image',rewrite(files.filter(f=>!f.name.startsWith('App_Data/room-images/')))],
  ['missing-key',rewrite(files.filter(f=>f.name!=='jwt.key'))],
  ['traversal',rewrite([...files,{name:'../escaped.txt',data:Buffer.from('escaped')}])],
  ['absolute',rewrite([...files,{name:'C:/escaped.txt',data:Buffer.from('escaped')}])],
  ['backslash',rewrite([...files,{name:'..\\escaped.txt',data:Buffer.from('escaped')}])],
  ['duplicate',[...files,files.find(f=>f.name==='hotel.db')]],
  ['symlink',rewrite(files.map(f=>f.name==='jwt.key'?{...f,attributes:0xA1FF0000}:f))],
  ['settings',rewrite(files.map(f=>f.name==='recovery-settings.json'?{...f,data:Buffer.from(JSON.stringify({...recoveredSettings,'Storage:DataDirectory':'/escape'}))}:f))]
 ];
 for(const [name,entries] of attacks){const invalid=path.join(root,name+'.zip'),target=path.join(root,'invalid-'+name);await writeFile(invalid,writeZip(entries));await cli(['--restore-backup',invalid,'--restore-target',target],1);assert.equal(await exists(target),false,name);}
 assert.equal(await exists(path.join(root,'escaped.txt')),false);
 await cli(['--restore-backup',archive,'--restore-target',source],1);assert.equal((await api('GET','/api/Rooms/'+room.id)).data.price,600000);
 console.log('PASS: corrupt/missing files, ZIP traversal/absolute paths, duplicates, symlinks, unsupported settings and existing target are rejected without overwriting live data.');

 // Rotation removes managed legacy/full files and replicas, preserving unknown files and a valid newest full backup.
 const oldName='hotel-20000101-000000-'+randomUUID().replaceAll('-','')+'.db',oldPath=path.join(backupFolder,oldName);
 await writeFile(oldPath,files.find(f=>f.name==='hotel.db').data);await writeFile(path.join(replica,oldName),files.find(f=>f.name==='hotel.db').data);
 const oldId=sql(db=>db.prepare('INSERT INTO DatabaseBackups (FileName,Size,CreatedBy,CreatedAt) VALUES (?,?,?,?)').run(oldName,1,'Legacy fixture','2000-01-01 00:00:00').lastInsertRowid);
 const legacyDownload=await fetch(base+`/api/Administration/backups/${oldId}/download`,{headers:{authorization:'Bearer '+admin}});assert.equal(legacyDownload.status,200);assert.equal(Buffer.from(await legacyDownload.arrayBuffer()).subarray(0,15).toString(),'SQLite format 3');checks++;
 await writeFile(path.join(backupFolder,'keep-me.txt'),'unmanaged');await create();await create();
 assert.equal((await catalog()).length,2);assert.equal(await exists(oldPath),false);assert.equal(await exists(path.join(replica,oldName)),false);assert.equal(await readFile(path.join(backupFolder,'keep-me.txt'),'utf8'),'unmanaged');
 const staleStage=path.join(backupFolder,'.creating-'+randomUUID().replaceAll('-',''));await mkdir(staleStage);await writeFile(path.join(staleStage,'unused.txt'),'abandoned fixture');
 const {utimes}=await import('node:fs/promises');await utimes(staleStage,new Date('2000-01-01'),new Date('2000-01-01'));
 const stalePartial=path.join(backupFolder,'hotel-20000101-000000-'+randomUUID().replaceAll('-','')+'.zip.partial');await writeFile(stalePartial,'abandoned');await utimes(stalePartial,new Date('2000-01-01'),new Date('2000-01-01'));
 const remotePartial=path.join(replica,path.basename(stalePartial)+'-'+randomUUID().replaceAll('-',''));await writeFile(remotePartial,'abandoned remote');await utimes(remotePartial,new Date('2000-01-01'),new Date('2000-01-01'));
 const remoteVerify=path.join(replica,'.hotel-backup-verify-'+randomUUID().replaceAll('-',''));await mkdir(remoteVerify);await writeFile(path.join(remoteVerify,'unused.txt'),'abandoned remote verify');await utimes(remoteVerify,new Date('2000-01-01'),new Date('2000-01-01'));
 await create();for(const stale of [staleStage,stalePartial,remotePartial,remoteVerify])assert.equal(await exists(stale),false);
 const keep=await catalog(),requiredImage=path.join(source,'App_Data/room-images',String(room.id),path.basename(imageUrl)),heldImage=path.join(root,'held-image.jpg');
 await rename(requiredImage,heldImage);await api('POST','/api/Administration/backups',undefined,500);assert.deepEqual(await catalog(),keep);for(const item of keep)assert.ok(await exists(path.join(backupFolder,item.fileName)));await rename(heldImage,requiredImage);
 const oldFull=keep[0];await stop();sql(db=>db.prepare('UPDATE DatabaseBackups SET CreatedAt=? WHERE Id=?').run('2000-01-01 00:00:00',oldFull.id));await start();
 await waitFor(async()=>!(await catalog()).some(x=>x.id===oldFull.id));assert.equal(await exists(path.join(backupFolder,oldFull.fileName)),false);
 const newest=(await catalog())[0];await stop();await unlink(path.join(backupFolder,newest.fileName));await start();await waitFor(async()=>(await catalog()).some(x=>x.fileName!==newest.fileName&&x.id>newest.id)&&!(await readdir(backupFolder)).some(n=>n.startsWith('.creating-')||n.endsWith('.partial')));
 assert.ok((await catalog()).length<=2);
 const savedReplica=path.join(root,'replica-offline');await rename(replica,savedReplica);await writeFile(replica,'Replica unavailable fixture');
 await api('POST','/api/Administration/backups',undefined,500);await api('POST','/api/Administration/backups',undefined,500);assert.ok((await catalog()).length<=2);
 await unlink(replica);await rename(savedReplica,replica);await writeFile(path.join(replica,'keep-notes.txt'),'unmanaged replica');await create();
 assert.ok((await readdir(replica)).filter(n=>/^hotel-.*\.(zip|db)$/.test(n)).length<=2);assert.equal(await readFile(path.join(replica,'keep-notes.txt'),'utf8'),'unmanaged replica');
 const corrupt=(await catalog())[0];await stop();const corrupted=Buffer.from(await readFile(path.join(backupFolder,corrupt.fileName)));corrupted.fill(0,0,4);await writeFile(path.join(backupFolder,corrupt.fileName),corrupted);await start();
 await waitFor(async()=>(await catalog()).some(x=>x.id>corrupt.id)&&!(await readdir(backupFolder)).some(n=>n.startsWith('.creating-')||n.endsWith('.partial')));
 console.log('PASS: automatic age/count cleanup, abandoned work cleanup, replica outage/recovery and missing/corrupt backup replacement preserve usable full backups.');

 if(process.env.HOTEL_BACKUP_UI==='1'){
  const require=createRequire(import.meta.url),module=process.env.HOTEL_PLAYWRIGHT_MODULE||'playwright';const {chromium}=require(module),{expect}=require(module+'/test');
  const browser=await chromium.launch({headless:true,...(process.env.HOTEL_BROWSER_PATH?{executablePath:process.env.HOTEL_BROWSER_PATH}:{})});try{
   const page=await browser.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort('blockedbyclient'));
   await page.goto(base);await page.locator('#username').fill('admin');await page.locator('#password').fill(testAdminPassword);await page.locator('#login-form [type="submit"]').click();await expect(page.locator('.dashboard-head')).toBeVisible();
   await page.locator('[data-view="administration"]').click();await expect(page.locator('#main')).toContainText('Gói đầy đủ (ZIP)');await page.locator('[data-act="backup-create"]').click();await expect(page.locator('[data-act="backup-download"]')).toHaveCount(2);
   const downloaded=page.waitForEvent('download');await page.locator('[data-act="backup-download"]').first().click();const file=await downloaded;assert.ok(file.suggestedFilename().endsWith('.zip'));assert.ok(!JSON.stringify(errors).includes(smtpSecret));assert.deepEqual(errors,[]);
   console.log('PASS: Edge administration shows full bundles, creates with retention and downloads the correct ZIP filename.');
  }finally{await browser.close();}
 }
 // Invalid locations fail before any ACL changes; an unrelated nonempty directory is never adopted.
 for(const extra of [
  ['--Backup:MaxBackups','0'],['--Backup:RetentionDays','0'],
  ['--Backup:ReplicaDirectory',path.parse(root).root],['--Backup:ReplicaDirectory',root],
  ['--Backup:ReplicaDirectory',source+path.sep],['--Backup:ReplicaDirectory',path.join(project,'wwwroot')]
 ]){await assert.rejects(()=>start(extra));checks++;}
 const shared=path.join(root,'shared');await mkdir(shared);await writeFile(path.join(shared,'keep.txt'),'shared directory fixture');
 await start(['--Backup:ReplicaDirectory',shared]);await api('POST','/api/Administration/backups',undefined,500);
 assert.deepEqual(await readdir(shared),['keep.txt']);assert.equal(await readFile(path.join(shared,'keep.txt'),'utf8'),'shared directory fixture');
 assert.ok((await catalog()).length<=2);
 console.log(`PASS: ${checks} backup/restore/API/CLI/configuration checks plus manifest/file assertions and directory-safety checks.`);
}finally{
 await stop();if(restoredServer&&restoredServer.exitCode===null){const done=once(restoredServer,'exit');restoredServer.kill();await done;}
 const resolved=path.resolve(root);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('hotel-full-backup-'))throw new Error('Unsafe temporary cleanup path');
 await rm(resolved,{recursive:true,force:true});console.log('Temporary full backups, replica, restored data, credentials and servers removed. Live hotel data and SMTP/bank services were not used.');
}

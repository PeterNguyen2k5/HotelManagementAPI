import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';

// Disposable fixtures only: exercise the real first-login flow, then restart for rate limits.
export const testAdminPassword='Fixture-admin-final-123!';
const initialPassword='Fixture-admin-initial-456!';
const prepared=new Set();
export async function startTestServer({project,root,database,base,environment='Production',extraArgs=[],onSpawn}){
 let server;
 const launch=()=>{
  server=spawn('dotnet',[process.env.HOTEL_TEST_DLL||path.join(project,'bin/Debug/net8.0/HotelManagementAPI.dll'),
   '--contentRoot',root,'--webroot',path.join(project,'wwwroot'),'--urls',base,'--environment',environment,
   '--ConnectionStrings:DefaultConnection',`Data Source=${database};Default Timeout=1`,'--Deployment:RequireHttps','false',...extraArgs],
   {cwd:root,env:{...process.env,...(process.platform==='win32'?{APPDATA:path.join(root,'test-profile')}:{ }),ASPNETCORE_ENVIRONMENT:environment,DOTNET_ENVIRONMENT:environment,
    BootstrapAdmin__Password:initialPassword},stdio:onSpawn?['ignore','pipe','pipe']:'ignore'});
  onSpawn?.(server);
 };
 const stop=async()=>{if(server&&server.exitCode===null){const end=once(server,'exit');server.kill();await end}};
 const ready=async()=>{
  for(let i=0;i<100;i++){
   if(server.exitCode!==null)throw new Error('Temporary server exited before becoming ready.');
   let response;try{response=await fetch(base+'/api/NoSuchRoute',{signal:AbortSignal.timeout(1000)})}catch{}
   if(response?.status===404)return;
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  throw new Error('Temporary server did not become ready.');
 };
 try{
  launch();await ready();
  if(!prepared.has(database)){
   const response=await fetch(base+'/api/Auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',password:initialPassword})});
   assert.equal(response.status,200,'Fixture administrator should accept only its configured initial password.');
   const session=await response.json();assert.equal(session.user.mustChangePassword,true);
   const changed=await fetch(base+'/api/Auth/change-password',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+session.token},body:JSON.stringify({oldPassword:initialPassword,newPassword:testAdminPassword})});
   assert.equal(changed.status,200,'Fixture administrator must complete the normal password change flow.');
   prepared.add(database);await stop();launch();await ready();
  }
  return server;
 }catch(error){await stop();throw error}
}

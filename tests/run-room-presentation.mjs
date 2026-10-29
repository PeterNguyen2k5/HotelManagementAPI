import {startTestServer} from './test-server.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm, readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dll = path.join(project, 'bin/Debug/net8.0/HotelManagementAPI.dll');
await access(dll).catch(() => { throw new Error('Run dotnet build before the isolated tests.'); });
const runtime = await mkdtemp(path.join(tmpdir(), 'hotel-room-presentation-tests-'));
const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const base = `http://127.0.0.1:${socket.address().port}`;
await new Promise(resolve => socket.close(resolve));
let server;
let databasePath;
let runNumber=0;
async function stop() {
  if (server && server.exitCode === null) {
    const stopped = once(server, 'exit'); server.kill(); await stopped;
  }
}
async function start() {
  databasePath=path.join(runtime, 'hotel-'+(++runNumber)+'.db');
  if(runNumber===1&&process.env.HOTEL_TEST_LEGACY_SQL){
    const db=new DatabaseSync(databasePath);
    try{
      db.exec(await readFile(process.env.HOTEL_TEST_LEGACY_SQL,'utf8'));
      db.exec("INSERT INTO RoomTypes (Id,Name,Description) VALUES (900,'Legacy type','Unchanged'); INSERT INTO Rooms (Id,RoomNumber,RoomTypeId,Price,Status,Description,Capacity) VALUES (900,'LEGACY001',900,12345,0,'Kept legacy description',2); INSERT INTO Customers (Id,FullName,CreatedAt) VALUES (900,'Legacy customer','2026-01-01 00:00:00');");
    }finally{db.close()}
  }
  server = await startTestServer({project, root:runtime, database:databasePath, base, environment:'Production'});
}
async function suite(name) {
  const test = spawn(process.execPath, [path.join(project, 'tests', name)], {
    cwd: runtime, env: { ...process.env, HOTEL_URL: base, HOTEL_TEST_ISOLATED: '1',
      HOTEL_TEST_DB: databasePath, HOTEL_ADMIN_PASSWORD: 'Fixture-admin-final-123!', HOTEL_TEST_LEGACY_SQL: runNumber===1?process.env.HOTEL_TEST_LEGACY_SQL:'' }, stdio: 'inherit'
  });
  const [code] = await once(test, 'exit'); assert.equal(code, 0, `${name} failed`);
}
try {
  await start(); await suite('room-presentation.mjs');
  await stop(); await start(); await suite('customer-auth.mjs');
  await stop(); await start(); await suite('smoke.mjs');
} finally {
  await stop();
  const resolved = path.resolve(runtime);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('hotel-room-presentation-tests-'))
    throw new Error('Unsafe test cleanup path.');
  await rm(resolved, { recursive: true, force: true });
  console.log('Test server stopped and temporary database removed. Live hotel data was not used.');
}

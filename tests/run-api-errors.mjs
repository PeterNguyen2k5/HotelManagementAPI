import {startTestServer} from './test-server.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dll = process.env.HOTEL_TEST_DLL || path.join(project, 'bin/Debug/net8.0/HotelManagementAPI.dll');
await access(dll).catch(() => { throw new Error('Run dotnet build before the isolated tests.'); });
let runtime;
const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const base = `http://127.0.0.1:${socket.address().port}`;
await new Promise(resolve => socket.close(resolve));
let log;
let server;
async function stop() {
  if (server && server.exitCode === null) {
    const stopped = once(server, 'exit'); server.kill(); await stopped;
  }
  if (log) { await new Promise(resolve => log.end(resolve)); log = null; }
  if (runtime) {
    const resolved = path.resolve(runtime);
    if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('hotel-api-errors-tests-'))
      throw new Error('Unsafe test cleanup path.');
    await rm(resolved, { recursive: true, force: true });
    runtime = null;
  }
}
async function start(environment = 'Production', faultFixture = false) {
  runtime = await mkdtemp(path.join(tmpdir(), 'hotel-api-errors-tests-'));
  if (faultFixture) {
    await mkdir(path.join(runtime, 'App_Data'));
    await writeFile(path.join(runtime, 'App_Data/backups'), 'Temporary error-test marker.');
  }
  log = createWriteStream(path.join(runtime, 'server.log'), { flags: 'a' });
  server = await startTestServer({project, root:runtime, database:path.join(runtime,'hotel.db'), base, environment, onSpawn:child=>{child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false})}});
}
async function suite(name) {
  const test = spawn(process.execPath, [path.join(project, 'tests', name)], {
    cwd: runtime, env: { ...process.env, HOTEL_URL: base, HOTEL_TEST_ISOLATED: '1',
      HOTEL_TEST_ROOT: runtime, HOTEL_ADMIN_PASSWORD: 'Fixture-admin-final-123!' }, stdio: 'inherit'
  });
  const [code] = await once(test, 'exit'); assert.equal(code, 0, `${name} failed`);
}
try {
  await start('Production', true); await suite('api-errors.mjs');
  await stop(); await start('Development', true); await suite('api-errors.mjs');
  await stop(); await start(); await suite('smoke.mjs');
  await stop(); await start(); await suite('customer-auth.mjs');
} finally {
  await stop();
  console.log('Test server stopped and temporary database/logs removed. Live hotel data was not used.');
}

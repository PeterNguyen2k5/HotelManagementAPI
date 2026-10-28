import {startTestServer} from './test-server.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dll = path.join(project, 'bin/Debug/net8.0/HotelManagementAPI.dll');
await access(dll).catch(() => { throw new Error('Run dotnet build before the isolated tests.'); });
const runtime = await mkdtemp(path.join(tmpdir(), 'hotel-notifications-tests-'));
const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
const base = `http://127.0.0.1:${socket.address().port}`;
await new Promise(resolve => socket.close(resolve));
let server;
async function stop() {
  if (server && server.exitCode === null) {
    const stopped = once(server, 'exit'); server.kill(); await stopped;
  }
}
async function start() {
  server = await startTestServer({project, root:runtime, database:path.join(runtime,'hotel.db'), base, environment:'Production'});
}
async function suite(name) {
  const test = spawn(process.execPath, [path.join(project, 'tests', name)], {
    cwd: runtime, env: { ...process.env, HOTEL_URL: base, HOTEL_TEST_ISOLATED: '1',
      HOTEL_TEST_DB: path.join(runtime, 'hotel.db'), HOTEL_ADMIN_PASSWORD: 'Fixture-admin-final-123!' }, stdio: 'inherit'
  });
  const [code] = await once(test, 'exit'); assert.equal(code, 0, `${name} failed`);
}
try {
  await start(); await suite('notifications.mjs');
  await stop(); await start(); await suite('smoke.mjs');
} finally {
  await stop();
  const resolved = path.resolve(runtime);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('hotel-notifications-tests-'))
    throw new Error('Unsafe test cleanup path.');
  await rm(resolved, { recursive: true, force: true });
  console.log('Test server stopped and temporary database removed. Live hotel data was not used.');
}

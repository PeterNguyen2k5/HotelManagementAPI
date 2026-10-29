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
await access(dll).catch(() => { throw new Error('Run dotnet build before this isolated test harness.'); });
const runtime = await mkdtemp(path.join(tmpdir(), 'hotel-customer-tests-'));
const socket = createServer();
socket.listen(0, '127.0.0.1');
await once(socket, 'listening');
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const base = `http://127.0.0.1:${port}`;
let server;
async function stop() {
  if (server && server.exitCode === null) {
    const stopped = once(server, 'exit'); server.kill(); await stopped;
  }
}
async function start(environment = 'Development') {
  server = await startTestServer({project, root:runtime, database:path.join(runtime,'hotel.db'), base, environment, extraArgs:['--CustomerEmail:Mode','Pickup','--CustomerEmail:PublicBaseUrl',base]});
}
async function suite(name, ipc = false) {
  const test = spawn(process.execPath, [path.join(project, 'tests', name)], {
    cwd: runtime, env: { ...process.env, HOTEL_URL: base, HOTEL_TEST_ISOLATED: '1',
      HOTEL_TEST_MAIL_FOLDER: path.join(runtime, 'App_Data/mail'), HOTEL_TEST_DB: path.join(runtime, 'hotel.db'), HOTEL_ADMIN_PASSWORD: 'Fixture-admin-final-123!' },
    stdio: ipc ? ['ignore', 'inherit', 'inherit', 'ipc'] : 'inherit'
  });
  let restartError;
  if (ipc) test.on('message', async message => {
    try {
      assert.equal(message.type, 'restart'); await stop(); await start(); test.send({ type: 'restarted' });
    } catch (error) { restartError = error; test.kill(); }
  });
  const [code] = await once(test, 'exit');
  if (restartError) throw restartError;
  assert.equal(code, 0, `${name} failed`);
}
try {
  await start();
  await suite('customer-account-tools.mjs', true);
  await stop(); await start(); await suite('customer-auth.mjs');
  await stop(); await start(); await suite('smoke.mjs');
  await stop(); await start(); await suite('staff-token-revocation.mjs', true);
  await stop(); await start('Production');
  for (const email of ['unknown@example.test', 'admin@hotel.local']) {
    const response = await fetch(base + '/api/CustomerAuth/forgot-password', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email })
    });
    assert.equal(response.status, 503, 'Pickup email must never be available in Production.');
  }
  console.log('Production pickup is disabled; isolated regression suites passed.');
} finally {
  await stop();
  const resolved = path.resolve(runtime);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('hotel-customer-tests-'))
    throw new Error('Unsafe test cleanup path.');
  await rm(resolved, { recursive: true, force: true });
  console.log('Test server stopped and temporary database/mail removed. Live hotel data was not used.');
}

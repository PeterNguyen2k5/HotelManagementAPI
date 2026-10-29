import assert from 'node:assert/strict';
import { readFile, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

assert.equal(process.env.HOTEL_TEST_ISOLATED, '1');
const root = path.resolve(process.env.HOTEL_TEST_ROOT || '.');
assert.equal(path.dirname(root), path.resolve(tmpdir()));
assert.ok(path.basename(root).startsWith('hotel-api-errors-tests-'), 'Use the isolated error-test harness.');
const base = process.env.HOTEL_URL;
assert.ok(base);
let token;
let checks = 0;
async function api(method, route, body, expected = 200, auth = token, accept = 'application/json') {
  const response = await fetch(base + route, {
    method, headers: { accept,
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  assert.equal(response.status, expected, `${method} ${route}: expected ${expected}, got ${response.status}`);
  assert.ok(response.headers.get('x-trace-id'));
  if (expected >= 400) assert.match(response.headers.get('cache-control'), /no-store/);
  checks++;
  return { response, raw, data: raw ? JSON.parse(raw) : undefined };
}
function envelope(result, status) {
  assert.match(result.response.headers.get('content-type'), /application\/json/);
  assert.equal(result.data.statusCode, status);
  assert.equal(result.data.traceId, result.response.headers.get('x-trace-id'));
  assert.equal(typeof result.data.message, 'string');
  assert.ok(result.data.message.length > 0);
  assert.doesNotMatch(result.raw, /StackTrace|IOException|SqliteException|System\.|App_Data|F:\\|exceptionMessage|connectionString/);
}
envelope(await api('GET', '/api/Rooms', undefined, 401, ''), 401);
token = (await api('POST', '/api/Auth/login', { username: 'admin', password: 'Fixture-admin-final-123!' })).data.token;
const stamp = Date.now().toString();
const clerk = (await api('POST', '/api/Users', {
  username: 'errorclerk' + stamp, password: 'Fixture123', fullName: 'Kiểm thử lỗi', role: 'Receptionist'
}, 201)).data;
const clerkLogin = (await api('POST', '/api/Auth/login', { username: clerk.username, password: 'Fixture123' })).data;
envelope(await api('GET', '/api/Reports/rooms', undefined, 403, clerkLogin.token), 403);
envelope(await api('GET', '/api/Rooms/2147483647', undefined, 404), 404);
envelope(await api('GET', '/api/NoSuchRoute', undefined, 404, '', 'text/html'), 404);
envelope(await api('GET', '/API/NoSuchRoute', undefined, 404, ''), 404);
const invalid = await api('POST', '/api/Rooms', { roomNumber: 'invalid', roomTypeId: 1, price: 100.999 }, 400);
envelope(invalid, 400);
assert.ok(invalid.data.errors.Price.some(message => message.includes('2 chữ số thập phân')));
const malformed = await fetch(base + '/api/Auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: '{malformed'
});
assert.equal(malformed.status, 400);
assert.ok((await malformed.json()).errors);
checks++;
const type = (await api('POST', '/api/RoomTypes', { name: 'Error fixture ' + stamp }, 201)).data;
const room = (await api('POST', '/api/Rooms', { roomNumber: 'E' + stamp.slice(-8), roomTypeId: type.id, price: 500000 }, 201)).data;
const conflict = await api('PATCH', `/api/Rooms/${room.id}/trang-thai`, 1, 409);
assert.match(conflict.data.message, /check-in/);

// Trigger a genuine filesystem exception in an existing API, using only this temporary runtime.
const folder = path.join(root, 'App_Data/backups');
assert.equal(path.dirname(folder), path.join(root, 'App_Data'));
assert.ok((await stat(folder)).isFile(), 'The harness must install the fault fixture before starting the app.');
const traces = [];
try {
  for (const accept of ['application/json', 'text/html']) {
    const failure = await api('POST', '/api/Administration/backups', undefined, 500, token, accept);
    envelope(failure, 500);
    assert.deepEqual(Object.keys(failure.data).sort(), ['message', 'statusCode', 'traceId']);
    assert.match(failure.data.message, /Máy chủ gặp lỗi/);
    traces.push(failure.data.traceId);
  }
  assert.notEqual(traces[0], traces[1]);
} finally { await unlink(folder); }
await api('POST', '/api/Administration/backups');

const { DatabaseSync } = await import('node:sqlite');
const database = new DatabaseSync(path.join(root, 'hotel.db'));
try {
  database.exec('BEGIN IMMEDIATE');
  const busy = await api('PUT', `/api/Rooms/${room.id}`, {
    roomNumber: room.roomNumber, roomTypeId: type.id, capacity: 2, price: 600000, status: 0
  }, 409);
  envelope(busy, 409);
} finally { database.exec('ROLLBACK'); database.close(); }
assert.equal((await api('GET', `/api/Rooms/${room.id}`)).data.price, 500000);
for (let attempt = 0; attempt < 2; attempt++) await api('POST', '/api/Auth/login', { username: 'admin', password: 'wrong' }, 401, '');
const limited = await api('POST', '/api/Auth/login', { username: 'admin', password: 'wrong' }, 429, '');
envelope(limited, 429);
assert.ok(Number(limited.response.headers.get('retry-after')) > 0);
const logPath = path.join(root, 'server.log');
let log;
for (let attempt = 0; attempt < 20; attempt++) {
  log = await readFile(logPath, 'utf8');
  if (traces.every(trace => log.includes(trace))) break;
  await new Promise(resolve => setTimeout(resolve, 25));
}
for (const trace of traces) assert.ok(log.includes(trace), 'The server log should contain the support trace ID.');
assert.ok(!log.includes(token));
assert.ok(!log.includes('Fixture-admin-final-123!'));

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserContext = { window: {} };
vm.runInNewContext(await readFile(path.join(project, 'wwwroot/api-errors.js'), 'utf8'), browserContext);
const format = browserContext.window.hotelApiError;
const response = status => ({ status, headers: new Headers({ 'X-Trace-Id': 'fixture-trace-123' }) });
assert.match(format(response(500), null), /Máy chủ gặp lỗi.*fixture-trace-123/);
assert.ok(!format(response(500), { title: 'Private exception detail' }).includes('Private exception'));
assert.equal(format(response(400), { message: 'Generic', errors: { Price: ['Giá tối đa 2 chữ số thập phân.'] } }), 'Giá tối đa 2 chữ số thập phân.');
assert.match(format(response(403), null), /không có quyền/);
assert.ok(!format(response(500), { traceId: '<script>' }).includes('<script>'));
console.log(`API errors: ${checks} HTTP checks plus 5 frontend formatter checks passed, including real 500 faults, trace/log correlation and SQLite lock handling.`);

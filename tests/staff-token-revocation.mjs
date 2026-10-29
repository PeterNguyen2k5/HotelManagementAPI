import assert from 'node:assert/strict';

// Creates disposable staff/customer accounts and changes their test passwords.
assert.equal(process.env.HOTEL_TEST_ISOLATED, '1', 'Use only a disposable database with HOTEL_TEST_ISOLATED=1.');
const base = process.env.HOTEL_URL;
assert.ok(base, 'Set HOTEL_URL to the isolated test server.');
let checks = 0;
async function api(method, path, body, expected = 200, token) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  const allowed = Array.isArray(expected) ? expected : [expected];
  assert.ok(allowed.includes(response.status), `${method} ${path}: expected ${allowed}, got ${response.status}`);
  checks++;
  return { status: response.status, data: raw ? JSON.parse(raw) : undefined };
}
const login = async (username, password, status = 200) =>
  (await api('POST', '/api/Auth/login', { username, password }, status)).data;
const me = (token, status = 200) => api('GET', '/api/Auth/me', undefined, status, token);
const change = (token, oldPassword, newPassword, status = 200) =>
  api('POST', '/api/Auth/change-password', { oldPassword, newPassword }, status, token);
const stamp = Date.now().toString();
const oldPassword = 'Sample-old-123';
const newPassword = 'Sample-new-456';
const admin = await login('admin', process.env.HOTEL_ADMIN_PASSWORD || 'Fixture-admin-final-123!');
const createStaff = async name => (await api('POST', '/api/Users', {
  username: name + stamp, password: oldPassword, fullName: 'Kiểm thử thu hồi JWT', role: 'Receptionist'
}, 201, admin.token)).data;
const staff = await createStaff('revoked');
const other = await createStaff('unaffected');
const first = await login(staff.username, oldPassword);
// JWT timestamps have second precision; ensure these are distinct issued tokens.
await new Promise(resolve => setTimeout(resolve, 1100));
const second = await login(staff.username, oldPassword);
assert.notEqual(first.token, second.token);
const otherSession = await login(other.username, oldPassword);
const guest = (await api('POST', '/api/CustomerAuth/register', {
  username: 'guest' + stamp, password: 'Guest-sample-123', fullName: 'Khách kiểm thử',
  email: `guest${stamp}@example.test`, phone: '0901234567'
}, 201)).data;
await me(first.token);
await me(second.token);
await change(first.token, 'Wrong-password', newPassword, 400);
await change(first.token, oldPassword, 'short', 400);
await me(first.token);
await me(second.token);
await change(guest.token, oldPassword, newPassword, 403);
const changed = await change(first.token, oldPassword, newPassword);
assert.match(changed.data.message, /đăng nhập lại/);
await me(first.token, 401);
await me(second.token, 401);
await api('GET', '/api/Rooms', undefined, 401, first.token);
await change(second.token, newPassword, oldPassword, 401);
await me(admin.token);
await me(otherSession.token);
await api('GET', '/api/CustomerAuth/me', undefined, 200, guest.token);
const current = await login(staff.username, newPassword);
await me(current.token);
await api('GET', '/api/Reports/rooms', undefined, 403, current.token);

if (process.send) {
  // The isolated harness restarts the app with the SAME database and signing key.
  // No tokens or passwords are sent over IPC or written to files.
  const restarted = new Promise((resolve, reject) => {
    process.once('message', message => message?.type === 'restarted' ? resolve() : reject(new Error('Unexpected harness message')));
  });
  process.send({ type: 'restart' });
  await restarted;
  await me(first.token, 401);
  await me(second.token, 401);
  await me(current.token);
  await me(otherSession.token);
  await api('GET', '/api/CustomerAuth/me', undefined, 200, guest.token);
  await login(staff.username, oldPassword, 401);
  const afterRestart = await login(staff.username, newPassword);
  // Reusing the same password must still revoke all previously issued sessions.
  await change(afterRestart.token, newPassword, newPassword);
  await me(current.token, 401);
  await me(afterRestart.token, 401);
  const afterSamePassword = await login(staff.username, newPassword);
  await change(afterSamePassword.token, newPassword, oldPassword);
  await me(first.token, 401);
  await me(second.token, 401);
  await me(afterSamePassword.token, 401);
  const restored = await login(staff.username, oldPassword);
  const changes = await Promise.all([
    change(restored.token, oldPassword, 'Concurrent-left-123', [200, 401, 409]),
    change(restored.token, oldPassword, 'Concurrent-right-123', [200, 401, 409])
  ]);
  assert.equal(changes.filter(result => result.status === 200).length, 1);
  const winningPassword = changes[0].status === 200 ? 'Concurrent-left-123' : 'Concurrent-right-123';
  await me(restored.token, 401);
  const winner = await login(staff.username, winningPassword);
  await me(winner.token);
  for (const session of [first, second, current, afterRestart, afterSamePassword, restored]) {
    await me(session.token, 401);
  }
  await me(admin.token);
  await me(otherSession.token);
  await api('GET', '/api/CustomerAuth/me', undefined, 200, guest.token);
  console.log('Restart persistence, same-password changes, restored passwords and concurrent password changes passed.');
}
console.log(`Staff JWT revocation: ${checks} API checks passed; other staff and customer sessions remain valid.`);
if (process.connected) process.disconnect();

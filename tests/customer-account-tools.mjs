import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// This suite must run in an isolated harness with its own database and mail folder.
assert.equal(process.env.HOTEL_TEST_ISOLATED, '1');
assert.ok(process.send, 'Run with the isolated IPC harness so rate-limit windows can be restarted.');
const base = process.env.HOTEL_URL;
const mailFolder = process.env.HOTEL_TEST_MAIL_FOLDER;
assert.ok(base && mailFolder);
let checks = 0;
async function api(method, route, body, expected = 200, token) {
  const response = await fetch(base + route, {
    method, headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status),
    `${method} ${route}: expected ${expected}, got ${response.status}`);
  checks++;
  return { data: raw ? JSON.parse(raw) : undefined, status: response.status, retryAfter: response.headers.get('retry-after') };
}
async function restart() {
  const ready = new Promise((resolve, reject) => process.once('message', message =>
    message?.type === 'restarted' ? resolve() : reject(new Error('Unexpected harness response'))));
  process.send({ type: 'restart' });
  await ready;
}
const mailNames = async () => (await readdir(mailFolder).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error))).filter(name => name.endsWith('.eml'));
async function sentToken(email) {
  const before = new Set(await mailNames());
  const result = await api('POST', '/api/CustomerAuth/forgot-password', { email });
  assert.equal(result.data.token, undefined);
  assert.equal(result.data.resetToken, undefined);
  const created = (await mailNames()).filter(name => !before.has(name));
  assert.equal(created.length, 1, 'Exactly one local email should be written.');
  const raw = await readFile(path.join(mailFolder, created[0]), 'utf8');
  const split = raw.search(/\r?\n\r?\n/);
  const headers = raw.slice(0, split);
  assert.ok(headers.split(/\r?\n/).some(line => line.toLowerCase().startsWith('to:') &&
    line.toLowerCase().includes(email.trim().toLowerCase())), 'Recovery mail must target the requested account email.');
  let body = raw.slice(split).trim();
  if (/Content-Transfer-Encoding:\s*base64/i.test(headers)) body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8');
  else if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(headers)) body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const link = new URL(body.match(/https?:\/\/[^\s<>]+/)[0]);
  assert.equal(link.origin, new URL(base).origin);
  assert.equal(link.pathname, '/hotel.html');
  assert.equal(link.search, '');
  const token = new URLSearchParams(link.hash.slice(1)).get('resetToken');
  assert.ok(token);
  const exposed = await fetch(base + '/App_Data/mail/' + created[0]);
  assert.ok(!(await exposed.text()).includes(token));
  checks++;
  return { token, response: result.data };
}
const stamp = Date.now().toString();
const oldPassword = 'Guest-old-123';
const changedPassword = 'Guest-change-456';
const email = `account${stamp}@example.test`;
const secondEmail = `other${stamp}@example.test`;
const payload = { username: 'account' + stamp, password: oldPassword, fullName: 'Khách A', phone: '0901234567', email };
const first = (await api('POST', '/api/CustomerAuth/register', payload, 201)).data;
const other = (await api('POST', '/api/CustomerAuth/register', { ...payload, username: 'other' + stamp, email: secondEmail, fullName: 'Khách B' }, 201)).data;
const staff = (await api('POST', '/api/Auth/login', { username: 'admin', password: process.env.HOTEL_ADMIN_PASSWORD || 'Fixture-admin-final-123!' })).data;
const me = (token, status = 200) => api('GET', '/api/CustomerAuth/me', undefined, status, token);
const login = async (password, status = 200) => (await api('POST', '/api/CustomerAuth/login', { username: payload.username, password }, status)).data;
const change = (token, old, next, status = 200) => api('POST', '/api/CustomerAuth/change-password', { oldPassword: old, newPassword: next }, status, token);
const reset = (token, password, status = 200) => api('POST', '/api/CustomerAuth/reset-password', { token, newPassword: password }, status);
const originalLink = await sentToken(email);
const profile = { fullName: 'Khách A cập nhật', phone: '0912345678', email, address: 'Địa chỉ kiểm thử', identityCard: 'TEST12345', role: 'Admin', customerId: other.account.customerId, username: other.account.username };
await api('PUT', '/api/CustomerAuth/me', profile, 401);
await api('PUT', '/api/CustomerAuth/me', profile, 403, staff.token);
await api('POST', '/api/CustomerAuth/change-password', { oldPassword, newPassword: changedPassword }, 403, staff.token);
await api('PUT', '/api/CustomerAuth/me', { ...profile, fullName: ' ' }, 400, first.token);
const saved = (await api('PUT', '/api/CustomerAuth/me', profile, 200, first.token)).data;
assert.equal(saved.fullName, profile.fullName);
assert.equal(saved.address, profile.address);
assert.equal(saved.identityCard, profile.identityCard);
assert.equal(saved.username, payload.username);
assert.equal(saved.customerId, first.account.customerId);
assert.equal(saved.passwordHash, undefined);
assert.equal((await me(other.token)).data.fullName, 'Khách B');
const newEmail = `updated${stamp}@example.test`;
await api('PUT', '/api/CustomerAuth/me', { ...profile, email: newEmail }, 400, first.token);
await api('PUT', '/api/CustomerAuth/me', { ...profile, email: newEmail, currentPassword: 'wrong' }, 400, first.token);
await api('PUT', '/api/CustomerAuth/me', { ...profile, email: secondEmail, currentPassword: oldPassword }, 409, first.token);
assert.equal((await me(first.token)).data.email, email);
await api('PUT', '/api/CustomerAuth/me', { ...profile, email: newEmail.toUpperCase(), currentPassword: oldPassword }, 200, first.token);
const synced = (await api('GET', '/api/Customers/' + first.account.customerId, undefined, 200, staff.token)).data;
assert.equal(synced.email, newEmail);
assert.equal(synced.fullName, profile.fullName);
assert.equal(synced.identityCard, profile.identityCard);
await reset(originalLink.token, changedPassword, 400);
const beforeUnknown = (await mailNames()).length;
const unknown = (await api('POST', '/api/CustomerAuth/forgot-password', { email: 'unknown' + stamp + '@example.test' })).data;
assert.deepEqual(unknown, originalLink.response);
assert.equal((await mailNames()).length, beforeUnknown);
const pending = await sentToken(newEmail);

await restart();
const secondSession = await login(oldPassword);
await change(first.token, 'wrong', changedPassword, 400);
await change(first.token, oldPassword, 'short', 400);
await change(first.token, oldPassword, 'á'.repeat(40), 400);
await me(first.token);
await change(first.token, oldPassword, changedPassword);
await me(first.token, 401);
await me(secondSession.token, 401);
await change(first.token, changedPassword, oldPassword, 401);
const limited = await change(other.token, oldPassword, changedPassword, 429);
assert.ok(Number(limited.retryAfter) > 0);
await login(oldPassword, 401);
const current = await login(changedPassword);
assert.equal((await me(current.token)).data.email, newEmail);
await reset(pending.token, oldPassword, 400);
await me(other.token);
await api('GET', '/api/Auth/me', undefined, 200, staff.token);

await restart();
await me(current.token);
await me(first.token, 401);
const recovery = await sentToken(newEmail);
const oldUnconsumedLink = await sentToken(newEmail);
await reset('tampered-token', 'Guest-reset-789', 400);
await reset(recovery.token, 'short', 400);
await reset(recovery.token, 'á'.repeat(40), 400);
await reset(recovery.token, 'Guest-reset-789');
await reset(recovery.token, 'Guest-reuse-123', 400);
await reset(oldUnconsumedLink.token, 'Guest-reuse-123', 429);
await me(current.token, 401);
await login(changedPassword, 401);
const recovered = await login('Guest-reset-789');
for (let attempt = 0; attempt < 3; attempt++) {
  const response = await api('POST', '/api/CustomerAuth/forgot-password', { email: `unknown${attempt}${stamp}@example.test` });
  assert.deepEqual(response.data, recovery.response);
}
const mailCount = (await mailNames()).length;
await api('POST', '/api/CustomerAuth/forgot-password', { email: newEmail }, 429);
assert.equal((await mailNames()).length, mailCount);

await restart();
await me(recovered.token);
await reset(oldUnconsumedLink.token, 'Guest-reuse-123', 400);
const concurrent = await sentToken(newEmail);
const attempts = await Promise.all([
  reset(concurrent.token, 'Winner-left-123', [200, 400, 409]),
  reset(concurrent.token, 'Winner-right-123', [200, 400, 409])
]);
assert.equal(attempts.filter(result => result.status === 200).length, 1);
const winningPassword = attempts[0].status === 200 ? 'Winner-left-123' : 'Winner-right-123';
const losingPassword = attempts[0].status === 200 ? 'Winner-right-123' : 'Winner-left-123';
await reset(concurrent.token, 'Guest-reuse-123', 400);
await me(recovered.token, 401);
const winner = await login(winningPassword);
await login(losingPassword, 401);
await change(winner.token, winningPassword, oldPassword);
for (const session of [first, secondSession, current, recovered, winner]) await me(session.token, 401);
const restored = await login(oldPassword);
assert.equal((await me(restored.token)).data.address, profile.address);
await me(other.token);
await api('GET', '/api/Auth/me', undefined, 200, staff.token);

// Staff edits must follow the same email rules as customer self-service.
await restart();
const customerRoute = '/api/Customers/' + first.account.customerId;
const staffEmail = `staff-updated${stamp}@example.test`;
const clerkEmail = `clerk-updated${stamp}@example.test`;
const staffProfile = { ...profile, fullName: 'Hồ sơ cập nhật bởi nhân viên', email: staffEmail.toUpperCase() };
const previousRecovery = await sentToken(newEmail);
async function fixtureDb(action) {
  assert.ok(process.env.HOTEL_TEST_DB);
  assert.equal(path.resolve(process.env.HOTEL_TEST_DB), path.resolve(mailFolder, '../..', 'hotel.db'));
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(process.env.HOTEL_TEST_DB);
  try { return action(db); } finally { db.close(); }
}
if (process.env.HOTEL_TEST_DB) {
  // Reproduce data left inconsistent by older versions, using only the harness database.
  await fixtureDb(db => db.prepare('UPDATE Customers SET Email = ? WHERE Id = ?').run('legacy-mismatch@example.test', first.account.customerId));
}
await api('PUT', customerRoute, staffProfile, 401);
await api('PUT', customerRoute, staffProfile, 403, other.token);
const staffSaved = (await api('PUT', customerRoute, staffProfile, 200, staff.token)).data;
assert.equal(staffSaved.email, staffEmail);
const staffSynced = (await me(restored.token)).data;
assert.equal(staffSynced.email, staffEmail);
assert.equal(staffSynced.fullName, staffProfile.fullName);
assert.equal(staffSynced.customerId, first.account.customerId);
assert.equal(staffSynced.id, first.account.id);
assert.equal(staffSynced.username, payload.username);
await reset(previousRecovery.token, 'Must-not-reset-123', 400);
const beforeOldEmail = (await mailNames()).length;
const oldEmailResponse = (await api('POST', '/api/CustomerAuth/forgot-password', { email: newEmail })).data;
assert.deepEqual(oldEmailResponse, previousRecovery.response);
assert.equal((await mailNames()).length, beforeOldEmail, 'The old address must receive no new recovery mail.');
const staffRecovery = await sentToken(staffEmail);

const beforeRejected = (await api('GET', customerRoute, undefined, 200, staff.token)).data;
await api('PUT', customerRoute, { ...staffProfile, email: secondEmail.toUpperCase(), fullName: 'Must not persist', address: 'Must not persist' }, 409, staff.token);
for (const invalidEmail of [null, '', ' ', 'not-an-email'])
  await api('PUT', customerRoute, { ...staffProfile, email: invalidEmail, fullName: 'Must not persist' }, 400, staff.token);
assert.deepEqual((await api('GET', customerRoute, undefined, 200, staff.token)).data, beforeRejected);
assert.deepEqual((await me(restored.token)).data, staffSynced);
assert.equal((await me(other.token)).data.email, secondEmail);
await api('PUT', '/api/Customers/2147483647', staffProfile, 404, staff.token);

const racing = await Promise.all([
  api('PUT', customerRoute, { ...staffProfile, email: `staff-race${stamp}@example.test`, fullName: 'Staff race winner' }, [200, 409], staff.token),
  api('PUT', '/api/CustomerAuth/me', { ...profile, email: `guest-race${stamp}@example.test`, currentPassword: oldPassword, fullName: 'Guest race winner' }, [200, 409], restored.token)
]);
assert.ok(racing.some(result => result.status === 200));
const raceCustomer = (await api('GET', customerRoute, undefined, 200, staff.token)).data;
const raceAccount = (await me(restored.token)).data;
assert.equal(raceCustomer.email, raceAccount.email);
assert.equal(raceCustomer.fullName, raceAccount.fullName);
assert.ok([`staff-race${stamp}@example.test`, `guest-race${stamp}@example.test`].includes(raceAccount.email));

const clerk = (await api('POST', '/api/Users', { username: 'emailclerk' + stamp, password: 'Clerk-12345', fullName: 'Lễ tân kiểm thử', role: 'Receptionist' }, 201, staff.token)).data;
const clerkSession = (await api('POST', '/api/Auth/login', { username: clerk.username, password: 'Clerk-12345' })).data;
const clerkSaved = (await api('PUT', customerRoute, { ...staffProfile, email: '  ' + clerkEmail.toUpperCase() + '  ' }, 200, clerkSession.token)).data;
assert.equal(clerkSaved.email, clerkEmail);
assert.equal((await me(restored.token)).data.email, clerkEmail);
await reset(staffRecovery.token, 'Must-not-reset-456', 400);
const clerkRecovery = await sentToken(clerkEmail);
await reset(clerkRecovery.token, 'Staff-email-reset-123');
await me(restored.token, 401);
const emailRecovered = await login('Staff-email-reset-123');
assert.equal((await me(emailRecovered.token)).data.email, clerkEmail);

const walkIn = (await api('POST', '/api/Customers', { fullName: 'Khách chưa có tài khoản', email: null }, 201, clerkSession.token)).data;
await api('PUT', '/api/Customers/' + walkIn.id, { fullName: walkIn.fullName, email: 'WALKIN@EXAMPLE.TEST' }, 200, clerkSession.token);
const clearedWalkIn = (await api('PUT', '/api/Customers/' + walkIn.id, { fullName: walkIn.fullName, email: '' }, 200, clerkSession.token)).data;
assert.equal(clearedWalkIn.email, null);
if (process.env.HOTEL_TEST_DB) {
  await fixtureDb(db => {
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM CustomerAccounts WHERE CustomerId = ?').get(walkIn.id).count, 0);
    db.prepare('UPDATE CustomerAccounts SET IsActive = 0 WHERE Id = ?').run(other.account.id);
  });
  try {
    const inactiveEmail = `inactive-updated${stamp}@example.test`;
    await api('PUT', '/api/Customers/' + other.account.customerId, { fullName: 'Khách B', email: inactiveEmail.toUpperCase() }, 200, clerkSession.token);
    await fixtureDb(db => {
      const account = db.prepare('SELECT Email, IsActive FROM CustomerAccounts WHERE Id = ?').get(other.account.id);
      assert.equal(account.Email, inactiveEmail); assert.equal(account.IsActive, 0);
    });
    assert.equal((await api('GET', '/api/Customers/' + other.account.customerId, undefined, 200, staff.token)).data.email, inactiveEmail);
    await me(other.token, 401);
  } finally {
    await fixtureDb(db => db.prepare('UPDATE CustomerAccounts SET IsActive = 1 WHERE Id = ?').run(other.account.id));
  }
}
console.log(`Customer account tools: ${checks} checks passed (profile ownership, staff/customer email synchronization, duplicate rollback, concurrent edits, local recovery mail, password/JWT revocation and rate limits).`);
process.disconnect();

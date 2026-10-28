import assert from 'node:assert/strict';

// Creates bookings and changes room states. Use only a disposable database.
assert.equal(process.env.HOTEL_TEST_ISOLATED, '1', 'Use HOTEL_TEST_ISOLATED=1 for an isolated test database.');
const base = process.env.HOTEL_URL;
assert.ok(base);
let token;
let checks = 0;
async function api(method, path, body, expected = 200, auth = token) {
  const response = await fetch(base + path, {
    method, headers: {
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    }, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(response.status),
    `${method} ${path}: expected ${expected}, got ${response.status}`);
  checks++;
  return { status: response.status, data: raw ? JSON.parse(raw) : undefined };
}
token = (await api('POST', '/api/Auth/login', {
  username: 'admin', password: process.env.HOTEL_ADMIN_PASSWORD || 'Fixture-admin-final-123!'
})).data.token;
const stamp = Date.now().toString().slice(-8);
const type = (await api('POST', '/api/RoomTypes', { name: `Status race ${stamp}` }, 201)).data;
const room = (await api('POST', '/api/Rooms', {
  roomNumber: `R${stamp}`, roomTypeId: type.id, capacity: 2, price: 500000
}, 201)).data;
const customer = (await api('POST', '/api/Customers', { fullName: `Status race ${stamp}` }, 201)).data;
const clerk = (await api('POST', '/api/Users', {
  username: `statusclerk${stamp}`, password: 'Fixture123', fullName: 'Lễ tân kiểm thử', role: 'Receptionist'
}, 201)).data;
const clerkSession = (await api('POST', '/api/Auth/login', { username: clerk.username, password: 'Fixture123' })).data;
const guest = (await api('POST', '/api/CustomerAuth/register', {
  username: `statusguest${stamp}`, password: 'Fixture123', fullName: 'Khách kiểm thử', phone: '0901234567', email: `statusguest${stamp}@example.test`
}, 201)).data;
const patch = (status, expected = 200, auth = token) => api('PATCH', `/api/Rooms/${room.id}/trang-thai`, status, expected, auth);
const date = offset => {
  const value = new Date(); value.setDate(value.getDate() + offset);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
};
async function prepare() {
  assert.equal((await api('GET', `/api/Rooms/${room.id}`)).data.status, 0);
  return (await api('POST', '/api/Bookings', {
    customerId: customer.id, roomId: room.id, guestCount: 1,
    checkInDate: date(0), checkOutDate: date(1)
  }, 201)).data;
}
async function cleanup(booking) {
  const stored = (await api('GET', `/api/Bookings/${booking.id}`)).data;
  if (stored.status === 'CheckedIn') await api('POST', `/api/Bookings/${booking.id}/check-out`);
  else await api('POST', `/api/Bookings/${booking.id}/cancel`);
  const state = (await api('GET', `/api/Rooms/${room.id}`)).data.status;
  if (state === 3) await api('POST', `/api/Housekeeping/${room.id}/complete`);
  else if (state === 2) await patch(0);
  assert.equal((await api('GET', `/api/Rooms/${room.id}`)).data.status, 0);
}
await patch(2, 401, '');
await patch(2, 403, clerkSession.token);
await patch(2, 403, guest.token);
for (const invalid of [-1, 4, null, 'invalid']) await patch(invalid, 400);
await api('PATCH', '/api/Rooms/2147483647/trang-thai', 2, 404);
await patch(1, 409);

// Verify each possible ordering independently of scheduling.
for (const state of [2, 3]) {
  const booking = await prepare();
  await patch(state);
  await api('POST', `/api/Bookings/${booking.id}/check-in`, undefined, 409);
  assert.equal((await api('GET', `/api/Bookings/${booking.id}`)).data.status, 'Reserved');
  assert.equal((await api('GET', `/api/Rooms/${room.id}`)).data.status, state);
  await cleanup(booking);
}
const checkedInFirst = await prepare();
await api('POST', `/api/Bookings/${checkedInFirst.id}/check-in`);
for (const state of [0, 2, 3]) await patch(state, 409);
await patch(1);
assert.equal((await api('GET', `/api/Rooms/${room.id}`)).data.status, 1);
await api('POST', `/api/Bookings/${checkedInFirst.id}/check-out`);
await patch(0, 409);
await api('POST', `/api/Housekeeping/${room.id}/complete`);

const outcomes = { statusFirst: 0, checkInFirst: 0, busy: 0 };
for (let attempt = 0; attempt < 32; attempt++) {
  const booking = await prepare();
  const state = attempt % 4 < 2 ? 2 : 3;
  const update = () => patch(state, [200, 409]);
  const checkIn = () => api('POST', `/api/Bookings/${booking.id}/check-in`, undefined, [200, 409]);
  let updateResult, checkInResult;
  if (attempt % 2 === 0) [updateResult, checkInResult] = await Promise.all([update(), checkIn()]);
  else [checkInResult, updateResult] = await Promise.all([checkIn(), update()]);
  const storedRoom = (await api('GET', `/api/Rooms/${room.id}`)).data;
  const storedBooking = (await api('GET', `/api/Bookings/${booking.id}`)).data;
  assert.ok(!(updateResult.status === 200 && checkInResult.status === 200), 'Conflicting operations must not both succeed.');
  if (checkInResult.status === 200) {
    outcomes.checkInFirst++;
    assert.equal(storedRoom.status, 1);
    assert.equal(storedBooking.status, 'CheckedIn');
    assert.ok(storedBooking.actualCheckInAt);
  } else {
    assert.equal(storedBooking.status, 'Reserved');
    assert.equal(storedBooking.actualCheckInAt, null);
    assert.equal(storedRoom.status, updateResult.status === 200 ? state : 0);
    outcomes[updateResult.status === 200 ? 'statusFirst' : 'busy']++;
  }
  await cleanup(booking);
}

if (process.env.HOTEL_TEST_DB) {
  const { DatabaseSync } = await import('node:sqlite');
  const booking = await prepare();
  const database = new DatabaseSync(process.env.HOTEL_TEST_DB);
  try {
    database.exec('BEGIN IMMEDIATE');
    const blocked = await patch(2, 409);
    assert.match(blocked.data.message, /đang được cập nhật/);
  } finally { database.exec('ROLLBACK'); database.close(); }
  assert.equal((await api('GET', `/api/Rooms/${room.id}`)).data.status, 0);
  assert.equal((await api('GET', `/api/Bookings/${booking.id}`)).data.status, 'Reserved');
  await api('POST', `/api/Bookings/${booking.id}/check-in`);
  await cleanup(booking);
}
console.log(`Room status/check-in: ${checks} API checks passed; 32 simultaneous pairs (${JSON.stringify(outcomes)}), booking and room states consistent.`);

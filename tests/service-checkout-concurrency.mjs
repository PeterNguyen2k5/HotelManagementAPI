import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// This suite creates and checks out bookings. Use a disposable database only.
assert.equal(process.env.HOTEL_TEST_ISOLATED, '1', 'Set HOTEL_TEST_ISOLATED=1 for a disposable test database.');
const base = process.env.HOTEL_URL;
assert.ok(base, 'Set HOTEL_URL to the isolated server.');
let token;
let checks = 0;
async function api(method, path, body, expected = 200, auth = token) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
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
const stamp = Date.now().toString().slice(-8);
token = (await api('POST', '/api/Auth/login', {
  username: 'admin', password: process.env.HOTEL_ADMIN_PASSWORD || 'Fixture-admin-final-123!'
})).data.token;
const date = offset => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(value);
};
const today = date(0);
const revenuePath = `/api/Reports/revenue?from=${today}&to=${today}`;
const originalRevenue = (await api('GET', revenuePath)).data;
const type = (await api('POST', '/api/RoomTypes', { name: `Concurrent ${stamp}` }, 201)).data;
const room = (await api('POST', '/api/Rooms', {
  roomNumber: `C${stamp}`, roomTypeId: type.id, price: 123.45
}, 201)).data;
const customer = (await api('POST', '/api/Customers', { fullName: `Concurrent ${stamp}` }, 201)).data;
const service = (await api('POST', '/api/Services', {
  name: `Concurrent ${stamp}`, unit: 'Lần', price: 50.25
}, 201)).data;
let expectedServiceCents = 0;
let completed = 0;
const outcomes = { deletedFirst: 0, checkoutFirst: 0 };
async function prepare() {
  const booking = (await api('POST', '/api/Bookings', {
    customerId: customer.id, roomId: room.id, guestCount: 1,
    checkInDate: today, checkOutDate: date(1)
  }, 201)).data;
  await api('POST', `/api/Bookings/${booking.id}/check-in`);
  const usage = (await api('POST', '/api/Services/usage', {
    requestId: randomUUID(), bookingId: booking.id, serviceId: service.id, quantity: 2
  }, 201)).data;
  return { booking, usage };
}
async function verify({ booking, usage }, removed) {
  const expectedService = removed ? 0 : 100.5;
  const stored = (await api('GET', `/api/Bookings/${booking.id}`)).data;
  const usages = (await api('GET', `/api/Services/usage/booking/${booking.id}`)).data;
  const invoice = (await api('GET', `/api/BookingOperations/${booking.id}/invoice`)).data;
  assert.equal(stored.status, 'CheckedOut');
  assert.equal(stored.serviceTotal, expectedService);
  assert.equal(usages.length, removed ? 0 : 1);
  assert.equal(invoice.detail.services.length, usages.length);
  assert.equal(invoice.detail.serviceTotal, expectedService);
  assert.equal(invoice.detail.total, stored.totalAmount);
  assert.equal(invoice.balance.total, stored.totalAmount);
  await api('DELETE', `/api/Services/usage/${usage.id}`, undefined, removed ? 404 : 409);
  const unchanged = (await api('GET', `/api/BookingOperations/${booking.id}/invoice`)).data;
  assert.deepEqual(unchanged.detail, invoice.detail);
  expectedServiceCents += removed ? 0 : 10050;
  completed++;
  await api('POST', `/api/Housekeeping/${room.id}/complete`);
}

await api('DELETE', '/api/Services/usage/2147483647', undefined, 404);
const deletedFirst = await prepare();
await api('DELETE', `/api/Services/usage/${deletedFirst.usage.id}`, undefined, 401, '');
await api('DELETE', `/api/Services/usage/${deletedFirst.usage.id}`, undefined, 204);
await api('POST', `/api/Bookings/${deletedFirst.booking.id}/check-out`);
await verify(deletedFirst, true);
const checkedOutFirst = await prepare();
await api('POST', `/api/Bookings/${checkedOutFirst.booking.id}/check-out`);
await api('DELETE', `/api/Services/usage/${checkedOutFirst.usage.id}`, undefined, 409);
await verify(checkedOutFirst, false);

for (let attempt = 0; attempt < 24; attempt++) {
  const fixture = await prepare();
  const remove = () => api('DELETE', `/api/Services/usage/${fixture.usage.id}`, undefined, [204, 409]);
  const checkout = () => api('POST', `/api/Bookings/${fixture.booking.id}/check-out`, undefined, [200, 409]);
  let deletion, departure;
  if (attempt % 2 === 0) [deletion, departure] = await Promise.all([remove(), checkout()]);
  else [departure, deletion] = await Promise.all([checkout(), remove()]);
  if (departure.status === 409) await api('POST', `/api/Bookings/${fixture.booking.id}/check-out`);
  const removed = deletion.status === 204;
  outcomes[removed ? 'deletedFirst' : 'checkoutFirst']++;
  await verify(fixture, removed);
}

// Optional lock-contention check; HOTEL_TEST_DB must identify this disposable server's database.
if (process.env.HOTEL_TEST_DB) {
  const { DatabaseSync } = await import('node:sqlite');
  const fixture = await prepare();
  const database = new DatabaseSync(process.env.HOTEL_TEST_DB);
  try {
    database.exec('BEGIN IMMEDIATE');
    const blocked = await api('DELETE', `/api/Services/usage/${fixture.usage.id}`, undefined, 409);
    assert.match(blocked.data.message, /đang được cập nhật/);
  } finally {
    database.exec('ROLLBACK');
    database.close();
  }
  const preserved = (await api('GET', `/api/Services/usage/booking/${fixture.booking.id}`)).data;
  assert.equal(preserved.length, 1);
  await api('DELETE', `/api/Services/usage/${fixture.usage.id}`, undefined, 204);
  await api('POST', `/api/Bookings/${fixture.booking.id}/check-out`);
  await verify(fixture, true);
}
const revenue = (await api('GET', revenuePath)).data;
assert.equal(revenue.bookings, originalRevenue.bookings + completed);
assert.equal(Math.round((revenue.serviceRevenue - originalRevenue.serviceRevenue) * 100), expectedServiceCents);
assert.equal(Math.round((revenue.roomRevenue - originalRevenue.roomRevenue) * 100), completed * 12345);
assert.equal(Math.round((revenue.totalRevenue - originalRevenue.totalRevenue) * 100), completed * 12345 + expectedServiceCents);
const popular = (await api('GET', `/api/Reports/popular-services?from=${today}&to=${today}`)).data;
assert.equal(popular.find(row => row.serviceId === service.id)?.revenue ?? 0, expectedServiceCents / 100);
console.log(`Service/check-out concurrency: ${checks} API checks passed; 24 simultaneous pairs (${JSON.stringify(outcomes)}), invoices and revenue consistent.`);

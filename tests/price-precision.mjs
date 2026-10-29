import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Run only against a disposable database: this suite creates rooms, services and a booking.
const base = process.env.HOTEL_URL;
assert.ok(base, 'Set HOTEL_URL to an isolated test server before running this suite.');
let token;
let checks = 0;
async function api(method, path, body, expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
  });
  const raw = await response.text();
  assert.equal(response.status, expected, `${method} ${path}: expected ${expected}, got ${response.status}`);
  checks++;
  return { data: raw ? JSON.parse(raw) : undefined, raw };
}
function withPrice(fields, literal) {
  return JSON.stringify(fields).slice(0, -1) + ',"price":' + literal + '}';
}
const session = await api('POST', '/api/Auth/login', {
  username: 'admin', password: process.env.HOTEL_ADMIN_PASSWORD || 'Fixture-admin-final-123!'
});
token = session.data.token;
const stamp = Date.now().toString().slice(-8);
const type = (await api('POST', '/api/RoomTypes', { name: `Precision ${stamp}` }, 201)).data;
const roomFields = { roomNumber: `P${stamp}`, roomTypeId: type.id, capacity: 2 };
const serviceFields = { name: `Precision ${stamp}`, unit: 'Lần' };
const room = (await api('POST', '/api/Rooms', withPrice(roomFields, '100.99'), 201)).data;
const service = (await api('POST', '/api/Services', withPrice(serviceFields, '100.99'), 201)).data;

for (const [path, fields, update] of [
  ['/api/Rooms', roomFields, { ...roomFields, status: 0 }],
  ['/api/Services', serviceFields, serviceFields]
]) {
  const id = path.endsWith('Rooms') ? room.id : service.id;
  for (const literal of ['100.999', '100.995', '0.001', '1e-3']) {
    for (const [method, target, data] of [['POST', path, fields], ['PUT', `${path}/${id}`, update]]) {
      const result = await api(method, target, withPrice(data, literal), 400);
      assert.ok(result.data.errors.Price.some(message => message.includes('2 chữ số thập phân')));
    }
    assert.equal((await api('GET', `${path}/${id}`)).data.price, 100.99);
  }
  for (const literal of ['-0.01', '10000000000000000', 'null']) {
    await api('POST', path, withPrice(fields, literal), 400);
    await api('PUT', `${path}/${id}`, withPrice(update, literal), 400);
  }
  await api('POST', path, fields, 400);
  await api('PUT', `${path}/${id}`, update, 400);
  for (const literal of ['0', '0.01', '100.9', '100.99', '100.9900', '9999999999999999.99']) {
    const result = await api('PUT', `${path}/${id}`, withPrice(update, literal));
    const stored = await api('GET', `${path}/${id}`);
    if (literal === '9999999999999999.99') {
      // Check raw JSON: Number in JavaScript cannot represent this boundary exactly.
      assert.match(result.raw, /"price":9999999999999999\.99[,}]/);
      assert.match(stored.raw, /"price":9999999999999999\.99[,}]/);
    } else {
      assert.equal(result.data.price, Number(literal));
      assert.equal(stored.data.price, Number(literal));
    }
  }
  await api('PUT', `${path}/${id}`, withPrice(update, '100.99'));
}

const customer = (await api('POST', '/api/Customers', { fullName: `Precision ${stamp}` }, 201)).data;
const date = offset => {
  const value = new Date();
  value.setDate(value.getDate() + offset);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(value);
};
const booking = (await api('POST', '/api/Bookings', {
  customerId: customer.id, roomId: room.id, guestCount: 1,
  checkInDate: date(0), checkOutDate: date(2)
}, 201)).data;
assert.equal(booking.roomTotal, 201.98);
await api('POST', `/api/Bookings/${booking.id}/check-in`);
const usage = (await api('POST', '/api/Services/usage', {
  requestId: randomUUID(), bookingId: booking.id, serviceId: service.id, quantity: 2
}, 201)).data;
assert.equal(usage.unitPrice, 100.99);
assert.equal(usage.total, 201.98);
const checkout = (await api('POST', `/api/Bookings/${booking.id}/check-out`)).data;
assert.equal(checkout.roomTotal, 100.99);
assert.equal(checkout.serviceTotal, 201.98);
assert.equal(checkout.totalAmount, 302.97);
await api('GET', `/api/BookingOperations/${booking.id}/invoice`);
console.log(`Price precision: ${checks} API checks passed, including decimal billing and exact maximum-price round trips.`);

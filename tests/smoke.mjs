import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const base = process.env.HOTEL_URL || 'http://localhost:5057';
let token = '';
let checks = 0;

async function api(method, path, body, expected = 200, auth = token) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(auth ? { authorization: `Bearer ${auth}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const raw = await response.text();
  let value;
  try { value = raw ? JSON.parse(raw) : undefined; } catch { value = raw; }
  assert.equal(response.status, expected,
    `${method} ${path}: expected ${expected}, got ${response.status}: ${raw}`);
  checks++;
  return value;
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const tomorrow = new Date(`${today}T12:00:00+07:00`);
tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
const end = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(tomorrow);
const stamp = Date.now().toString().slice(-9);
const guest = await api('POST', '/api/CustomerAuth/register', {
  username: 'smokeguest'+stamp, password: 'Guest12345', fullName: 'Khách website',
  phone: '0902223344', email: 'smokeguest'+stamp+'@example.com'
}, 201, '');
await api('POST', '/api/Bookings/public', {}, 401, '');

await api('GET', '/api/Rooms', undefined, 401, '');
const login = await api('POST', '/api/Auth/login', { username: 'admin', password: process.env.HOTEL_ADMIN_PASSWORD || 'Fixture-admin-final-123!' }, 200, '');
token = login.token;
assert.equal(login.user.role, 'Admin');
assert.equal((await api('GET', '/api/Auth/me')).username, 'admin');
await api('POST', '/api/Auth/login', { username: 'admin', password: 'wrong' }, 401, '');

const clerk = await api('POST', '/api/Users', { username: `clerk${stamp}`, password: 'sample123', fullName: 'Lễ tân thử nghiệm', role: 'Receptionist' }, 201);
const clerkLogin = await api('POST', '/api/Auth/login', { username: clerk.username, password: 'sample123' }, 200, '');
const registered = await api('POST', '/api/Auth/register', { username: `registered${stamp}`, password: 'sample123', fullName: 'Lễ tân đăng ký', role: 'Admin' }, 201);
assert.equal(registered.role, 'Receptionist');
await api('POST', '/api/Auth/change-password', { oldPassword: 'sample123', newPassword: 'updated123' }, 200, clerkLogin.token);
await api('POST', '/api/Auth/login', { username: clerk.username, password: 'sample123' }, 401, '');
const updatedClerkLogin = await api('POST', '/api/Auth/login', { username: clerk.username, password: 'updated123' }, 200, '');
await api('GET', '/api/Auth/me', undefined, 401, clerkLogin.token);
await api('GET', '/api/Reports/rooms', undefined, 403, updatedClerkLogin.token);
await api('POST', '/api/RoomTypes', { name: `Sai quyen ${stamp}` }, 403, updatedClerkLogin.token);

const type = await api('POST', '/api/RoomTypes', { name: `Standard ${stamp}`, description: 'Kiểm thử' }, 201);
await api('POST', '/api/RoomTypes', { name: type.name }, 409);
assert.equal((await api('GET', `/api/RoomTypes?keyword=${stamp}&pageSize=1`)).totalCount, 1);
await api('PUT', `/api/RoomTypes/${type.id}`, { name: type.name, description: 'Đã cập nhật' });
const room = await api('POST', '/api/Rooms', { roomNumber: `T${stamp}`, roomTypeId: type.id, price: 500000 }, 201);
await api('POST', '/api/Rooms', { roomNumber: room.roomNumber, roomTypeId: type.id, price: 500000 }, 409);
assert.equal((await api('GET', `/api/Rooms?keyword=${stamp}&sortBy=price_desc&pageSize=1`)).totalCount, 1);
await api('PATCH', `/api/Rooms/${room.id}/trang-thai`, 2);
assert.equal((await api('GET', `/api/Bookings/available-rooms?checkInDate=${today}&checkOutDate=${end}`)).some(x => x.id === room.id), false);
await api('PATCH', `/api/Rooms/${room.id}/trang-thai`, 0);
await api('PATCH', `/api/Rooms/${room.id}/trang-thai`, 1, 409);

const customer = await api('POST', '/api/Customers', { fullName: 'Khách thử nghiệm', phone: '0901234567' }, 201);
await api('PUT', `/api/Customers/${customer.id}`, { fullName: 'Khách đã sửa', phone: '0901234567' });
assert.equal((await api('GET', '/api/Customers?keyword=0901234567')).some(x => x.id === customer.id), true);
const available = await api('GET', `/api/Bookings/available-rooms?checkInDate=${today}&checkOutDate=${end}`);
assert.equal(available.some(x => x.id === room.id), true);
assert.equal(room.capacity, 2);
assert.equal((await api('GET', '/api/Bookings/available-rooms?checkInDate='+today+'&checkOutDate='+end+'&guestCount=3')).some(x => x.id === room.id), false);
await api('GET', '/api/Bookings/available-rooms?checkInDate='+today+'&checkOutDate='+end+'&guestCount=0', undefined, 400);
const shiftedDay = offset => {
  const value = new Date(today + 'T00:00:00Z');
  value.setUTCDate(value.getUTCDate() + offset);
  return value.toISOString().slice(0, 10);
};
const beforePastBookings = await api('GET', '/api/Bookings?customerId=' + customer.id);
for (const staffToken of [token, updatedClerkLogin.token]) {
  for (const [checkInDate, checkOutDate] of [
    [shiftedDay(-3), shiftedDay(-2)],
    [shiftedDay(-1), today],
    [shiftedDay(-1), end],
    [shiftedDay(-1) + 'T23:59:59', end]
  ]) {
    const rejected = await api('POST', '/api/Bookings', {
      customerId: customer.id, roomId: room.id, guestCount: 1, checkInDate, checkOutDate
    }, 400, staffToken);
    assert.equal(rejected.message, 'Ngày nhận phòng không thể ở trong quá khứ.');
  }
}
assert.equal((await api('GET', '/api/Bookings?customerId=' + customer.id)).totalCount, beforePastBookings.totalCount);
assert.equal((await api('GET', '/api/Rooms/' + room.id)).status, 0);
await api('POST', '/api/Bookings/public', {
  fullName: 'Khách website', phone: '0902223344', roomId: room.id, guestCount: 1,
  checkInDate: shiftedDay(-1), checkOutDate: end
}, 400, guest.token);
const futureReservation = await api('POST', '/api/Bookings', {
  customerId: guest.account.customerId, roomId: room.id, guestCount: 1,
  checkInDate: shiftedDay(2) + 'T12:00:00', checkOutDate: shiftedDay(3) + 'T18:00:00'
}, 201, updatedClerkLogin.token);
assert.equal(futureReservation.status, 'Reserved');
assert.equal(futureReservation.checkInDate.slice(0, 10), shiftedDay(2));
assert.equal(futureReservation.nights, 1);
await api('POST', '/api/Bookings/' + futureReservation.id + '/cancel', undefined, 200, updatedClerkLogin.token);
await api('POST', '/api/Bookings', { customerId: customer.id, roomId: room.id, checkInDate: today, checkOutDate: end, guestCount: 3 }, 400);
await api('POST', '/api/Bookings', { customerId: customer.id, roomId: room.id, checkInDate: today, checkOutDate: end, guestCount: 1.5 }, 400);
await api('POST', '/api/Bookings/public', { fullName: 'Khách quá sức chứa', phone: '0902223344', roomId: room.id, checkInDate: today, checkOutDate: end, guestCount: 3 }, 400, guest.token);
const booking = await api('POST', '/api/Bookings', { customerId: customer.id, roomId: room.id, checkInDate: today, checkOutDate: end, guestCount: 2 }, 201);
assert.equal((await api('GET', '/api/Bookings/'+booking.id)).guestCount, 2);
await api('PUT', '/api/Rooms/'+room.id, { roomNumber: room.roomNumber, roomTypeId: type.id, price: room.price, status: 0, capacity: 1 }, 409);
assert.equal(booking.roomTotal, 500000);
await api('POST', '/api/Bookings', { customerId: customer.id, roomId: room.id, checkInDate: today, checkOutDate: end }, 409);
await api('DELETE', `/api/Rooms/${room.id}`, undefined, 409);
await api('DELETE', `/api/Customers/${customer.id}`, undefined, 409);
await api('DELETE', `/api/RoomTypes/${type.id}`, undefined, 409);
assert.equal((await api('GET', `/api/Bookings?status=Reserved&customerId=${customer.id}`)).totalCount, 1);
await api('POST', `/api/Bookings/${booking.id}/check-in`);
await api('POST', `/api/Bookings/${booking.id}/check-in`, undefined, 409);
const service = await api('POST', '/api/Services', { name: `Minibar ${stamp}`, unit: 'Lần', price: 75000 }, 201);
const usage = await api('POST', '/api/Services/usage', { requestId: randomUUID(), bookingId: booking.id, serviceId: service.id, quantity: 2 }, 201);
assert.equal(usage.total, 150000);
assert.equal((await api('GET', `/api/Services/usage/booking/${booking.id}`)).length, 1);
await api('DELETE', '/api/Services/'+service.id, undefined, 204);
assert.equal((await api('GET', '/api/Services/'+service.id)).isActive, false);
await api('POST', '/api/Services/usage', { requestId: randomUUID(), bookingId: booking.id, serviceId: service.id, quantity: 1 }, 400);
await api('POST', '/api/Services/'+service.id+'/activate', undefined, 403, updatedClerkLogin.token);
await api('POST', '/api/Services/'+service.id+'/activate', undefined, 401, '');
await api('POST', '/api/Services/2147483647/activate', undefined, 404);
const activated = await api('POST', '/api/Services/'+service.id+'/activate');
assert.equal(activated.id, service.id);
assert.equal(activated.isActive, true);
assert.equal(activated.price, service.price);
assert.equal((await api('POST', '/api/Services/'+service.id+'/activate')).isActive, true);
assert.equal((await api('GET', '/api/Services/usage/booking/'+booking.id)).length, 1);
const reactivatedUsage = await api('POST', '/api/Services/usage', { requestId: randomUUID(), bookingId: booking.id, serviceId: service.id, quantity: 1 }, 201);
assert.equal(reactivatedUsage.total, service.price);
await api('DELETE', '/api/Services/usage/'+reactivatedUsage.id, undefined, 204);
const beforeCheckout = await api('GET', '/api/Reports/popular-services?from='+today+'&to='+today);
assert.equal(beforeCheckout.some(x => x.serviceId === service.id), false);
const checkedOut = await api('POST', '/api/Bookings/'+booking.id+'/check-out');
assert.equal(checkedOut.status, 'CheckedOut');
assert.equal(checkedOut.totalAmount, 650000);
await api('POST', '/api/Services/usage', { requestId: randomUUID(), bookingId: booking.id, serviceId: service.id, quantity: 1 }, 409);
await api('DELETE', `/api/Services/usage/${usage.id}`, undefined, 409);
await api('POST', `/api/Bookings/${booking.id}/check-out`, undefined, 409);
const revenue = await api('GET', `/api/Reports/revenue?from=${today}&to=${today}`);
assert.equal(revenue.totalRevenue >= 650000, true);
const popular = await api('GET', '/api/Reports/popular-services?from='+today+'&to='+today);
assert.equal(popular.find(x => x.serviceId === service.id).revenue, 150000);
assert.equal(popular.reduce((sum,x) => sum+x.revenue,0), revenue.serviceRevenue);
await api('GET', '/api/Reports/rooms');
await api('POST', '/api/Housekeeping/'+room.id+'/complete', undefined, 200, updatedClerkLogin.token);
const publicRooms = await api('GET', `/api/Bookings/available-rooms?checkInDate=${today}&checkOutDate=${end}`, undefined, 200, '');
assert.equal(publicRooms.some(x => x.id === room.id), true);
const publicBooking = await api('POST', '/api/Bookings/public', {
  fullName: 'Khách website', phone: '0902223344', roomId: room.id, guestCount: 2,
  checkInDate: today, checkOutDate: end
}, 201, guest.token);
assert.equal(publicBooking.totalAmount, 500000);
assert.equal((await api('GET', '/api/Bookings/'+publicBooking.id)).guestCount, 2);
await api('POST', '/api/Bookings/public', {
  fullName: 'Khách trùng phòng', phone: '0902223344', roomId: room.id,
  checkInDate: today, checkOutDate: end
}, 409, guest.token);
await api('POST', `/api/Bookings/${publicBooking.id}/cancel`);
await api('DELETE', `/api/Services/${service.id}`, undefined, 204);
await api('DELETE', `/api/Users/${clerk.id}`, undefined, 204);
await api('DELETE', `/api/Users/${registered.id}`, undefined, 204);
await api('GET', '/api/Auth/me', undefined, 401, clerkLogin.token);
await api('GET', '/api/Auth/me', undefined, 401, updatedClerkLogin.token);

for (const path of ['/api/NoSuchRoute', '/api/Rooms/NoSuchAction', '/API/NoSuchRoute', '/api/missing.json', '/api']) {
  const missing = await fetch(base + path);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /json/);
  assert.equal(typeof (await missing.json()).message, 'string');
  checks++;
}
await api('POST', '/api/NoSuchRoute', {}, 404, '');
await api('GET', '/api/Reports/popular-services?from='+end+'&to='+today, undefined, 400);
const fallback = await fetch(base + '/dashboard');
assert.equal(fallback.status, 200);
assert.match(await fallback.text(), /Quản lý khách sạn/);
const root = await fetch(base);
assert.equal(root.status, 200);
assert.match(await root.text(), /Quản lý khách sạn/);
const publicPage = await fetch(base + '/hotel.html');
assert.equal(publicPage.status, 200);
assert.match(await publicPage.text(), /An Nhiên/);
console.log(`PASS: ${checks} API checks, admin and guest frontends HTTP 200`);

const searchForm = document.getElementById('search-form');
const roomResults = document.getElementById('room-results');
const dialog = document.getElementById('reservation-dialog');
const toast = document.getElementById('site-toast');
let availableRooms = [];
let roomSearchRevision = 0;
let guestOptionsRequest = null;
let guestOptionsInitialized = false;
let maximumGuests = 100;

function localDate(offset = 0) {
  return window.hotelTime.day(offset);
}
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function money(value) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND',
    maximumFractionDigits: 2 }).format(Number(value) || 0);
}
function showToast(message, bad = false) {
  toast.textContent = message;
  toast.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.className = '', 4800);
}
async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      method: options.method || 'GET',
      signal: options.signal,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(customerSession.token ? { Authorization: 'Bearer ' + customerSession.token } : {}) },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
  } catch (error) {
    throw new Error(error.name === 'TimeoutError' ? 'Tìm phòng quá thời gian chờ. Vui lòng thử lại.' :
      'Không kết nối được máy chủ. Hãy thử lại sau.');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) setCustomerSession(null);
    const error = new Error(hotelApiError(response, data));
    error.status = response.status;
    throw error;
  }
  return data;
}
function currentDates() {
  const form = searchForm.elements;
  return { checkInDate: form.namedItem('checkInDate').value,
    checkOutDate: form.namedItem('checkOutDate').value,
    guestCount: Number(form.namedItem('guests').value) };
}
function validDates(start, end) {
  if (!start || !end || end <= start) throw new Error('Ngày trả phòng phải sau ngày nhận phòng.');
  if (start < localDate()) throw new Error('Ngày nhận phòng không thể ở trong quá khứ.');
}
function validGuestCount(count, maximum) {
  if (!Number.isInteger(count) || count < 1 || count > maximum)
    throw new Error('Vui lòng chọn từ 1 đến '+maximum+' khách trong một phòng.');
}
async function loadGuestOptions() {
  if (guestOptionsRequest) return guestOptionsRequest;
  guestOptionsRequest = (async () => {
    const data = await request('/api/Bookings/guest-options', { signal: AbortSignal.timeout(15000) });
    if (!Number.isInteger(data?.maxGuests) || data.maxGuests < 1 || data.maxGuests > 100)
      throw new Error('Chưa tải được số khách tối đa. Vui lòng thử lại.');
    const select = searchForm.elements.namedItem('guests');
    const selected = guestOptionsInitialized ? Number(select.value) : Math.min(2, data.maxGuests);
    maximumGuests = data.maxGuests;
    if (!guestOptionsInitialized || select.dataset.maximum !== String(maximumGuests)) {
      const options = Array.from({length:maximumGuests}, (_,index) => new Option((index+1)+' khách, 1 phòng',String(index+1)));
      // Never silently change a group of 20 guests into a smaller booking after a catalog edit.
      if (selected > maximumGuests) options.push(new Option(selected+' khách (vượt sức chứa hiện tại)',String(selected)));
      select.replaceChildren(...options);
      select.value = String(selected);
      select.dataset.maximum = String(maximumGuests);
    }
    select.disabled = false;
    guestOptionsInitialized = true;
  })();
  try { await guestOptionsRequest; } finally { guestOptionsRequest = null; }
}
function renderRooms(rooms) {
  if (!rooms.length) {
    roomResults.innerHTML = '<div class="empty-room">Không có phòng khả dụng trong khoảng ngày này. Hãy thử ngày khác.</div>';
    return;
  }
  roomResults.innerHTML = '<div class="room-grid">' + rooms.map(room =>
    '<article class="room-card"><img src="'+escapeHtml(room.coverUrl||('/images/room-illustrations/room-'+(room.id%3+1)+'-1.svg'))+'" alt="Phòng '+escapeHtml(room.roomNumber)+'" loading="lazy"><div class="room-card-body"><span class="category">'+escapeHtml(room.roomTypeName)+'</span><h3><button type="button" data-room-detail="'+room.id+'">Phòng '+escapeHtml(room.roomNumber)+'</button></h3><p>Tối đa '+room.capacity+' khách</p><p>'+escapeHtml(room.description || 'Không gian nghỉ dưỡng tiện nghi và riêng tư.')+'</p><div class="room-card-footer"><div><strong>'+money(room.price)+'</strong><small>Mỗi đêm</small></div><div class="room-card-actions"><button type="button" class="room-detail-link" data-room-detail="'+room.id+'">Xem chi tiết</button><button type="button" data-room="'+room.id+'">Đặt phòng</button></div></div></div></article>'
  ).join('') + '</div>';
}
async function loadRooms(scroll = false) {
  const revision = ++roomSearchRevision;
  const submit = searchForm.querySelector('[type="submit"]');
  availableRooms = [];
  document.getElementById('date-summary').textContent = '';
  roomResults.setAttribute('aria-busy', 'true');
  submit.disabled = true;
  roomResults.textContent = 'Đang tìm phòng...';
  try {
    await loadGuestOptions();
    if (revision !== roomSearchRevision) return;
    const { checkInDate, checkOutDate, guestCount } = currentDates();
    validDates(checkInDate, checkOutDate);
    validGuestCount(guestCount, maximumGuests);
    const query = new URLSearchParams({ checkInDate, checkOutDate, guestCount });
    const rooms = await request('/api/Bookings/available-rooms?' + query, { signal: AbortSignal.timeout(20000) });
    if (revision !== roomSearchRevision) return;
    if (!Array.isArray(rooms)) throw new Error('Không tải được danh sách phòng. Vui lòng thử lại.');
    availableRooms = rooms;
    document.getElementById('date-summary').textContent =
      new Date(checkInDate + 'T12:00:00').toLocaleDateString('vi-VN') + ' → ' +
      new Date(checkOutDate + 'T12:00:00').toLocaleDateString('vi-VN');
    renderRooms(availableRooms);
  } catch (error) {
    if (revision !== roomSearchRevision) return;
    roomResults.innerHTML = '<div class="empty-room room-search-error"><h3>Chưa tải được phòng</h3><p>'+escapeHtml(error.message)+'</p><button type="button" data-room-retry>Thử lại</button></div>';
    showToast(error.message, true);
  } finally {
    if (revision === roomSearchRevision) {
      roomResults.setAttribute('aria-busy', 'false');
      submit.disabled = false;
      if (scroll) document.getElementById('rooms').scrollIntoView({ behavior: 'smooth' });
    }
  }
}
async function openReservation(room, selection = currentDates(), note = '') {
  await customerSessionReady;
  const { checkInDate, checkOutDate, guestCount } = selection;
  validDates(checkInDate, checkOutDate);
  validGuestCount(guestCount, 100);
  if (guestCount > room.capacity) { showToast("Phòng không đủ chỗ cho số khách đã chọn.", true); return; }
  if (!customerSession.token || !customerSession.account) {
    showCustomerAuth('login', () => openReservation(room, selection, note));
    return;
  }
  const nights = Math.round((new Date(checkOutDate + 'T12:00:00') -
    new Date(checkInDate + 'T12:00:00')) / 86400000);
  dialog.innerHTML = '<form class="booking-form" id="booking-form"><header><h2>Đặt phòng '+escapeHtml(room.roomNumber)+'</h2><p>'+escapeHtml(room.roomTypeName)+' · '+nights+' đêm · '+guestCount+' khách</p></header><div class="booking-body"><label>Họ và tên<input name="fullName" maxlength="100" required autocomplete="name"></label><label>Số điện thoại<input name="phone" type="tel" maxlength="30" required autocomplete="tel"></label><label>Email (không bắt buộc)<input name="email" type="email" maxlength="200" autocomplete="email"></label><label>Ghi chú<textarea name="note" maxlength="500"></textarea></label><div class="booking-total"><span>Tiền phòng dự kiến</span><strong>'+money(room.price * nights)+'</strong></div><div id="booking-error"></div></div><div class="booking-actions"><button type="button" id="booking-cancel">Đóng</button><button type="submit">Gửi đặt phòng</button></div></form>';
  if (customerSession.account) {
    const form = document.getElementById('booking-form');
    for (const key of ['fullName','phone','email']) {
      const input = form.elements.namedItem(key);
      input.value = customerSession.account[key] || '';
      input.readOnly = true;
    }
  }
  dialog.querySelector('[name="note"]').value = note;
  if (!dialog.open) dialog.showModal();
  document.getElementById('booking-cancel').onclick = () => dialog.close();
  document.getElementById('booking-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      const booking = await request('/api/Bookings/public', { method: 'POST',
        body: { ...values, email: values.email.trim() || null, roomId: room.id, checkInDate, checkOutDate, guestCount } });
      dialog.close();
      showToast('Đã nhận đặt phòng #' + booking.id + '. Đang mở trang thanh toán...');
      location.assign('/payment.html?bookingId=' + booking.id);
    } catch (error) {
      if (error.status === 401) {
        dialog.close();
        showToast('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục đặt phòng.', true);
        showCustomerAuth('login', () => openReservation(room, selection, values.note));
        return;
      }
      document.getElementById('booking-error').innerHTML = '<div class="form-error">'+escapeHtml(error.message)+'</div>';
    } finally { submit.disabled = false; }
  };
}
searchForm.onsubmit = async event => {
  event.preventDefault();
  await loadRooms(true);
};
searchForm.elements.namedItem('guests').onchange = () => loadRooms();
roomResults.onclick = event => {
  if (event.target.closest('[data-room-retry]')) { loadRooms(); return; }
  const detail = event.target.closest('[data-room-detail]');
  if (detail) { openRoomDetails(Number(detail.dataset.roomDetail)); return; }
  const button = event.target.closest('[data-room]');
  if (!button) return;
  const room = availableRooms.find(x => x.id === Number(button.dataset.room));
  if (room) openReservation(room).catch(error => showToast(error.message, true));
};
window.hotelTimeReady.then(() => {
  searchForm.elements.namedItem('checkInDate').value = localDate();
  searchForm.elements.namedItem('checkOutDate').value = localDate(1);
  loadRooms();
});

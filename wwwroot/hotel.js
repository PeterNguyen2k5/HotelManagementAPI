const searchForm = document.getElementById('search-form');
const roomResults = document.getElementById('room-results');
const recommendedResults = document.getElementById('recommended-results');
const popularResults = document.getElementById('popular-results');
const dialog = document.getElementById('reservation-dialog');
const toast = document.getElementById('site-toast');
const siteMenuToggle = document.getElementById('site-menu-toggle');
const siteNav = document.getElementById('site-nav');
let availableRooms = [];
let roomSearchSelection = null;
let roomSearchRevision = 0;
let guestOptionsRequest = null;
let guestOptionsInitialized = false;
let maximumGuests = 100;

function closeSiteMenu() {
  siteMenuToggle.setAttribute('aria-expanded', 'false');
}
siteMenuToggle.addEventListener('click', () => {
  siteMenuToggle.setAttribute('aria-expanded', String(siteMenuToggle.getAttribute('aria-expanded') === 'false'));
});
document.addEventListener('click', event => {
  if (!siteMenuToggle.contains(event.target) && (!siteNav.contains(event.target) || event.target.closest('a')))
    closeSiteMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && siteMenuToggle.getAttribute('aria-expanded') === 'true') {
    closeSiteMenu();
    siteMenuToggle.focus();
  }
});
window.matchMedia('(max-width: 680px)').addEventListener('change', closeSiteMenu);

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
function sameRoomSelection(first, second) {
  return first !== null && second !== null &&
    first.checkInDate === second.checkInDate && first.checkOutDate === second.checkOutDate &&
    first.guestCount === second.guestCount;
}
function requireAvailableRoom(roomId, selection) {
  if (!sameRoomSelection(selection, currentDates()) || !sameRoomSelection(selection, roomSearchSelection))
    throw new Error('Ngày lưu trú hoặc số khách đã thay đổi. Vui lòng tìm phòng lại.');
  if (!availableRooms.some(room => room.id === roomId))
    throw new Error('Phòng này không có trong kết quả tìm kiếm hiện tại. Vui lòng chọn phòng khác.');
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
const ROOMS_PER_PAGE = 6;
let currentRoomsPage = 1;

function renderRoomGrid(rooms, stayCounts) {
  return '<div class="room-grid">' + rooms.map(room => {
    const cover = room.coverUrl || '/images/room-illustrations/room-' + (room.id % 3 + 1) + '-1.svg';
    const name = 'Phòng ' + escapeHtml(room.roomNumber);
    const description = escapeHtml(room.description || 'Không gian nghỉ dưỡng tiện nghi và riêng tư.');
    const completedStays = stayCounts?.get(room.id);
    const stayLabel = completedStays
      ? '<p class="room-stay-count">' + completedStays.toLocaleString('vi-VN') + ' lượt lưu trú đã hoàn tất</p>'
      : '';
    return '<article class="room-card"><img src="' + escapeHtml(cover) + '" alt="' + name + '" loading="lazy">' +
      '<div class="room-card-body"><span class="category">' + escapeHtml(room.roomTypeName) + '</span>' +
      '<h3><button type="button" data-room-detail="' + room.id + '">' + name + '</button></h3>' +
      stayLabel + '<p>Tối đa ' + room.capacity + ' khách</p><p>' + description + '</p>' +
      '<div class="room-card-footer"><div><strong>' + money(room.price) + '</strong><small>Mỗi đêm</small></div>' +
      '<div class="room-card-actions"><button type="button" class="room-detail-link" data-room-detail="' +
      room.id + '">Xem chi tiết</button><button type="button" data-room="' + room.id +
      '">Đặt phòng</button></div></div></div></article>';
  }).join('') + '</div>';
}

function showCollectionMessage(container, message) {
  const notice = document.createElement('div');
  notice.className = 'empty-room';
  notice.textContent = message;
  container.replaceChildren(notice);
}

function renderRecommendedRooms(rooms) {
  const byPrice = [...rooms].sort((a, b) => a.price - b.price);
  const firstByType = new Map();
  for (const room of byPrice) {
    if (!firstByType.has(room.roomTypeId)) firstByType.set(room.roomTypeId, room);
  }
  const recommended = [...new Set([...firstByType.values(), ...byPrice])].slice(0, 3);
  recommendedResults.innerHTML = renderRoomGrid(recommended);
}

async function loadPopularRooms(rooms, revision) {
  try {
    const data = await request('/api/Bookings/room-popularity', { signal: AbortSignal.timeout(15000) });
    if (revision !== roomSearchRevision) return;
    const counts = new Map(data.map(entry => [entry.roomId, entry.completedStays]));
    const popular = rooms.filter(room => counts.has(room.id))
      .sort((a, b) => counts.get(b.id) - counts.get(a.id)).slice(0, 3);
    if (popular.length) {
      popularResults.innerHTML = renderRoomGrid(popular, counts);
    } else {
      showCollectionMessage(popularResults, 'Các phòng còn trống chưa có lượt lưu trú hoàn tất để xếp hạng.');
    }
  } catch {
    if (revision === roomSearchRevision) {
      showCollectionMessage(popularResults, 'Chưa tải được xếp hạng. Bạn vẫn có thể xem phòng đề xuất.');
    }
  }
}

function renderRooms(rooms, page = 1) {
  if (!rooms.length) {
    roomResults.innerHTML = '<div class="empty-room">Không có phòng khả dụng trong khoảng ngày này. Hãy thử ngày khác.</div>';
    return;
  }
  const totalPages = Math.ceil(rooms.length / ROOMS_PER_PAGE);
  currentRoomsPage = Math.max(1, Math.min(page, totalPages));
  const startIndex = (currentRoomsPage - 1) * ROOMS_PER_PAGE;
  const pagedRooms = rooms.slice(startIndex, startIndex + ROOMS_PER_PAGE);

  let paginationHtml = '';
  if (totalPages > 1) {
    const startNum = startIndex + 1;
    const endNum = Math.min(startIndex + ROOMS_PER_PAGE, rooms.length);
    paginationHtml = '<div class="room-pagination">' +
      '<span class="pagination-info">Hiển thị ' + startNum + '–' + endNum + ' trên ' + rooms.length + ' phòng · Trang ' + currentRoomsPage + ' / ' + totalPages + '</span>' +
      '<div class="pagination-buttons">' +
      '<button type="button" class="btn-page" data-room-page="' + (currentRoomsPage - 1) + '"' + (currentRoomsPage <= 1 ? ' disabled' : '') + '>← Trang trước</button>' +
      '<div class="page-numbers">' +
      Array.from({ length: totalPages }, (_, i) => i + 1).map(p =>
        '<button type="button" class="btn-page-num' + (p === currentRoomsPage ? ' active' : '') + '" data-room-page="' + p + '">' + p + '</button>'
      ).join('') +
      '</div>' +
      '<button type="button" class="btn-page" data-room-page="' + (currentRoomsPage + 1) + '"' + (currentRoomsPage >= totalPages ? ' disabled' : '') + '>Trang sau →</button>' +
      '</div></div>';
  }

  roomResults.innerHTML = renderRoomGrid(pagedRooms) + paginationHtml;
}
async function loadRooms(scroll = false) {
  const revision = ++roomSearchRevision;
  const submit = searchForm.querySelector('[type="submit"]');
  availableRooms = [];
  roomSearchSelection = null;
  document.getElementById('date-summary').textContent = '';
  roomResults.setAttribute('aria-busy', 'true');
  submit.disabled = true;
  roomResults.textContent = 'Đang tìm phòng...';
  recommendedResults.textContent = 'Đang tìm phòng đề xuất…';
  popularResults.textContent = 'Đang tải xếp hạng…';
  try {
    await loadGuestOptions();
    if (revision !== roomSearchRevision) return;
    const selection = currentDates();
    const { checkInDate, checkOutDate, guestCount } = selection;
    validDates(checkInDate, checkOutDate);
    validGuestCount(guestCount, maximumGuests);
    const query = new URLSearchParams(selection);
    const rooms = await request('/api/Bookings/available-rooms?' + query, { signal: AbortSignal.timeout(20000) });
    if (revision !== roomSearchRevision) return;
    if (!sameRoomSelection(selection, currentDates())) {
      void loadRooms(scroll);
      return;
    }
    if (!Array.isArray(rooms)) throw new Error('Không tải được danh sách phòng. Vui lòng thử lại.');
    availableRooms = rooms;
    roomSearchSelection = selection;
    currentRoomsPage = 1;
    document.getElementById('date-summary').textContent =
      new Date(checkInDate + 'T12:00:00').toLocaleDateString('vi-VN') + ' → ' +
      new Date(checkOutDate + 'T12:00:00').toLocaleDateString('vi-VN');
    renderRooms(availableRooms, 1);
    if (rooms.length) {
      renderRecommendedRooms(rooms);
      void loadPopularRooms(rooms, revision);
    } else {
      showCollectionMessage(recommendedResults, 'Hãy thử đổi ngày hoặc số khách để xem thêm gợi ý.');
      showCollectionMessage(popularResults, 'Chưa có phòng còn trống phù hợp để hiển thị xếp hạng.');
    }
  } catch (error) {
    if (revision !== roomSearchRevision) return;
    roomResults.innerHTML = '<div class="empty-room room-search-error"><h3>Chưa tải được phòng</h3><p>'+escapeHtml(error.message)+'</p><button type="button" data-room-retry>Thử lại</button></div>';
    showCollectionMessage(recommendedResults, 'Hãy thử tìm phòng lại để xem đề xuất.');
    showCollectionMessage(popularResults, 'Hãy thử tìm phòng lại để xem xếp hạng.');
    showToast(error.message, true);
  } finally {
    if (revision === roomSearchRevision) {
      roomResults.setAttribute('aria-busy', 'false');
      submit.disabled = false;
      if (scroll) document.getElementById('rooms').scrollIntoView({ behavior: 'smooth' });
    }
  }
}
async function openReservation(room, selection, note = '') {
  await customerSessionReady;
  requireAvailableRoom(room.id, selection);
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
  dialog.querySelector('.booking-total').insertAdjacentHTML('afterend',
    '<p class="booking-policy-note"><a href="/booking-policy.html" target="_blank" rel="noopener">Xem chính sách đổi, hủy và hoàn cọc (mở tab mới)</a></p>');
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
      requireAvailableRoom(room.id, selection);
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
searchForm.addEventListener('change', event => {
  if (event.target.matches('input[type="date"], select[name="guests"]')) void loadRooms();
});
function handleRoomClick(event) {
  const button = event.target.closest('[data-room], [data-room-detail]');
  if (!button) return;
  const selection = roomSearchSelection;
  if (!sameRoomSelection(selection, currentDates())) {
    void loadRooms();
    return;
  }
  if (button.dataset.roomDetail) {
    void openRoomDetails(Number(button.dataset.roomDetail), selection);
    return;
  }
  const room = availableRooms.find(x => x.id === Number(button.dataset.room));
  if (room) openReservation(room, selection).catch(error => showToast(error.message, true));
}
recommendedResults.onclick = handleRoomClick;
popularResults.onclick = handleRoomClick;
roomResults.onclick = event => {
  if (event.target.closest('[data-room-retry]')) { loadRooms(); return; }
  const pageBtn = event.target.closest('[data-room-page]');
  if (pageBtn && !pageBtn.disabled) {
    const targetPage = Number(pageBtn.dataset.roomPage);
    if (Number.isInteger(targetPage) && targetPage >= 1) {
      currentRoomsPage = targetPage;
      renderRooms(availableRooms, currentRoomsPage);
      document.getElementById('rooms')?.scrollIntoView({ behavior: 'smooth' });
    }
    return;
  }
  handleRoomClick(event);
};
window.hotelTimeReady.then(() => {
  searchForm.elements.namedItem('checkInDate').value = localDate();
  searchForm.elements.namedItem('checkOutDate').value = localDate(1);
  loadRooms();
});

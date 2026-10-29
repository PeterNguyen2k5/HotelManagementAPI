const portalMain = document.getElementById('portal-main');
const portalState = { version: 0, bookingsPage: 1, requestsPage: 1, filters: {}, detail: null };
const portalStatuses = { Reserved: 'Chờ nhận phòng', CheckedIn: 'Đang lưu trú', CheckedOut: 'Đã trả phòng', Cancelled: 'Đã hủy', Pending: 'Chờ xử lý', Approved: 'Đã chấp thuận', Rejected: 'Đã từ chối' };
const portalBookingBadge = b => b.holdExpiredAtUtc ? '<span class="portal-badge Cancelled">Hết hạn giữ chỗ</span>' : b.awaitingPayment ? '<span class="portal-badge Reserved">Chờ thanh toán</span>' : portalBadge(b.status);
const portalPaymentTypes = { Deposit: 'Đặt cọc', Payment: 'Thanh toán', Refund: 'Hoàn tiền', Direct: 'Chọn trả tại quầy' };
const pe = customerEscape;
const portalMoney = value => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 2 }).format(Number(value) || 0);
const portalDate = value => value ? window.hotelTime.format(value) : 'Chưa có';
const portalBadge = status => '<span class="portal-badge '+(Object.hasOwn(portalStatuses,status)?status:'')+'">'+pe(portalStatuses[status]||status)+'</span>';
const portalRequest = path => customerRequest(path, { signal: AbortSignal.timeout(20000) });
function showToast(message, bad = false) {
  const toast = document.getElementById('site-toast');
  toast.textContent = message; toast.className = 'show'+(bad?' bad':'');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.className = '', 4800);
}
function portalRoute() {
  const route = location.hash.slice(1);
  const detail = /^booking-([1-9][0-9]{0,9})$/.exec(route);
  if (detail && Number(detail[1]) <= 2147483647) return { view: 'detail', id: Number(detail[1]) };
  // Old overview links now open the customer's booking list.
  return { view: ['bookings','requests','profile'].includes(route) ? route : 'bookings' };
}
function navigatePortal(view) {
  accountDialog.close();
  if (location.hash === '#'+view) loadPortal(); else location.hash = view;
}
function portalSessionHeader() {
  const account = customerSession.account;
  document.getElementById('portal-sidebar').hidden = !account;
  document.getElementById('portal-user').textContent = account?.fullName || '';
  const avatar = document.querySelector('.portal-avatar'); avatar.hidden = !account;
  avatar.textContent = (account?.fullName || '').trim().split(/\s+/).slice(-2).map(x => x[0] || '').join('').toUpperCase();
}
function portalHeading(title, description, actions = '') {
  return '<div class="portal-heading"><div><h1 tabindex="-1">'+pe(title)+'</h1><p>'+pe(description)+'</p></div>'+actions+'</div>';
}
function portalEmpty(title, description, actions = '') {
  return '<div class="portal-empty"><h2>'+pe(title)+'</h2><p>'+pe(description)+'</p>'+(actions?'<div class="portal-actions">'+actions+'</div>':'')+'</div>';
}
function portalGate() {
  portalState.version++; portalState.detail = null; guestBookingCache.clear();
  portalSessionHeader(); portalMain.setAttribute('aria-busy','false');
  portalMain.innerHTML = '<section class="portal-empty portal-gate"><a class="portal-brand" href="/hotel.html"><span>A</span><div>An Nhiên<small>HOTEL &amp; RESORT</small></div></a><p class="portal-eyebrow">KHÔNG GIAN RIÊNG CỦA BẠN</p><h1>Quản lý kỳ nghỉ của bạn</h1><p>Đăng nhập bằng tài khoản khách để xem booking, thanh toán, theo dõi yêu cầu và cập nhật thông tin cá nhân.</p><div class="portal-actions"><button type="button" class="portal-button primary" data-portal-action="login">Đăng nhập khách hàng</button><button type="button" class="portal-button" data-portal-action="register">Tạo tài khoản</button></div></section>';
}
function portalBookingActions(item) {
  const b = item.booking;
  if (b.serverTimeUtc) window.bookingHold.sync(b.serverTimeUtc);
  if (b.awaitingPayment && window.bookingHold.remaining(b) <= 0) return '<a class="portal-button" href="#booking-'+b.id+'">Kiểm tra giữ chỗ</a>';
  let html = '<a class="portal-button" href="#booking-'+b.id+'">Xem chi tiết</a>';
  if (b.status !== 'Cancelled' && b.balance > 0) html += '<a class="portal-button primary" href="/payment.html?bookingId='+b.id+'">Thanh toán / QR</a>';
  if (b.status === 'Reserved' && !item.hasPendingRequest) html += '<button class="portal-button" type="button" data-portal-action="change" data-booking-id="'+b.id+'">Yêu cầu đổi</button><button class="portal-button danger" type="button" data-portal-action="cancel" data-booking-id="'+b.id+'">Yêu cầu hủy</button>';
  if (b.status === 'CheckedOut') html += '<a class="portal-button" href="/invoice.html?bookingId='+b.id+'&customer=1">Hóa đơn / PDF</a>';
  if (b.status === 'CheckedOut' || b.status === 'Cancelled') html += '<a class="portal-button'+(b.balance>0?'':' primary')+'" href="/hotel.html#rooms">Đặt phòng mới</a>';
  return html;
}
function portalBookingCard(item) {
  const b = item.booking; guestBookingCache.set(b.id,b);
  const due = Math.max(0,Number(b.balance)||0), refund = Math.max(0,-Number(b.balance)||0);
  const note = item.hasPendingRequest ? 'Yêu cầu của bạn đang chờ khách sạn phản hồi.' : b.status==='CheckedOut' ? 'Cảm ơn bạn đã chọn An Nhiên cho kỳ nghỉ vừa qua.' : b.status==='Cancelled' ? 'Hẹn gặp bạn trong một kỳ nghỉ khác.' : b.status==='CheckedIn' ? 'Chúc bạn có những ngày thật an yên tại An Nhiên.' : 'Chúng tôi mong được đón tiếp bạn.';
  return '<article class="portal-booking" data-portal-booking="'+b.id+'">'+
    '<div class="portal-order-header"><div><span class="portal-hotel-tag">An Nhiên</span><span class="portal-order-number">Mã đặt phòng #'+b.id+'</span><a href="/hotel.html#contact" class="portal-contact-link">Liên hệ khách sạn <span aria-hidden="true">↗</span></a></div>'+portalBookingBadge(b)+'</div>'+
    '<a class="portal-room-row" href="#booking-'+b.id+'" aria-label="Chi tiết đặt phòng #'+b.id+'"><img class="portal-booking-image" src="'+pe(item.coverUrl)+'" alt="Phòng '+pe(b.roomNumber)+'" loading="lazy"><div class="portal-room-info"><h2>'+pe(item.roomTypeName)+' · Phòng '+pe(b.roomNumber)+'</h2><p>'+portalDate(b.checkInDate)+' <span aria-hidden="true">→</span> '+portalDate(b.checkOutDate)+'</p><span>'+pe(b.nights)+' đêm <span aria-hidden="true">·</span> '+pe(b.guestCount??'Chưa ghi nhận')+' khách</span></div><span class="portal-room-price">'+portalMoney(b.roomTotal)+'<small>Tiền phòng</small></span></a>'+
    window.bookingHold.markup(b)+'<div class="portal-order-total"><span>'+(b.status==='Cancelled'?'Giá trị sau hủy':b.status==='CheckedOut'?'Tổng thanh toán':'Tổng tiền dự kiến')+':</span><strong>'+portalMoney(b.totalAmount)+'</strong></div>'+
    '<div class="portal-payment-note">Đã thanh toán '+portalMoney(b.paidAmount)+' <span aria-hidden="true">·</span> '+(refund?'Cần hoàn '+portalMoney(refund):'Còn phải trả '+portalMoney(due))+'</div>'+
    '<div class="portal-order-footer"><p>'+pe(note)+(item.hasPendingRequest?' <a href="#requests">Xem yêu cầu →</a>':'')+'</p><div class="portal-actions">'+portalBookingActions(item)+'</div></div></article>';
}
function portalPager(data, view) {
  if (!data.totalCount) return '';
  return '<div class="portal-pagination"><span>'+data.totalCount+' '+(view==='bookings'?'booking':'yêu cầu')+' · Trang '+data.pageNumber+' / '+data.totalPages+'</span><div class="portal-actions">'+(data.pageNumber>1?'<button type="button" class="portal-button" data-portal-page="'+(data.pageNumber-1)+'" data-page-view="'+view+'">Trang trước</button>':'')+(data.pageNumber<data.totalPages?'<button type="button" class="portal-button" data-portal-page="'+(data.pageNumber+1)+'" data-page-view="'+view+'">Trang sau</button>':'')+'</div></div>';
}
function portalStatusTabs() {
  return '<nav class="portal-status-tabs" aria-label="Trạng thái đặt phòng">'+[['','Tất cả'],['Reserved','Chờ nhận phòng'],['CheckedIn','Đang lưu trú'],['CheckedOut','Đã trả phòng'],['Cancelled','Đã hủy']].map(([status,label])=>'<button type="button" data-portal-status="'+status+'" aria-pressed="'+((portalState.filters.status||'')===status)+'">'+label+'</button>').join('')+'</nav>';
}
function portalFilters() {
  const f = portalState.filters;
  return '<form class="portal-filters" id="portal-booking-filter"><div class="portal-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><label class="portal-sr-only" for="portal-keyword">Tìm theo mã đặt phòng hoặc số phòng</label><input id="portal-keyword" name="keyword" maxlength="100" placeholder="Tìm theo mã đặt phòng hoặc số phòng của bạn" value="'+pe(f.keyword||'')+'"><button type="submit">Tìm kiếm</button></div><input type="hidden" name="status" value="'+pe(f.status||'')+'"><details class="portal-date-filter"'+(f.fromDate||f.toDate?' open':'')+'><summary>Lọc theo ngày lưu trú</summary><div><label>Từ ngày<input type="date" name="fromDate" value="'+pe(f.fromDate||'')+'"></label><label>Đến ngày<input type="date" name="toDate" value="'+pe(f.toDate||'')+'"></label><button type="submit" class="portal-button">Áp dụng</button><button type="button" class="portal-text-button" data-portal-action="clear-filter">Xóa bộ lọc</button></div></details><span id="portal-filter-error" class="customer-error" role="alert"></span></form>';
}
function portalRequestCard(r) {
  return '<article class="portal-request"><div class="portal-booking-top"><strong>Yêu cầu #'+r.id+' · '+(r.type==='Change'?'Đổi booking':'Hủy booking')+' #'+r.bookingId+'</strong>'+portalBadge(r.status)+'</div><p>'+pe(r.reason)+'</p>'+(r.type==='Change'?'<p>Ngày mong muốn: '+portalDate(r.checkInDate)+' → '+portalDate(r.checkOutDate)+'</p>':'')+'<p class="portal-muted">Gửi ngày '+portalDate(r.createdAt)+'</p><p class="response"><strong>Phản hồi từ khách sạn:</strong> '+pe(r.staffNote||(r.status==='Pending'?'Yêu cầu của bạn đang chờ lễ tân kiểm tra.':'Khách sạn chưa có ghi chú thêm.'))+'</p><a class="portal-button" href="#booking-'+r.bookingId+'">Xem booking</a></article>';
}
function portalInfo(label, value, wide = false) {
  return '<div'+(wide?' class="wide"':'')+'><dt>'+label+'</dt><dd>'+pe(value||'Chưa cập nhật')+'</dd></div>';
}
function portalProfile() {
  const p = customerSession.account;
  return '<section class="portal-profile">'+portalHeading('Hồ sơ của tôi','Quản lý thông tin cá nhân để khách sạn phục vụ bạn tốt hơn.')+'<section class="portal-panel"><h2>Thông tin cá nhân</h2><dl class="portal-info">'+portalInfo('Họ và tên',p.fullName)+portalInfo('Tên đăng nhập',p.username)+portalInfo('Email',p.email)+portalInfo('Số điện thoại',p.phone)+portalInfo('CCCD / Hộ chiếu',p.identityCard)+portalInfo('Địa chỉ',p.address,true)+'</dl><div class="portal-actions"><button type="button" class="portal-button primary" data-portal-action="profile-edit">Sửa hồ sơ</button></div></section><section class="portal-panel"><h2>Mật khẩu</h2><p class="portal-muted">Để bảo vệ tài khoản, các phiên đăng nhập sẽ kết thúc sau khi đổi mật khẩu.</p><div class="portal-actions"><button type="button" class="portal-button" data-portal-action="password">Đổi mật khẩu</button></div></section></section>';
}
function portalTable(headers, rows, empty) {
  return rows.length?'<div class="portal-table-wrap"><table class="portal-table"><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table></div>':'<p class="portal-muted">'+empty+'</p>';
}
function portalDetail(d) {
  const b = d.booking; guestBookingCache.set(b.id,b); portalState.detail = d;
  const item = {booking:b,hasPendingRequest:!d.canRequestChangeOrCancel};
  const payments = d.payments.map(p=>'<tr><td>'+portalDate(p.createdAt)+'</td><td>'+pe(portalPaymentTypes[p.type]||p.type)+'</td><td>'+pe(p.method==='Transfer'?'Chuyển khoản':'Tiền mặt')+'</td><td>'+portalMoney(p.amount)+'</td><td>'+pe(p.reference||'—')+'</td></tr>');
  const services = d.services.map(s=>'<tr><td>'+pe(s.name)+'</td><td>'+pe(s.quantity)+'</td><td>'+portalMoney(s.unitPrice)+'</td><td>'+portalMoney(s.total)+'</td></tr>');
  const actions = portalBookingActions(item).replace('<a class="portal-button" href="#booking-'+b.id+'">Xem chi tiết</a>','');
  return portalHeading('Booking #'+b.id,'Theo dõi thông tin lưu trú và các giao dịch của bạn.','<a class="portal-button" href="#bookings">← Booking của tôi</a>')+'<div class="portal-grid"><div><section class="portal-panel"><img class="portal-detail-cover" src="'+pe(d.coverUrl)+'" alt="Phòng '+pe(b.roomNumber)+'"><div class="portal-booking-top"><h2>Phòng '+pe(b.roomNumber)+'</h2>'+portalBookingBadge(b)+'</div><dl class="portal-info">'+portalInfo('Hạng phòng',d.roomTypeName)+portalInfo('Số khách',b.guestCount==null?'Chưa ghi nhận':b.guestCount+' khách')+portalInfo('Ngày nhận phòng',portalDate(b.checkInDate))+portalInfo('Ngày trả phòng',portalDate(b.checkOutDate))+portalInfo('Nhận phòng thực tế',portalDate(b.actualCheckInAt))+portalInfo('Trả phòng thực tế',portalDate(b.actualCheckOutAt))+portalInfo('Họ tên liên hệ',d.contact.fullName)+portalInfo('Điện thoại',d.contact.phone)+portalInfo('Email',d.contact.email,true)+portalInfo('Ghi chú booking',b.note||'Không có ghi chú',true)+'</dl>'+window.bookingHold.markup(b)+(actions?'<div class="portal-actions">'+actions+'</div>':'')+(d.requests.some(r=>r.status==='Pending')?'<p class="portal-alert">Yêu cầu đổi/hủy đang chờ lễ tân xử lý. Bạn có thể theo dõi ở mục Yêu cầu đổi / hủy.</p>':'')+'</section><section class="portal-panel"><h2>Dịch vụ đã sử dụng</h2>'+portalTable(['Dịch vụ','Số lượng','Đơn giá','Thành tiền'],services,'Booking chưa ghi nhận dịch vụ.')+'</section><section class="portal-panel"><h2>Lịch sử thanh toán</h2>'+portalTable(['Ngày','Giao dịch','Phương thức','Số tiền','Tham chiếu / ghi chú'],payments,'Chưa có giao dịch. Chọn trả tại quầy không có nghĩa đã thanh toán.')+'</section>'+(d.requests.length?'<section class="portal-panel"><h2>Yêu cầu trên booking</h2>'+d.requests.map(r=>portalRequestCard({...r,bookingId:b.id})).join('')+'</section>':'')+'</div><aside class="portal-panel"><h2>Chi phí kỳ nghỉ</h2><div class="portal-amount-line"><span>'+(b.status==='Cancelled'?'Tiền phòng trước khi hủy':'Tiền phòng · '+pe(b.nights)+' đêm')+'</span><strong>'+portalMoney(b.roomTotal)+'</strong></div><div class="portal-amount-line"><span>Dịch vụ</span><strong>'+portalMoney(b.serviceTotal)+'</strong></div><div class="portal-amount-line total"><span>'+(b.status==='Cancelled'?'Giá trị sau hủy':b.status==='CheckedOut'?'Tổng tiền':'Tổng tiền dự kiến')+'</span><strong>'+portalMoney(d.balance.total)+'</strong></div><div class="portal-amount-line"><span>Đã thanh toán (sau hoàn tiền)</span><strong>'+portalMoney(d.balance.paid)+'</strong></div><div class="portal-amount-line total"><span>Còn cần thanh toán</span><strong>'+portalMoney(d.balance.due)+'</strong></div>'+(d.balance.refundDue>0?'<div class="portal-amount-line"><span>Khoản cần hoàn</span><strong>'+portalMoney(d.balance.refundDue)+'</strong></div>':'')+'<p class="portal-muted">Khoản hoàn tiền được lễ tân xử lý và xác nhận riêng. Chi phí booking chưa trả phòng có thể thay đổi theo thời gian lưu trú và dịch vụ thực tế.</p></aside></div>';
}
async function loadPortal() {
  await window.hotelTimeReady;
  if (!customerSession.token || !customerSession.account) { portalGate(); return; }
  const version = ++portalState.version, token = customerSession.token, route = portalRoute();
  portalSessionHeader();
  document.querySelectorAll('[data-portal-view]').forEach(a=>{if(a.dataset.portalView===(route.view==='detail'?'bookings':route.view))a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  portalMain.setAttribute('aria-busy','true'); portalMain.innerHTML = '<div class="portal-loading" role="status">Đang tải thông tin của bạn…</div>';
  try {
    let html;
    if (route.view==='profile') html=portalProfile();
    else if (route.view==='detail') { const detail=await portalRequest('/api/CustomerPortal/bookings/'+route.id); if(version!==portalState.version||token!==customerSession.token)return; html=portalDetail(detail); }
    else {
      const query=new URLSearchParams({pageSize:'6',pageNumber:String(route.view==='requests'?portalState.requestsPage:portalState.bookingsPage),...(route.view==='bookings'?portalState.filters:{})});
      const data=await portalRequest(route.view==='requests'?'/api/BookingRequests/mine?'+query:'/api/CustomerPortal/bookings?'+query);
      if(version!==portalState.version||token!==customerSession.token)return;
      if(route.view==='bookings') {
        html='<h1 class="portal-sr-only" tabindex="-1">Đặt phòng của tôi</h1>'+portalStatusTabs()+portalFilters()+(data.items.length?'<div class="portal-bookings">'+data.items.map(portalBookingCard).join('')+'</div>':portalEmpty('Chưa có đặt phòng nào ở đây','Các kỳ nghỉ của bạn sẽ xuất hiện tại đây. Hãy thử bỏ bộ lọc hoặc khám phá một căn phòng phù hợp.','<a class="portal-button primary" href="/hotel.html#rooms">Khám phá phòng</a>'))+portalPager(data,'bookings');
      } else html=portalHeading('Yêu cầu đổi / hủy','Theo dõi phản hồi của khách sạn về các yêu cầu bạn đã gửi.')+(data.items.length?data.items.map(portalRequestCard).join(''):portalEmpty('Bạn chưa có yêu cầu nào','Bạn có thể yêu cầu đổi hoặc hủy khi đặt phòng đang chờ nhận phòng.','<a class="portal-button" href="#bookings">Xem đặt phòng của tôi</a>'))+portalPager(data,'requests');
    }
    if(version!==portalState.version||token!==customerSession.token)return;
    portalMain.innerHTML=html; window.bookingHold.tick();
    portalMain.querySelector('h1')?.focus({preventScroll:true});
  } catch(error) {
    if(version!==portalState.version||token!==customerSession.token)return;
    portalMain.innerHTML=portalEmpty('Chưa tải được thông tin',error.message,'<button type="button" class="portal-button primary" data-portal-action="retry">Thử lại</button><a class="portal-button" href="#bookings">Booking của tôi</a>');
  } finally { if(version===portalState.version)portalMain.setAttribute('aria-busy','false'); }
}
document.addEventListener('click',async event=>{
  const statusTab=event.target.closest('[data-portal-status]');
  if(statusTab){const status=statusTab.dataset.portalStatus;if(!['','Reserved','CheckedIn','CheckedOut','Cancelled'].includes(status))return;portalState.filters={...portalState.filters,status};portalState.bookingsPage=1;loadPortal();return;}
  const pager=event.target.closest('[data-portal-page]');
  if(pager){const page=Number(pager.dataset.portalPage);if(!Number.isInteger(page)||page<1)return;if(pager.dataset.pageView==='requests')portalState.requestsPage=page;else portalState.bookingsPage=page;loadPortal();return;}
  const button=event.target.closest('[data-portal-action]');if(!button)return;
  try {
    const action=button.dataset.portalAction;
    if(action==='login'||action==='register'){showCustomerAuth(action);return;}
    if(action==='logout'){setCustomerSession(null);location.assign('/hotel.html');return;}
    if(action==='retry'){loadPortal();return;}
    if(action==='clear-filter'){portalState.filters={};portalState.bookingsPage=1;loadPortal();return;}
    if(action==='profile-edit'){await showCustomerProfile();return;}
    if(action==='password'){showCustomerPasswordChange();return;}
    if(action==='change'||action==='cancel'){
      const id=Number(button.dataset.bookingId),booking=guestBookingCache.get(id);
      if(!booking||booking.status!=='Reserved')throw new Error('Hãy tải lại booking trước khi gửi yêu cầu.');
      showGuestRequestForm(id,action==='change'?'Change':'Cancel');if(!accountDialog.open)accountDialog.showModal();
    }
  } catch(error){showToast(error.message,true);}
});
document.addEventListener('submit',event=>{
  if(event.target.id!=='portal-booking-filter')return;
  event.preventDefault();const values=Object.fromEntries(new FormData(event.target));
  if(values.fromDate&&values.toDate&&values.toDate<values.fromDate){document.getElementById('portal-filter-error').textContent='Ngày kết thúc phải từ ngày bắt đầu trở đi.';return;}
  portalState.filters=Object.fromEntries(Object.entries(values).filter(([,value])=>value!==''));portalState.bookingsPage=1;loadPortal();
});
window.addEventListener('hashchange',loadPortal);
window.addEventListener('customer-session-changed',()=>{portalState.bookingsPage=1;portalState.requestsPage=1;portalState.filters={};portalState.detail=null;guestBookingCache.clear();if(!customerSession.token){accountDialog.close();accountDialog.replaceChildren();portalGate();}else loadPortal();});
window.addEventListener('customer-profile-changed',()=>{portalSessionHeader();loadPortal();});
window.addEventListener('customer-portal-navigate',event=>navigatePortal(event.detail?.view||'bookings'));
portalMain.addEventListener('error',event=>{if(event.target.tagName==='IMG'&&!event.target.dataset.fallback){event.target.dataset.fallback='1';event.target.src='/images/room-illustrations/room-1-1.svg'}},true);
(async()=>{await customerSessionReady;if(!customerSession.token||!customerSession.account)portalGate();else loadPortal();})();

let holdRefreshPending = false;
window.addEventListener("booking-hold-expired", () => { if (holdRefreshPending) return; holdRefreshPending = true; setTimeout(async () => { try { await loadPortal(); } finally { holdRefreshPending = false; } }, 250); });

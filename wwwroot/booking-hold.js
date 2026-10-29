(() => {
  let serverTime = Date.now(), syncedAt = performance.now(), lastSync = -Infinity;
  const seen = new WeakSet();
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function sync(value) {
    const time = Date.parse(value);
    if (Number.isFinite(time) && time > lastSync) { lastSync = time; serverTime = time; syncedAt = performance.now(); }
  }
  function now() { return serverTime + performance.now() - syncedAt; }
  function remaining(booking) { return Date.parse(booking.paymentDueAtUtc) - now(); }
  function markup(booking) {
    if (booking.serverTimeUtc) sync(booking.serverTimeUtc);
    if (booking.holdExpiredAtUtc) return '<p class="booking-hold expired" role="status">Đã hết hạn thanh toán. Giữ chỗ đã tự hủy; vui lòng đặt phòng mới.</p>';
    if (!booking.awaitingPayment || !booking.paymentDueAtUtc) return '';
    return '<p class="booking-hold" data-hold-due="'+escape(booking.paymentDueAtUtc)+'" data-hold-booking="'+Number(booking.id)+'">Giữ chỗ trong 30 phút · Còn <strong data-hold-clock>…</strong> để thanh toán cọc. Hết hạn mà chưa nhận tiền, booking tự hủy.</p>';
  }
  function tick() {
    for (const element of document.querySelectorAll('[data-hold-due]')) {
      const seconds = Math.max(0, Math.ceil((Date.parse(element.dataset.holdDue) - now()) / 1000));
      const clock = element.querySelector('[data-hold-clock]');
      if (clock) clock.textContent = String(Math.floor(seconds / 60)).padStart(2,'0') + ':' + String(seconds % 60).padStart(2,'0');
      element.classList.toggle('expired', seconds <= 0);
      if (seconds <= 0 && !seen.has(element)) {
        seen.add(element);
        window.dispatchEvent(new CustomEvent('booking-hold-expired', { detail: { bookingId: Number(element.dataset.holdBooking) } }));
      }
    }
  }
  window.bookingHold = { sync, remaining, markup, tick };
  setInterval(tick, 1000);
})();

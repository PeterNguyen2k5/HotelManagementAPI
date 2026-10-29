const params = new URLSearchParams(location.search);
const bookingId = Number(params.get('bookingId'));

const loadingState = document.getElementById('loading-state');
const payContent = document.getElementById('pay-content');
const successDialog = document.getElementById('success-dialog');

let booking = null;
let bankConfig = null;
let currentMethod = 'Payment'; // 'Payment' | 'Deposit' | 'Direct'
let depositPercent = 30; // 30 | 50 | 'custom'
let customDepositAmount = null;
let pollTimer = null;
let isPaymentCompleted = false;
let qrLoader = null;
let qrLoadTimer = null;
const paymentEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function money(v) {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 2 }).format(Number(v) || 0);
}

function formatDate(v) {
  return window.hotelTime.format(v);
}

function copyToClipboard(text, btn) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✓ Đã chép';
      btn.style.background = '#278455';
      btn.style.color = '#fff';
      setTimeout(() => {
        btn.textContent = orig;
        btn.style.background = '';
        btn.style.color = '';
      }, 1800);
    }).catch(() => fallbackCopy(text, btn));
  } else {
    fallbackCopy(text, btn);
  }
}

function fallbackCopy(text, btn) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
  const orig = btn.textContent;
  btn.textContent = '✓ Đã chép';
  setTimeout(() => { btn.textContent = orig; }, 1800);
}

async function fetchJSON(url, options = {}) {
  const token = sessionStorage.getItem('hotel.token') || sessionStorage.getItem('hotel.customer.token');
  let response;
  try { response = await fetch(url, {method:options.method||'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:options.body?JSON.stringify(options.body):undefined}); }
  catch { throw new Error('Không kết nối được máy chủ. Vui lòng thử lại.'); }
  const data = await response.json().catch(()=>null);
  if (!response.ok) {
    if (response.status===401) {
      for (const key of ['hotel.token','hotel.customer.token']) if(sessionStorage.getItem(key)===token)sessionStorage.removeItem(key);
      throw new Error('Vui lòng đăng nhập lại ở trang khách sạn để xem hoặc thanh toán booking của bạn.');
    }
    throw new Error(hotelApiError(response,data));
  }
  return data;
}

function getDueAmount() {
  if (!booking) return 0;
  return Math.max(0, Number(booking.balance?.due ?? booking.totalAmount) || 0);
}

function getDepositAmount(requested) {
  const due = getDueAmount();
  const amount = Number.isFinite(Number(requested)) ? Math.round(Number(requested) * 100) / 100 : 0;
  return Math.min(due, Math.max(50000, amount));
}

function updateDepositOptions(normalizeInput = false) {
  const due = getDueAmount();
  document.getElementById('dep-30-val').textContent = money(getDepositAmount(Math.round(due * 0.3)));
  document.getElementById('dep-50-val').textContent = money(getDepositAmount(Math.round(due * 0.5)));
  const input = document.getElementById('custom-deposit-input');
  input.min = Math.min(50000, due);
  input.max = due;
  input.disabled = due <= 0;
  document.getElementById('deposit-limit-note').textContent =
    'Số tiền cọc từ ' + money(Math.min(50000, due)) + ' đến ' + money(due) + ', không vượt số còn phải trả.';
  if (normalizeInput) {
    customDepositAmount = getDepositAmount(customDepositAmount ?? Math.round(due * 0.3));
    input.value = customDepositAmount;
  }
}

function getCurrentPayAmount() {
  const due = getDueAmount();
  if (currentMethod === 'Direct') return 0;
  if (currentMethod === 'Payment') return due;
  if (currentMethod === 'Deposit') {
    if (depositPercent === 30) return getDepositAmount(Math.round(due * 0.3));
    if (depositPercent === 50) return getDepositAmount(Math.round(due * 0.5));
    if (depositPercent === 'custom') {
      return getDepositAmount(customDepositAmount ?? Math.round(due * 0.3));
    }
  }
  return due;
}

function isBankConfigured() {
  return bankConfig?.bankConfigured === true &&
    ['bankId', 'bankName', 'accountNumber', 'accountName'].every(key =>
      typeof bankConfig[key] === 'string' && bankConfig[key].trim().length > 0);
}

function canTransfer() {
  return isBankConfigured() && getDueAmount() > 0 && booking?.status !== 'Cancelled' && !(booking?.awaitingPayment && window.bookingHold.remaining(booking) <= 0);
}

function updateTransferAvailability() {
  const available = canTransfer();
  for (const id of ['card-deposit', 'card-online']) {
    const card = document.getElementById(id);
    card.classList.toggle('is-disabled', !available);
    card.setAttribute('aria-disabled', String(!available));
    card.querySelector('input').disabled = !available;
  }
  const notice = document.getElementById('bank-unavailable');
  notice.hidden = isBankConfigured() || getDueAmount() <= 0;
  notice.textContent = bankConfig?.loadFailed
    ? 'Chưa tải được thông tin ngân hàng. Chuyển khoản tạm thời không khả dụng. Quý khách có thể thanh toán tại khách sạn hoặc tải lại trang để thử lại.'
    : 'Khách sạn chưa cấu hình tài khoản ngân hàng nhận thanh toán. Chuyển khoản tạm thời không khả dụng. Quý khách vui lòng chọn thanh toán tại khách sạn.';
  document.getElementById('btn-confirm-transfer').disabled = !available;
  document.getElementById('btn-simulate-sepay').hidden = !available || !bankConfig?.canSimulate;
  const direct = document.getElementById('card-direct');
  const settled = getDueAmount() <= 0 || booking?.status === 'Cancelled' || booking?.awaitingPayment && window.bookingHold.remaining(booking) <= 0;
  direct.querySelector('input').disabled = settled;
  direct.classList.toggle('is-disabled', settled);
  direct.setAttribute('aria-disabled', String(settled));
  document.getElementById('btn-confirm-direct').disabled = settled;
  if (!available) currentMethod = 'Direct';
}

function updateQRAndBankInfo() {
  clearTimeout(qrLoadTimer);
  if (qrLoader) { qrLoader.onload = null; qrLoader.onerror = null; qrLoader = null; }
  const qrImg = document.getElementById('qr-image');
  const logo = document.getElementById('qr-overlay-logo');
  const status = document.getElementById('qr-status');
  const retry = document.getElementById('btn-retry-qr');
  qrImg.hidden = true;
  qrImg.removeAttribute('src');
  logo.hidden = true;
  status.hidden = true;
  retry.hidden = true;
  if (!booking || !canTransfer() || currentMethod === 'Direct') return;

  const bank = bankConfig;
  const payAmount = getCurrentPayAmount();
  const transferContent = 'ANNHIEN ' + booking.id;
  const rawAmount = String(payAmount);
  document.getElementById('bank-name').textContent = bank.bankName;
  document.getElementById('bank-account-num').textContent = bank.accountNumber;
  document.getElementById('bank-account-name').textContent = bank.accountName;
  document.getElementById('bank-transfer-amount').textContent = money(payAmount);
  document.getElementById('bank-transfer-content').textContent = transferContent;
  document.getElementById('qr-pay-amount').textContent = money(payAmount);
  document.querySelector('[data-copy="bank-transfer-amount-raw"]').dataset.copyVal = rawAmount;

  const query = new URLSearchParams({ amount: rawAmount, addInfo: transferContent, accountName: bank.accountName });
  const url = bank.qrImageUrl || `https://img.vietqr.io/image/${encodeURIComponent(bank.bankId)}-${encodeURIComponent(bank.accountNumber)}-compact2.png?${query}`;
  status.hidden = false;
  document.getElementById('qr-status-message').textContent = 'Đang tải mã QR…';
  const loader = new Image();
  qrLoader = loader;
  const failed = () => {
    if (qrLoader !== loader) return;
    clearTimeout(qrLoadTimer);
    loader.onload = null; loader.onerror = null; qrLoader = null;
    document.getElementById('qr-status-message').textContent = 'Không tải được mã QR. Vui lòng thử lại hoặc chuyển khoản thủ công theo thông tin ngân hàng bên dưới.';
    retry.hidden = false;
  };
  loader.onload = () => {
    if (qrLoader !== loader) return;
    clearTimeout(qrLoadTimer);
    qrImg.src = loader.src;
    qrImg.hidden = false;
    logo.hidden = false;
    status.hidden = true;
    loader.onload = null; loader.onerror = null; qrLoader = null;
  };
  loader.onerror = failed;
  qrLoadTimer = setTimeout(failed, 15000);
  loader.src = url;
}

function updateMethodUI() {
  updateTransferAvailability();
  const cardDeposit = document.getElementById('card-deposit');
  const cardOnline = document.getElementById('card-online');
  const cardDirect = document.getElementById('card-direct');
  const depositOptions = document.getElementById('deposit-options');
  const qrSection = document.getElementById('qr-section');
  const directSection = document.getElementById('direct-section');

  [cardDeposit, cardOnline, cardDirect].forEach(c => {
    c.classList.remove('active');
    c.querySelector('input').checked = false;
  });

  const expired = booking?.status === 'Cancelled' || booking?.awaitingPayment && window.bookingHold.remaining(booking) <= 0;
  const settled = getDueAmount() <= 0 || expired;
  const settledSection = document.getElementById('settled-section');
  settledSection.hidden = !settled;
  settledSection.querySelector('h2').textContent = expired ? 'Booking đã hủy hoặc hết thời gian giữ chỗ' : 'Booking không còn khoản phải thu';
  settledSection.querySelector('p').textContent = expired ? 'Vui lòng đặt phòng mới. Nếu đã chuyển khoản, hãy liên hệ lễ tân để đối soát.' : 'Quý khách không cần đặt cọc hoặc thanh toán thêm cho booking này.';
  if (settled) {
    depositOptions.style.display = 'none';
    qrSection.style.display = 'none';
    directSection.style.display = 'none';
    stopSepayPolling();
  } else if (currentMethod === 'Deposit') {
    cardDeposit.classList.add('active');
    cardDeposit.querySelector('input').checked = true;
    depositOptions.style.display = 'block';
    qrSection.style.display = 'block';
    directSection.style.display = 'none';
    document.getElementById('qr-instruction').textContent = 'Quét mã QR dưới đây để hoàn tất chuyển khoản đặt cọc:';
    startSepayPolling();
  } else if (currentMethod === 'Payment') {
    cardOnline.classList.add('active');
    cardOnline.querySelector('input').checked = true;
    depositOptions.style.display = 'none';
    qrSection.style.display = 'block';
    directSection.style.display = 'none';
    document.getElementById('qr-instruction').textContent = 'Quét mã QR dưới đây để thanh toán toàn bộ 100% tiền phòng:';
    startSepayPolling();
  } else if (currentMethod === 'Direct') {
    cardDirect.classList.add('active');
    cardDirect.querySelector('input').checked = true;
    depositOptions.style.display = 'none';
    qrSection.style.display = 'none';
    directSection.style.display = 'block';
    document.getElementById('direct-pay-amount').textContent = money(getDueAmount());
    stopSepayPolling();
  }

  updateQRAndBankInfo();
}

/* ========================================================
   SEPAY AUTO-DETECTION & POLLING LOGIC
   ======================================================== */
function startSepayPolling() {
  if (!canTransfer() || isPaymentCompleted || pollTimer) return;
  pollTimer = setInterval(checkSepayPaymentStatus, 2500);
}

function stopSepayPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function checkSepayPaymentStatus(interactive = false) {
  if (isPaymentCompleted) return;
  try {
    const status = await fetchJSON('/api/BookingOperations/' + booking.id + '/payment-status');
    if (isPaymentCompleted) return false;
    const previousPaid = Number(booking.balance?.paid) || 0;
    Object.assign(booking, { status:status.status, paymentDueAtUtc:status.paymentDueAtUtc, holdExpiredAtUtc:status.holdExpiredAtUtc, awaitingPayment:status.awaitingPayment, serverTimeUtc:status.serverTimeUtc });
    window.bookingHold.sync(status.serverTimeUtc);
    renderPaymentHold();
    const newlyReceived = status.paid > previousPaid;
    if (status.remaining !== getDueAmount() || status.paid !== previousPaid || status.gross !== booking.totalAmount) {
      booking.balance = { total: status.gross, paid: status.paid, due: status.remaining,
        refundDue: Math.max(0, status.paid - status.gross) };
      booking.totalAmount = status.gross;
      renderBookingData();
    }
    if (status.status === 'Cancelled') { stopSepayPolling(); updateMethodUI(); return false; }
    // An earlier deposit is already part of the balance; only announce a new receipt.
    if (newlyReceived && status.latestPayment) {
      isPaymentCompleted = true;
      stopSepayPolling();

      const label = document.getElementById('sepay-status-label');
      if (label) {
        label.textContent = '✓ Đã ghi nhận khoản thanh toán mới.';
        label.style.color = '#278455';
      }

      showSuccessBoard({
        payment: status.latestPayment,
        booking: booking
      });
      return true;
    }
  } catch (err) {
    console.warn('SePay status check:', err.message);
  }
  return false;
}

function renderBookingData() {
  renderPaymentHold();
  document.getElementById('summary-booking-id').textContent = 'Booking #' + booking.id;
  document.getElementById('summary-guest-name').textContent = booking.customerName || 'Quý khách';
  document.getElementById('summary-guest-phone').textContent = booking.customerPhone || '—';
  document.getElementById('summary-room-name').textContent = 'Phòng ' + booking.roomNumber + ' (' + booking.roomTypeName + ')';
  document.getElementById('summary-dates').textContent = formatDate(booking.checkInDate) + ' → ' + formatDate(booking.checkOutDate);
  document.getElementById('summary-stay-info').textContent = booking.nights + ' đêm · ' + (booking.guestCount || 1) + ' khách';

  document.getElementById('summary-price-night').textContent = money(booking.roomPricePerNight);
  document.getElementById('summary-total-amount').textContent = money(booking.totalAmount);

  const paid = booking.balance?.paid || 0;
  const due = getDueAmount();

  document.getElementById('paid-row').style.display = paid > 0 ? 'flex' : 'none';
  if (paid > 0) {
    document.getElementById('summary-paid-amount').textContent = money(paid);
  }
  document.getElementById('summary-balance-amount').textContent = money(due);

  updateDepositOptions(depositPercent === 'custom');
  updateMethodUI();
}

function showSuccessBoard(data) {
  isPaymentCompleted = true;
  stopSepayPolling();

  const p = data.payment || {};
  const b = data.booking || booking;

  document.getElementById('suc-booking-id').textContent = '#' + b.id;
  document.getElementById('suc-guest-name').textContent = b.customerName || booking.customerName;
  document.getElementById('suc-room-name').textContent = 'Phòng ' + (b.roomNumber || booking.roomNumber) + ' (' + (b.roomTypeName || booking.roomTypeName) + ')';
  document.getElementById('suc-dates').textContent = formatDate(b.checkInDate || booking.checkInDate) + ' → ' + formatDate(b.checkOutDate || booking.checkOutDate);

  const typeLabels = {
    Deposit: 'Đặt cọc',
    Payment: 'Thanh toán',
    Refund: 'Hoàn tiền',
    Direct: 'Chọn thanh toán tại khách sạn'
  };
  document.getElementById('suc-payment-type').textContent = typeLabels[p.type] || 'Chưa xác định';
  document.getElementById('suc-payment-method').textContent =
    ({Transfer:'Chuyển khoản ngân hàng',Cash:'Tiền mặt tại quầy'})[p.method] || 'Chưa xác định';
  document.getElementById('suc-title').textContent = p.type === 'Direct'
    ? 'Đã ghi nhận lựa chọn thanh toán' : 'Đã ghi nhận khoản thanh toán';

  if (p.type === 'Direct') {
    document.getElementById('suc-paid-now').textContent = '0 ₫ (Chờ thanh toán)';
    if (booking.awaitingPayment) document.getElementById('suc-title').textContent = 'Chưa thanh toán · hạn giữ chỗ vẫn là 30 phút';
    document.getElementById('suc-remaining-due').textContent = money(getDueAmount());
  } else {
    document.getElementById('suc-paid-now').textContent = money(p.amount);
    const rem = data.balance?.due ?? b.balance?.due ?? getDueAmount();
    document.getElementById('suc-remaining-due').textContent = money(rem);
  }

  const refEl = document.getElementById('suc-ref-code');
  if (p.reference) {
    refEl.textContent = p.reference;
    document.getElementById('suc-ref-row').style.display = 'flex';
  } else {
    document.getElementById('suc-ref-row').style.display = 'none';
  }

  successDialog.showModal();
}

/* ========================================================
   EVENT LISTENERS
   ======================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  await window.hotelTimeReady;
  if (!bookingId || isNaN(bookingId)) {
    loadingState.innerHTML = '<div class="error-text" style="font-size:16px;">Không tìm thấy mã đặt phòng hợp lệ. Vui lòng kiểm tra lại đường dẫn.</div><br><a href="/hotel.html" class="btn-suc primary" style="display:inline-block;">Quay về trang chủ</a>';
    return;
  }

  try {
    const [bData, cfgData] = await Promise.all([
      fetchJSON('/api/BookingOperations/' + bookingId + '/public-info'),
      fetchJSON('/api/BookingOperations/bank-config').catch(() => ({ bankConfigured: false, loadFailed: true }))
    ]);
    booking = bData;
    bankConfig = cfgData;

    loadingState.style.display = 'none';
    payContent.style.display = 'grid';

    renderBookingData();
    if (getDueAmount() > 0) checkSepayPaymentStatus();
  } catch (err) {
    loadingState.innerHTML = '<div class="error-text" style="font-size:16px;">' + paymentEscape(err.message || 'Không thể tải thông tin đặt phòng.') + '</div><br><a href="/hotel.html" class="btn-suc secondary" style="display:inline-block;">Quay về trang chủ</a>';
  }
});

// Chuyển phương thức thanh toán
document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
  radio.addEventListener('change', event => {
    currentMethod = event.target.value;
    updateMethodUI();
  });
});

document.querySelectorAll('.method-card').forEach(card => {
  card.addEventListener('click', event => {
    if (card.querySelector('input').disabled) { event.preventDefault(); return; }
    if (event.target.tagName === 'BUTTON' || event.target.tagName === 'INPUT') return;
    const radio = card.querySelector('input[type="radio"]');
    if (radio && !radio.checked) {
      radio.checked = true;
      currentMethod = radio.value;
      updateMethodUI();
    }
  });
});

// Chọn % đặt cọc
document.querySelectorAll('.btn-deposit').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-deposit').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const pct = btn.dataset.percent;
    const customBox = document.getElementById('custom-deposit-box');

    if (pct === 'custom') {
      depositPercent = 'custom';
      customBox.style.display = 'block';
      updateDepositOptions(true);
    } else {
      depositPercent = Number(pct);
      customBox.style.display = 'none';
    }
    updateQRAndBankInfo();
  });
});

// Nhập cọc tùy chỉnh
document.getElementById('custom-deposit-input')?.addEventListener('input', e => {
  customDepositAmount = Number(e.target.value) || 0;
  updateQRAndBankInfo();
});
document.getElementById('custom-deposit-input')?.addEventListener('change', () => {
  updateDepositOptions(true);
  updateQRAndBankInfo();
});

// Nút sao chép
document.addEventListener('click', e => {
  const copyBtn = e.target.closest('[data-copy]');
  if (!copyBtn || !canTransfer()) return;
  const targetId = copyBtn.dataset.copy;
  if (targetId === 'bank-transfer-amount-raw') {
    copyToClipboard(copyBtn.dataset.copyVal || String(getCurrentPayAmount()), copyBtn);
    return;
  }
  const el = document.getElementById(targetId);
  if (el) {
    copyToClipboard(el.textContent.trim(), copyBtn);
  }
});

// Xác nhận chuyển khoản (Online / Đặt cọc)
// Read the booking ledger; a new receipt may come from the bank webhook or staff.
document.getElementById('btn-confirm-transfer')?.addEventListener('click', async () => {
  if (!canTransfer()) return;
  const submitBtn = document.getElementById('btn-confirm-transfer');
  const spinner = document.getElementById('btn-spinner');
  const btnText = document.getElementById('btn-transfer-text');
  const errorBox = document.getElementById('transfer-error');

  errorBox.textContent = '';
  submitBtn.disabled = true;
  spinner.style.display = 'inline-block';
  btnText.textContent = 'Đang kiểm tra trạng thái thanh toán...';

  try {
    // 1. Kiểm tra trạng thái SePay trước
    const hasPaid = await checkSepayPaymentStatus(true);
    if (hasPaid) {
      // Đã nhận được tiền -> showSuccessBoard đã được gọi trong checkSepayPaymentStatus
      return;
    }

    // 2. Nếu chưa nhận được tiền:
    errorBox.innerHTML = `⚠️ <strong>Chưa ghi nhận khoản chuyển khoản mới cho booking này.</strong><br>
    Vui lòng đảm bảo bạn đã hoàn tất chuyển khoản đúng số tài khoản và nội dung <strong>ANNHIEN ${booking.id}</strong>.<br>
    Nếu vừa chuyển xong, vui lòng đợi 5-15 giây để ngân hàng gửi thông báo, hệ thống sẽ tự động cập nhật ngay!<br>
    ${bankConfig?.canSimulate ? '<em>Admin có thể mô phỏng khi chạy local trong Development.</em>' : ''}`;
  } catch (err) {
    errorBox.textContent = err.message || 'Kiểm tra thất bại. Vui lòng thử lại.';
  } finally {
    submitBtn.disabled = !canTransfer();
    spinner.style.display = 'none';
    btnText.textContent = '✓ Kiểm tra & Xác nhận đã chuyển khoản';
  }
});

// Nút mô phỏng SePay nhận tiền ngay (Dành cho thử nghiệm / Demo)
document.getElementById('btn-simulate-sepay')?.addEventListener('click', async () => {
  if (!canTransfer()) return;
  const simBtn = document.getElementById('btn-simulate-sepay');
  const errorBox = document.getElementById('transfer-error');
  errorBox.textContent = '';
  simBtn.disabled = true;
  simBtn.textContent = '⏳ Đang giả lập tín hiệu ngân hàng SePay...';

  try {
    const payAmount = getCurrentPayAmount();
    const result = await fetchJSON('/api/BookingOperations/' + booking.id + '/simulate-sepay-payment', {
      method: 'POST',
      body: {
        amount: payAmount,
        type: currentMethod
      }
    });

    showSuccessBoard(result);
  } catch (err) {
    errorBox.textContent = err.message || 'Mô phỏng thất bại.';
  } finally {
    simBtn.disabled = false;
    simBtn.textContent = '⚡ Mô phỏng SePay nhận tiền ngay (Dành cho thử nghiệm)';
  }
});

document.getElementById('btn-retry-qr')?.addEventListener('click', updateQRAndBankInfo);

// Xác nhận thanh toán trực tiếp tại khách sạn
document.getElementById('btn-confirm-direct')?.addEventListener('click', async () => {
  if (!booking || getDueAmount() <= 0 || booking.status === 'Cancelled' || booking.awaitingPayment && window.bookingHold.remaining(booking) <= 0) return;
  const submitBtn = document.getElementById('btn-confirm-direct');
  const errorBox = document.getElementById('direct-error');
  errorBox.textContent = '';
  submitBtn.disabled = true;

  try {
    const note = document.getElementById('direct-note-input').value.trim() || 'Khách chọn thanh toán trực tiếp khi nhận phòng';
    const requestId = crypto.randomUUID();

    const result = await fetchJSON('/api/BookingOperations/' + booking.id + '/customer-payment', {
      method: 'POST',
      body: {
        type: 'Direct',
        method: 'Cash',
        amount: 0,
        requestId: requestId,
        reference: note
      }
    });

    showSuccessBoard(result);
  } catch (err) {
    errorBox.textContent = err.message || 'Không thể xác nhận đặt phòng. Vui lòng thử lại.';
  } finally {
    submitBtn.disabled = getDueAmount() <= 0 || booking?.status === 'Cancelled' || booking?.awaitingPayment && window.bookingHold.remaining(booking) <= 0;
  }
});

// Nút in phiếu xác nhận
document.getElementById('btn-print-confirmation')?.addEventListener('click', () => {
  window.print();
});

// Nút về trang chủ
document.getElementById('btn-back-home')?.addEventListener('click', () => {
  location.assign('/hotel.html');
});

function renderPaymentHold() {
  const element = document.getElementById('payment-hold-notice');
  if (element) {
    const markup = window.bookingHold.markup(booking);
    if (element.innerHTML !== markup) element.innerHTML = markup;
  }
}
window.addEventListener('booking-hold-expired', () => {
  if (!booking?.awaitingPayment) return;
  updateMethodUI();
  if (isPaymentCompleted) isPaymentCompleted = false;
  checkSepayPaymentStatus();
});

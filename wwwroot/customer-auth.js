const customerSession = { token: sessionStorage.getItem('hotel.customer.token'), account: null };
const accountDialog = document.getElementById('customer-dialog');
const accountActions = document.getElementById('customer-actions');
const customerEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setCustomerSession(session) {
  customerSession.token = session?.token || null;
  customerSession.account = session?.account || null;
  if (session) sessionStorage.setItem('hotel.customer.token', session.token);
  else sessionStorage.removeItem('hotel.customer.token');
  renderCustomerActions();
  window.dispatchEvent(new Event('customer-session-changed'));
}
function renderCustomerActions() {
  accountActions.innerHTML = customerSession.account
    ? '<span class="customer-name">'+customerEscape(customerSession.account.fullName)+'</span><button type="button" data-customer="profile">Hồ sơ</button><a href="/customer.html?v=20261028-account-1#bookings" data-customer-portal-link>Đặt phòng của tôi</a><button type="button" data-customer="logout">Đăng xuất</button>'
    : '<button type="button" data-customer="login">Đăng nhập</button><button type="button" data-customer="register">Đăng ký</button>';
}
async function customerRequest(path, options = {}) {
  const requestToken = options.auth === false ? null : customerSession.token;
  let response;
  try { response = await fetch(path, {
    method: options.method || 'GET',
      signal: options.signal,
    headers: { ...(options.body ? {'Content-Type':'application/json'} : {}),
      ...(requestToken ? {Authorization:'Bearer '+requestToken} : {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  }); } catch { throw new Error('Không kết nối được máy chủ. Vui lòng kiểm tra kết nối và thử lại.'); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && requestToken && customerSession.token === requestToken) setCustomerSession(null);
    const error = new Error(hotelApiError(response, data));
    error.status = response.status;
    throw error;
  }
  return data;
}
function showCustomerAuth(mode = 'login', onAuthenticated = null) {
  const register = mode === 'register';
  accountDialog.innerHTML = '<form id="customer-form" class="booking-form"><header><h2>'+ (register?'Đăng ký tài khoản khách':'Đăng nhập khách hàng') +'</h2><p>Lưu đặt phòng và theo dõi kỳ nghỉ của bạn.</p></header><div class="booking-body">'+
    '<label>Tên đăng nhập<input name="username" required minlength="3" maxlength="50" pattern="[A-Za-z0-9_.\\-]{3,50}" autocomplete="username"><small>3–50 ký tự: chữ không dấu, số, dấu chấm, gạch dưới hoặc gạch ngang.</small></label>'+
    (register?'<label>Họ và tên<input name="fullName" required maxlength="100" autocomplete="name"></label><label>Email<input name="email" required type="email" maxlength="200" autocomplete="email"></label><label>Số điện thoại<input name="phone" required type="tel" maxlength="30" autocomplete="tel"></label>':'')+
    '<label>Mật khẩu<input name="password" type="password" required '+(register?'minlength="8" ':'')+'maxlength="72" autocomplete="'+(register?'new-password':'current-password')+'"></label>'+
    (register?'<label>Nhập lại mật khẩu<input name="confirmPassword" type="password" required minlength="8" maxlength="72" autocomplete="new-password"></label>':'')+
    '<div class="customer-error" role="alert"></div><button class="customer-switch" type="button" data-switch="'+(register?'login':'register')+'">'+(register?'Đã có tài khoản? Đăng nhập':'Chưa có tài khoản? Đăng ký')+'</button>'+(!register?'<button class="customer-switch" type="button" data-forgot>Quên mật khẩu?</button>':'')+'</div><div class="booking-actions"><button type="button" data-close>Đóng</button><button type="submit">'+(register?'Đăng ký':'Đăng nhập')+'</button></div></form>';
  const form = document.getElementById('customer-form');
  form.querySelector('[data-close]').onclick = () => accountDialog.close();
  if (onAuthenticated) form.querySelector('header p').textContent = 'Vui lòng đăng nhập hoặc đăng ký để tiếp tục đặt phòng đã chọn.';
  form.querySelector('[data-switch]').onclick = event => showCustomerAuth(event.currentTarget.dataset.switch, onAuthenticated);
  const forgot = form.querySelector('[data-forgot]');
  if (forgot) forgot.onclick = showCustomerForgotPassword;
  form.onsubmit = async event => {
    event.preventDefault();
    const error = form.querySelector('.customer-error');
    const submit = form.querySelector('[type="submit"]');
    error.textContent = '';
    const values = Object.fromEntries(new FormData(form).entries());
    if (register && values.password !== values.confirmPassword) { error.textContent = 'Mật khẩu nhập lại không khớp.'; return; }
    delete values.confirmPassword;
    submit.disabled = true;
    try {
      const session = await customerRequest('/api/CustomerAuth/'+mode, {method:'POST',body:values,auth:false});
      setCustomerSession(session);
      accountDialog.close();
      if (onAuthenticated) {
        try { await onAuthenticated(); } catch (e) { showToast(e.message, true); }
      }
    } catch (e) { error.textContent = e.message || 'Không kết nối được máy chủ.'; }
    finally { submit.disabled = false; }
  };
  if (!accountDialog.open) accountDialog.showModal();
}

function customerAccountForm(title, description, fields, submitLabel, onSubmit, extraActions = '') {
  accountDialog.innerHTML = '<form id="customer-account-form" class="booking-form"><header><h2>'+customerEscape(title)+'</h2><p>'+customerEscape(description)+'</p></header><div class="booking-body">'+fields+'<div class="customer-error" role="alert"></div></div><div class="booking-actions">'+extraActions+'<button type="button" data-close>Đóng</button><button type="submit">'+customerEscape(submitLabel)+'</button></div></form>';
  const form = document.getElementById('customer-account-form');
  form.querySelector('[data-close]').onclick = () => accountDialog.close();
  form.onsubmit = async event => {
    event.preventDefault();
    const submit = form.querySelector('[type="submit"]');
    const error = form.querySelector('.customer-error');
    error.textContent = '';
    submit.disabled = true;
    try { await onSubmit(Object.fromEntries(new FormData(form).entries()), form); }
    catch (e) { error.textContent = e.message || 'Không kết nối được máy chủ.'; }
    finally { submit.disabled = false; }
  };
  if (!accountDialog.open) accountDialog.showModal();
  return form;
}

async function showCustomerProfile() {
  if (!customerSession.token) { showCustomerAuth(); return; }
  const profile = await customerRequest('/api/CustomerAuth/me');
  const value = name => customerEscape(profile[name] || '');
  const form = customerAccountForm('Hồ sơ của tôi', 'Cập nhật thông tin liên hệ và giấy tờ của bạn.',
    '<label>Tên đăng nhập<input name="username" readonly value="'+value('username')+'" autocomplete="username"></label>'+
    '<label>Họ và tên<input name="fullName" required maxlength="100" value="'+value('fullName')+'" autocomplete="name"></label>'+
    '<label>Số điện thoại<input name="phone" required type="tel" maxlength="30" value="'+value('phone')+'" autocomplete="tel"></label>'+
    '<label>Email<input name="email" required type="email" maxlength="200" value="'+value('email')+'" autocomplete="email"></label>'+
    '<label>Mật khẩu hiện tại (chỉ cần khi đổi email)<input name="currentPassword" type="password" maxlength="72" autocomplete="current-password"></label>'+
    '<label>CCCD / Hộ chiếu<input name="identityCard" maxlength="20" value="'+value('identityCard')+'"></label>'+
    '<label>Địa chỉ<textarea name="address" maxlength="200" autocomplete="street-address">'+value('address')+'</textarea></label>',
    'Lưu hồ sơ', async values => {
      const account = await customerRequest('/api/CustomerAuth/me', {method:'PUT',body:values});
      customerSession.account = account;
      renderCustomerActions();
      window.dispatchEvent(new Event('customer-profile-changed'));
      accountDialog.close();
      showToast('Đã cập nhật hồ sơ.');
    }, '<button type="button" data-password>Đổi mật khẩu</button>');
  form.querySelector('[data-password]').onclick = showCustomerPasswordChange;
}

function customerNewPasswordFields() {
  return '<label>Mật khẩu mới<input name="newPassword" type="password" required minlength="8" maxlength="72" autocomplete="new-password"><small>Tối thiểu 8 ký tự và tối đa 72 byte UTF-8.</small></label>'+
    '<label>Nhập lại mật khẩu mới<input name="confirmPassword" type="password" required minlength="8" maxlength="72" autocomplete="new-password"></label>';
}
function validateCustomerPassword(values) {
  if (values.newPassword !== values.confirmPassword) throw new Error('Mật khẩu nhập lại không khớp.');
  if (new TextEncoder().encode(values.newPassword).length > 72) throw new Error('Mật khẩu quá dài. Vui lòng dùng tối đa 72 byte UTF-8.');
}
function showCustomerPasswordChange() {
  if (!customerSession.token) { showCustomerAuth(); return; }
  customerAccountForm('Đổi mật khẩu', 'Sau khi lưu, bạn cần đăng nhập lại trên các thiết bị.',
    '<label>Mật khẩu hiện tại<input name="oldPassword" type="password" required maxlength="72" autocomplete="current-password"></label>'+customerNewPasswordFields(),
    'Đổi mật khẩu', async values => {
      validateCustomerPassword(values);
      const result = await customerRequest('/api/CustomerAuth/change-password', {method:'POST',body:{oldPassword:values.oldPassword,newPassword:values.newPassword}});
      setCustomerSession(null);
      showCustomerAuth();
      showToast(result.message);
    });
}
function showCustomerForgotPassword() {
  customerAccountForm('Quên mật khẩu', 'Nhập email đã đăng ký để nhận liên kết đặt lại mật khẩu.',
    '<label>Email<input name="email" type="email" required maxlength="200" autocomplete="email"></label>',
    'Gửi liên kết', async values => {
      const result = await customerRequest('/api/CustomerAuth/forgot-password', {method:'POST',body:values,auth:false});
      accountDialog.innerHTML = '<div class="booking-form"><header><h2>Kiểm tra email</h2></header><div class="booking-body"><p class="customer-notice" role="status">'+customerEscape(result.message)+'</p></div><div class="booking-actions"><button type="button" data-login>Về đăng nhập</button><button type="button" data-close>Đóng</button></div></div>';
      accountDialog.querySelector('[data-login]').onclick = () => showCustomerAuth();
      accountDialog.querySelector('[data-close]').onclick = () => accountDialog.close();
    });
}
function showCustomerResetPassword(token) {
  const form = customerAccountForm('Đặt lại mật khẩu', 'Nhập mật khẩu mới cho tài khoản khách hàng.',
    customerNewPasswordFields(), 'Lưu mật khẩu', async values => {
      validateCustomerPassword(values);
      const result = await customerRequest('/api/CustomerAuth/reset-password', {method:'POST',body:{token,newPassword:values.newPassword},auth:false});
      setCustomerSession(null);
      showCustomerAuth();
      showToast(result.message);
    }, '<button type="button" data-new-link>Gửi liên kết mới</button>');
  form.querySelector('[data-new-link]').onclick = showCustomerForgotPassword;
}
function openCustomerResetLink() {
  const parameters = new URLSearchParams(location.hash.slice(1));
  if (!parameters.has('resetToken')) return;
  const token = parameters.get('resetToken');
  // Remove the recovery secret from browser history; keep it only in the form closure.
  history.replaceState(null, '', location.pathname + location.search);
  showCustomerResetPassword(token);
}
async function showCustomerBookings() {
  if (document.body.dataset.customerPortal === 'true') {
    accountDialog.close();
    window.dispatchEvent(new CustomEvent('customer-portal-navigate', { detail: { view: 'bookings' } }));
    return;
  }
  location.assign('/customer.html?v=20261028-account-1#bookings');
}
accountActions.onclick = async event => {
  const button = event.target.closest('[data-customer]');
  if (!button) return;
  try {
    if (button.dataset.customer === 'logout') { setCustomerSession(null); return; }
    if (button.dataset.customer === 'profile') await showCustomerProfile();
    else if (button.dataset.customer === 'bookings') await showCustomerBookings();
    else showCustomerAuth(button.dataset.customer);
  } catch (e) { alert(e.message || 'Không kết nối được máy chủ.'); }
};
renderCustomerActions();
openCustomerResetLink();
window.addEventListener('hashchange', openCustomerResetLink);
const customerSessionReady = customerSession.token ? (async () => {
  const initialToken = customerSession.token;
  await customerRequest('/api/CustomerAuth/me').then(account => {
    if (customerSession.token === initialToken) { customerSession.account = account; renderCustomerActions(); }
  }).catch(() => { if (customerSession.token === initialToken) setCustomerSession(null); });
})() : Promise.resolve();

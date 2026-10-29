(() => {
  const host = document.createElement('div');
  host.className = 'guest-notifications'; host.hidden = true;
  const mount = document.querySelector('.portal-topbar-inner') || document.querySelector('.site-header');
  if (!mount) return;
  mount.append(host);
  host.innerHTML = '<button type="button" class="guest-bell" aria-label="Thông báo" aria-expanded="false" aria-controls="guest-notification-panel"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span>Thông báo</span><b hidden></b></button><section id="guest-notification-panel" class="guest-notification-panel" aria-label="Thông báo của bạn" hidden><header><strong>Thông báo</strong><button type="button" data-read-all>Đọc tất cả</button></header><p class="guest-notification-error" role="status"></p><div data-notification-items></div><small>Hiển thị tối đa 100 thông báo gần nhất.</small></section>';
  const bell = host.querySelector('.guest-bell'), panel = host.querySelector('section'), badge = bell.querySelector('b');
  const list = host.querySelector('[data-notification-items]'), error = host.querySelector('.guest-notification-error');
  let items = [], generation = 0, loading = false, busy = false;
  const escape = customerEscape;
  function close() { panel.hidden = true; bell.setAttribute('aria-expanded','false'); }
  function render() {
    const unread = items.filter(x => !x.isRead).length;
    badge.hidden = unread === 0; badge.textContent = unread > 99 ? '99+' : unread;
    bell.setAttribute('aria-label', 'Thông báo' + (unread ? ' · '+unread+' chưa đọc' : ''));
    host.querySelector('[data-read-all]').disabled = !unread || busy;
    list.innerHTML = items.length ? items.map(x => '<a class="guest-notification'+(x.isRead?'':' unread')+'" href="/customer.html#booking-'+x.bookingId+'" data-event-key="'+escape(x.id)+'"><strong>'+escape(x.title)+'</strong><span>'+escape(x.message)+'</span><time datetime="'+escape(x.createdAtUtc)+'">'+escape(new Date(x.createdAtUtc).toLocaleString('vi-VN',{timeZone:window.hotelTime?.zone||'Asia/Ho_Chi_Minh'}))+'</time></a>').join('') : '<p class="guest-notification-empty">Bạn chưa có thông báo nào.</p>';
  }
  async function refresh() {
    if (loading || !customerSession.token || !customerSession.account || document.hidden) return;
    const version = generation; loading = true;
    try {
      const data = await customerRequest('/api/CustomerNotifications', { signal: AbortSignal.timeout(15000) });
      if (version !== generation) return;
      window.bookingHold?.sync(data.serverTimeUtc);
      items = data.items; error.textContent = ''; render();
    } catch (e) { if (version === generation) error.innerHTML = escape(e.message)+' <button type="button" data-notification-retry>Thử lại</button>'; }
    finally { if (version === generation) loading = false; }
  }
  function session() {
    generation++; loading = false; items = []; close(); render(); error.textContent = '';
    host.hidden = !customerSession.token || !customerSession.account;
    if (!host.hidden) refresh();
  }
  bell.onclick = () => { panel.hidden = !panel.hidden; bell.setAttribute('aria-expanded', String(!panel.hidden)); if (!panel.hidden) refresh(); };
  host.addEventListener('click', async event => {
    if (event.target.closest('[data-notification-retry]')) { refresh(); return; }
    const all = event.target.closest('[data-read-all]'), link = event.target.closest('[data-event-key]');
    if (!all && !link) return;
    event.preventDefault(); if (busy) return;
    const keys = all ? items.filter(x=>!x.isRead).map(x=>x.id) : [link.dataset.eventKey];
    const version = generation; busy = true; render();
    try {
      await customerRequest('/api/CustomerNotifications/read', { method:'POST', body:{keys}, signal:AbortSignal.timeout(15000) });
      if (version !== generation) return;
      items = items.map(x=>keys.includes(x.id)?{...x,isRead:true}:x); error.textContent = ''; render();
      if (link) { close(); location.assign(link.href); }
    } catch (e) { if (version === generation) error.textContent = e.message; }
    finally { busy = false; if(version === generation) render(); }
  });
  document.addEventListener('click', event => { if (!host.contains(event.target)) close(); });
  document.addEventListener('keydown', event => { if(event.key==='Escape'&&!panel.hidden){close();bell.focus();} });
  window.addEventListener('customer-session-changed', session);
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  setInterval(refresh,15000); session();
  customerSessionReady.then(session);
})();

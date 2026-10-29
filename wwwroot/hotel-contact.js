(() => {
  const blocks = Array.from(document.querySelectorAll('[data-hotel-contact]'));
  if (!blocks.length) return;
  const base = '/api/HotelContact';
  let running = null;
  function safeLink(value, kind) {
    if (typeof value !== 'string') return null;
    if (kind === 'phone') return /^tel:\+?[0-9]{7,15}$/.test(value) ? value : null;
    if (kind === 'email') return value.startsWith('mailto:') && !/[\r\n<>]/.test(value) ? value : null;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
        ['facebook.com','www.facebook.com','m.facebook.com'].includes(url.hostname) ? url.href : null;
    } catch { return null; }
  }
  function render(data) {
    for (const block of blocks) {
      block.replaceChildren();
      const links = document.createElement('div'); links.className = 'hotel-contact-links';
      for (const [kind,title,label,href] of [
        ['phone','Gọi lễ tân',data.phone,safeLink(data.phoneUrl,'phone')],
        ['email','Gửi email',data.email,safeLink(data.emailUrl,'email')],
        ['facebook','Facebook','Nhắn tin qua trang Facebook',safeLink(data.facebookUrl,'facebook')]
      ]) {
        if (!href) continue;
        const anchor = document.createElement('a'); anchor.className = 'hotel-contact-link';
        anchor.href = href; anchor.dataset.contactKind = kind;
        const heading = document.createElement('strong'); heading.textContent = title;
        const detail = document.createElement('span'); detail.textContent = label;
        anchor.append(heading,detail);
        if (kind==='facebook') { anchor.target = '_blank'; anchor.rel = 'noopener noreferrer'; }
        links.append(anchor);
      }
      if (links.childElementCount) block.append(links);
      else { const empty = document.createElement('p'); empty.textContent = 'Khách sạn chưa cập nhật kênh liên hệ. Vui lòng thử lại sau.'; block.append(empty); }
    }
  }
  async function load() {
    if (running) return running;
    running = (async () => {
      try {
        const response = await fetch(base,{cache:'no-store',signal:AbortSignal.timeout(15000)});
        if (!response.ok) throw new Error('Contact unavailable');
        const data = await response.json(); render(data);
      } catch {
        for (const block of blocks) {
          block.replaceChildren();
          const message = document.createElement('p'); message.textContent = 'Chưa tải được thông tin liên hệ. Vui lòng thử lại.'; message.setAttribute('role','status');
          const retry = document.createElement('button'); retry.type = 'button'; retry.textContent = 'Tải lại thông tin liên hệ'; retry.onclick = () => { retry.disabled = true; load(); };
          block.append(message,retry);
        }
      } finally { running = null; }
    })();
    return running;
  }
  window.hotelContactReady = load();
})();

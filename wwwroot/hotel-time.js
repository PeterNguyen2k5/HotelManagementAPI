// Stay on the hotel's calendar even when staff and guests use a different device time zone.
window.hotelTime = {
  zone: 'Asia/Ho_Chi_Minh',
  day(offset = 0) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: this.zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const date = new Date(today + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  },
  format(value, includeTime = false) {
    if (!value) return '—';
    // Existing database timestamps without an offset represent hotel wall time.
    const wallTime = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+)?$/.test(value);
    const parsed = new Date(wallTime && value.includes('T') ? value + 'Z' : value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return new Intl.DateTimeFormat('vi-VN', { timeZone: wallTime ? 'UTC' : this.zone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      ...(includeTime ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : {}) }).format(parsed);
  }
};
window.hotelTimeReady = (async () => {
  try {
    const response = await fetch('/api/HotelConfiguration', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return;
    const config = await response.json();
    if (typeof config.timeZone !== 'string') return;
    new Intl.DateTimeFormat('vi-VN', { timeZone: config.timeZone });
    window.hotelTime.zone = config.timeZone;
  } catch { /* Other API requests surface connection failures; keep the Vietnam default. */ }
})();

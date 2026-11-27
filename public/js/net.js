// Resilient WebSocket: reconnects on drop, on tab focus, and after phone sleep.
export class Conn {
  constructor(code, role, handlers) {
    this.code = code;
    this.role = role;
    this.h = handlers;
    this.ws = null;
    this.tries = 0;
    this.offset = 0; // serverNow - localNow
    this.dead = false;
    this.connect();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.ensure();
    });
    window.addEventListener('online', () => this.ensure());
    window.addEventListener('pageshow', () => this.ensure());
    setInterval(() => this.ping(), 20000);
  }

  url() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws/${this.code}?role=${this.role}`;
  }

  connect() {
    if (this.dead) return;
    clearTimeout(this.retryT);
    try { this.ws && this.ws.close(); } catch {}
    const ws = new WebSocket(this.url());
    this.ws = ws;
    this.h.status && this.h.status('connecting');
    ws.onopen = () => {
      this.tries = 0;
      this.lastPong = Date.now();
      this.h.status && this.h.status('open');
      this.h.open && this.h.open();
    };
    ws.onmessage = (ev) => {
      if (ev.data === 'pong') { this.lastPong = Date.now(); return; }
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.now) this.offset = m.now - Date.now();
      this.h.msg && this.h.msg(m);
    };
    ws.onclose = (ev) => {
      if (ws !== this.ws) return;
      if (ev.code === 4001) { this.h.status && this.h.status('replaced'); return; }
      if (ev.code === 4004) { this.h.status && this.h.status('gone'); return; }
      this.h.status && this.h.status('closed');
      this.retry();
    };
    ws.onerror = () => {};
  }

  retry() {
    clearTimeout(this.retryT);
    const wait = Math.min(4000, 300 * 2 ** this.tries++);
    this.retryT = setTimeout(() => this.connect(), wait);
  }

  ensure() {
    if (this.dead) return;
    if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
      this.tries = 0;
      this.connect();
    } else if (this.ws.readyState === WebSocket.OPEN) {
      this.ping();
      // If the socket silently died while the phone slept, force a reconnect.
      const sent = Date.now();
      setTimeout(() => { if ((this.lastPong || 0) < sent && this.ws.readyState === WebSocket.OPEN) this.connect(); }, 2500);
    }
  }

  ping() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) try { this.ws.send('ping'); } catch {}
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    this.ensure();
    return false;
  }

  now() { return Date.now() + this.offset; }

  close() {
    this.dead = true;
    try { this.ws.close(); } catch {}
  }
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

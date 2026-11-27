import { DurableObject } from 'cloudflare:workers';
import zinger from './games/zinger.js';
import hunch from './games/hunch.js';
import faker from './games/faker.js';
import { FALLBACKS, BOT_NAMES } from './content.js';
import { pick, rid, clamp } from './util.js';

export const GAMES = { zinger, hunch, faker };
const COLORS = ['#ff3b6b', '#2ec4ff', '#ffd23f', '#5fe35a', '#b26bff', '#ff8c2e', '#2effc4', '#ff6bd6', '#6b8cff', '#d4ff3a'];
const EMOJI = ['😂', '😱', '👏', '🍅'];
const MAX_PLAYERS = 10;
const STALE_MS = 8 * 60 * 60 * 1000;

export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.s = null;
    this.live = { slide: {}, lastReact: {} };
    this.saveT = null;
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get('state')) || null;
    });
    try {
      ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    } catch {}
  }

  // ---------- RPC from the Worker ----------
  async init(code) {
    if (this.s && Date.now() - this.s.updated < STALE_MS) return { ok: false };
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    for (const ws of this.ctx.getWebSockets()) try { ws.close(4004, 'room reset'); } catch {}
    const now = Date.now();
    this.s = {
      code, hostKey: rid(), created: now, updated: now,
      phase: 'lobby', phaseId: 1, phaseStart: now, deadline: null, pd: {}, spot: [],
      players: {}, order: [], vip: null,
      settings: { kid: false, prize: '' },
      game: null, lastType: null, podium: null, stats: {}, top: null,
      events: [], colorI: 0,
    };
    await this.ctx.storage.put('state', this.s);
    return { ok: true, hostKey: this.s.hostKey };
  }

  async info() {
    const s = this.s;
    if (!s || Date.now() - s.updated > STALE_MS) return { exists: false };
    return { exists: true, players: s.order.length, phase: s.phase };
  }

  // ---------- WebSocket plumbing (hibernation API) ----------
  async fetch(request) {
    const url = new URL(request.url);
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'player';
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role, pid: null, ok: false });
    if (!this.s) {
      server.send(JSON.stringify({ t: 'error', code: 'NO_ROOM', msg: 'That room code does not exist.' }));
      server.close(4004, 'no room');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string') return;
    if (raw === 'ping') return void this.send(ws, 'pong');
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!this.s) return void this.send(ws, { t: 'error', code: 'NO_ROOM', msg: 'That room code does not exist.' });
    const att = ws.deserializeAttachment() || {};
    try {
      await this.onMessage(ws, att, m);
    } catch (e) {
      console.error('message error', e && e.stack || e);
    }
  }

  async webSocketClose(ws) { await this.dropSocket(ws); }
  async webSocketError(ws) { await this.dropSocket(ws); }

  async dropSocket(ws) {
    try { ws.close(1000, 'bye'); } catch {}
    if (!this.s) return;
    const att = ws.deserializeAttachment() || {};
    if (att.role === 'player' && att.pid && this.s.players[att.pid]) {
      const still = this.socketsFor(att.pid).some((w) => w !== ws);
      if (!still) {
        this.s.players[att.pid].connected = false;
        await this.commit();
      }
    }
  }

  socketsFor(pid) {
    return this.ctx.getWebSockets().filter((w) => {
      const a = w.deserializeAttachment() || {};
      return a.role === 'player' && a.pid === pid;
    });
  }

  send(ws, obj) {
    try { ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); } catch {}
  }

  toHosts(obj) {
    const str = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.role === 'host' && a.ok) this.send(ws, str);
    }
  }

  broadcast() {
    const now = Date.now();
    const hostStr = JSON.stringify({ t: 'state', now, v: this.hostView() });
    const cache = {};
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() || {};
      if (a.role === 'host' && a.ok) this.send(ws, hostStr);
      else if (a.role === 'player' && a.pid && this.s.players[a.pid]) {
        cache[a.pid] ??= JSON.stringify({ t: 'state', now, v: this.playerView(a.pid) });
        this.send(ws, cache[a.pid]);
      }
    }
  }

  async commit({ quiet = false } = {}) {
    if (!this.s) return;
    this.s.updated = Date.now();
    await this.armAlarm();
    if (this.saveT) { clearTimeout(this.saveT); this.saveT = null; }
    await this.ctx.storage.put('state', this.s);
    if (!quiet) this.broadcast();
  }

  // Debounced save for chatty, low-stakes updates (drafts, reactions).
  saveSoon() {
    if (this.saveT) return;
    this.saveT = setTimeout(() => {
      this.saveT = null;
      if (this.s) this.ctx.storage.put('state', this.s);
    }, 1200);
  }

  // ---------- Timers: one alarm drives a small event queue ----------
  at(ms, kind, data = null) {
    this.s.events.push({ at: Date.now() + Math.max(0, ms), kind, data, pid: this.s.phaseId });
  }

  async armAlarm() {
    const ev = (this.s.events || []).filter((e) => e.pid === this.s.phaseId);
    this.s.events = ev;
    if (!ev.length) return void (await this.ctx.storage.deleteAlarm());
    const next = Math.min(...ev.map((e) => e.at));
    await this.ctx.storage.setAlarm(Math.max(next, Date.now() + 5));
  }

  async alarm() {
    if (!this.s) return;
    for (let guard = 0; guard < 60; guard++) {
      const now = Date.now();
      const due = this.s.events
        .filter((e) => e.pid === this.s.phaseId && e.at <= now + 25)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.s.events = this.s.events.filter((e) => e !== due);
      try { this.runEvent(due); } catch (e) { console.error('event error', e && e.stack || e); }
    }
    await this.commit();
  }

  runEvent(e) {
    if (e.kind === 'timeout') return this.timeout();
    const G = this.G();
    if (e.kind === 'bot' && G && G.bot) {
      const p = this.s.players[e.data.pid];
      if (p && p.bot && p.inGame) G.bot(this, e.data);
    }
  }

  timeout() {
    const G = this.G();
    if (this.s.phase === 'intro' && G) return G.begin(this);
    if (G) return G.timeout(this);
  }

  // ---------- Helpers used by game modules ----------
  G() { return this.s.game ? GAMES[this.s.game.type] : null; }
  get g() { return this.s.game; }
  get phaseName() { return this.s.phase; }

  phase(name, sec, opts = {}) {
    const s = this.s;
    const now = Date.now();
    const mult = opts.input ? this.timeMult() : 1;
    s.phase = name;
    s.phaseId++;
    s.phaseStart = now;
    s.pd = { ...(opts.data || {}), input: !!opts.input, hostPaced: !!opts.hostPaced };
    s.spot = opts.spot || [];
    s.events = [];
    const ms = sec ? sec * 1000 * mult : 0;
    s.deadline = ms && (opts.input || opts.timer) ? now + ms : null;
    if (ms) this.at(ms, 'timeout');
  }

  timeMult() { return this.s.settings.kid ? 1.5 : 1; }

  active() { return this.s.order.map((id) => this.s.players[id]).filter((p) => p && p.inGame); }
  // Players we wait on before moving early (connected humans + bots).
  needed() { return this.active().filter((p) => p.connected || p.bot); }
  bots() { return this.active().filter((p) => p.bot); }
  name(pid) { return this.s.players[pid]?.name || '???'; }

  botsDo(kind, minMs, maxMs, filter = () => true, extra = {}) {
    for (const p of this.bots()) {
      if (!filter(p)) continue;
      this.at(minMs + Math.random() * (maxMs - minMs), 'bot', { pid: p.id, kind, ...extra });
    }
  }

  addScore(pid, pts) {
    const p = this.s.players[pid];
    if (p) p.score = Math.round(p.score + pts);
  }

  stat(pid, key, n = 1) {
    this.s.stats[pid] ??= {};
    this.s.stats[pid][key] = (this.s.stats[pid][key] || 0) + n;
  }

  submitted(pid) {
    this.stat(pid, 'subN');
    this.stat(pid, 'subMs', Date.now() - this.s.phaseStart);
  }

  quote(text, by, pts, sub) {
    if (!text || pts <= 0) return;
    if (!this.s.top || pts > this.s.top.pts) this.s.top = { text, by, byName: this.name(by), pts, sub };
  }

  fallback() { return pick(FALLBACKS); }

  vipId() {
    const s = this.s;
    const humans = s.order.map((id) => s.players[id]).filter((p) => p && !p.bot);
    if (s.vip && s.players[s.vip]?.connected) return s.vip;
    const live = humans.find((p) => p.connected);
    return live ? live.id : s.vip;
  }

  // ---------- Views ----------
  publicPlayers() {
    return this.s.order.map((id) => {
      const p = this.s.players[id];
      return { id, name: p.name, color: p.color, score: p.score, connected: p.connected, bot: p.bot, inGame: p.inGame };
    });
  }

  hostView() {
    const s = this.s;
    const G = this.G();
    return {
      code: s.code, phase: s.phase, phaseId: s.phaseId, phaseStart: s.phaseStart, deadline: s.deadline,
      pd: s.pd, settings: s.settings, vip: this.vipId(),
      players: this.publicPlayers(),
      game: s.game ? { type: s.game.type, title: G.title, rules: G.rules } : null,
      gv: G ? G.hostView(this) : null,
      podium: s.phase === 'podium' ? s.podium : null,
      lastType: s.lastType,
    };
  }

  playerView(pid) {
    const s = this.s;
    const p = s.players[pid];
    const G = this.G();
    const vip = this.vipId() === pid;
    const v = {
      code: s.code, phase: s.phase, phaseId: s.phaseId, deadline: s.deadline, settings: s.settings,
      me: { id: pid, name: p.name, color: p.color, score: p.score, inGame: p.inGame, vip },
      vipName: this.name(this.vipId()),
      count: s.order.length,
      game: s.game ? { type: s.game.type, title: G.title } : null,
      pv: G && p.inGame ? G.playerView(this, pid) : null,
    };
    if (vip) {
      v.players = this.publicPlayers();
    }
    if (s.phase === 'lobby') {
      v.games = Object.entries(GAMES).map(([id, g]) => ({ id, title: g.title, tagline: g.tagline, min: g.min }));
    }
    if (s.phase === 'podium' && s.podium) {
      const rank = s.podium.ranking.findIndex((r) => r.id === pid);
      v.podium = { rank: rank + 1, of: s.podium.ranking.length, lastType: s.lastType, awards: s.podium.awards.filter((a) => a.id === pid).map((a) => a.title) };
    }
    return v;
  }

  // ---------- Messages ----------
  async onMessage(ws, att, m) {
    const s = this.s;
    if (att.role === 'host') {
      if (m.t === 'host-hello') {
        if (m.hostKey !== s.hostKey) return void this.send(ws, { t: 'error', code: 'BAD_HOST', msg: 'Not the host of this room.' });
        att.ok = true;
        ws.serializeAttachment(att);
        const avs = await this.ctx.storage.list({ prefix: 'av:' });
        const map = {};
        for (const [k, val] of avs) map[k.slice(3)] = val;
        this.send(ws, { t: 'avatars', map });
        this.send(ws, { t: 'state', now: Date.now(), v: this.hostView() });
        return;
      }
      if (!att.ok) return;
      if (m.t === 'add-bots' && s.phase === 'lobby') {
        this.addBots(3);
        return void (await this.commit());
      }
      if (m.t === 'remove-bots' && s.phase === 'lobby') {
        for (const id of [...s.order]) if (s.players[id].bot) this.removePlayer(id);
        return void (await this.commit());
      }
      if (m.t === 'host-done') {
        if (m.phaseId === s.phaseId && s.pd.hostPaced) {
          this.timeout();
          await this.commit();
        }
        return;
      }
      return;
    }

    // ---- player ----
    if (m.t === 'hello') {
      const p = s.players[m.pid];
      if (!p || p.bot) return void this.send(ws, { t: 'unknown' });
      await this.bind(ws, att, p.id);
      return;
    }
    if (m.t === 'join') return void (await this.join(ws, att, m));

    const pid = att.pid;
    const p = pid && s.players[pid];
    if (!p) return void this.send(ws, { t: 'unknown' });

    if (m.t === 'leave') {
      this.leavePlayer(pid, ws);
      return void (await this.commit());
    }

    if (m.t === 'edit' && s.phase === 'lobby') {
      const name = this.cleanName(m.name);
      if (!name) return void this.send(ws, { t: 'error', code: 'NAME', msg: 'Type a name first!' });
      const clash = Object.values(s.players).find((x) => x.id !== pid && x.name === name && !x.bot && !x.left);
      if (clash && clash.connected && this.socketsFor(clash.id).length) {
        return void this.send(ws, { t: 'error', code: 'NAME_TAKEN', msg: `Someone is already ${name}. Pick another name!` });
      }
      p.name = name;
      if (typeof m.avatar === 'string' && m.avatar.startsWith('data:image/') && m.avatar.length < 200000) {
        await this.ctx.storage.put('av:' + pid, m.avatar);
        this.toHosts({ t: 'avatar', id: pid, data: m.avatar });
      } else if (m.avatar === null) {
        await this.ctx.storage.delete('av:' + pid);
        this.toHosts({ t: 'avatar', id: pid, data: null });
      }
      return void (await this.commit());
    }

    if (m.t === 'react') {
      if (!EMOJI.includes(m.e)) return;
      const now = Date.now();
      if (now - (this.live.lastReact[pid] || 0) < 250) return;
      this.live.lastReact[pid] = now;
      this.stat(pid, 'sent');
      for (const sp of s.spot || []) if (sp !== pid) this.stat(sp, 'got');
      this.toHosts({ t: 'react', e: m.e, color: p.color, pid });
      this.saveSoon();
      return;
    }

    if (m.t === 'vip') {
      if (this.vipId() !== pid) return;
      return void (await this.vipAction(ws, m));
    }

    if (m.t === 'act') {
      const G = this.G();
      if (!G || !p.inGame) return;
      const r = G.action(this, pid, m);
      if (r === 'quiet') return void this.saveSoon();
      if (r === 'none') return;
      await this.commit();
    }
  }

  async bind(ws, att, pid) {
    att.pid = pid;
    att.ok = true;
    ws.serializeAttachment(att);
    for (const w of this.socketsFor(pid)) if (w !== ws) try { w.close(4001, 'replaced'); } catch {}
    this.s.players[pid].connected = true;
    this.send(ws, { t: 'welcome', pid, code: this.s.code });
    await this.commit();
  }

  cleanName(n) {
    return String(n || '').replace(/[^\p{L}\p{N} '!?.&-]/gu, '').replace(/\s+/g, ' ').trim().toUpperCase().slice(0, 12);
  }

  async join(ws, att, m) {
    const s = this.s;
    const name = this.cleanName(m.name);
    if (!name) return void this.send(ws, { t: 'error', code: 'NAME', msg: 'Type a name first!' });
    let p = Object.values(s.players).find((x) => x.name === name && !x.bot && !x.left);
    if (p && p.connected && this.socketsFor(p.id).length) {
      return void this.send(ws, { t: 'error', code: 'NAME_TAKEN', msg: `Someone is already ${name}. Pick another name!` });
    }
    if (!p) {
      const humans = s.order.filter((id) => !s.players[id].bot).length;
      if (s.order.length >= MAX_PLAYERS) {
        const bot = s.order.find((id) => s.players[id].bot);
        if (bot && s.phase === 'lobby') this.removePlayer(bot);
        else return void this.send(ws, { t: 'error', code: 'FULL', msg: 'This room is full (10 players).' });
      }
      p = {
        id: rid(), name, color: this.nextColor(), score: 0, connected: true, bot: false,
        inGame: !s.game, joined: Date.now(),
      };
      s.players[p.id] = p;
      s.order.push(p.id);
      if (!s.vip || !humans) s.vip = p.id;
    }
    if (typeof m.avatar === 'string' && m.avatar.startsWith('data:image/') && m.avatar.length < 200000) {
      await this.ctx.storage.put('av:' + p.id, m.avatar);
      this.toHosts({ t: 'avatar', id: p.id, data: m.avatar });
    }
    await this.bind(ws, att, p.id);
  }

  nextColor() {
    const used = new Set(Object.values(this.s.players).map((p) => p.color));
    const free = COLORS.find((c) => !used.has(c));
    return free || COLORS[this.s.colorI++ % COLORS.length];
  }

  addBots(n) {
    const s = this.s;
    const taken = new Set(Object.values(s.players).map((p) => p.name));
    for (let i = 0; i < n && s.order.length < MAX_PLAYERS; i++) {
      const name = BOT_NAMES.find((b) => !taken.has(b)) || 'BOT ' + rid().slice(0, 3).toUpperCase();
      taken.add(name);
      const p = { id: rid(), name, color: this.nextColor(), score: 0, connected: true, bot: true, inGame: !s.game, joined: Date.now() };
      s.players[p.id] = p;
      s.order.push(p.id);
    }
  }

  removePlayer(id) {
    delete this.s.players[id];
    this.s.order = this.s.order.filter((x) => x !== id);
    this.ctx.storage.delete('av:' + id);
    if (this.s.vip === id) {
      const next = this.s.order.find((x) => this.s.players[x] && !this.s.players[x].bot);
      this.s.vip = next || null;
    }
  }

  leavePlayer(id, skipWs) {
    const p = this.s.players[id];
    if (!p) return;
    for (const w of this.socketsFor(id)) if (w !== skipWs) try { w.close(1000, 'left'); } catch {}
    if (skipWs) try { skipWs.serializeAttachment({ role: 'player', pid: null, ok: false }); skipWs.close(1000, 'left'); } catch {}
    if (this.s.phase === 'lobby' || this.s.phase === 'podium') {
      this.removePlayer(id);
    } else {
      p.left = true;
      p.inGame = false;
      p.connected = false;
      this.s.order = this.s.order.filter((x) => x !== id);
      if (this.s.vip === id) {
        const next = this.s.order.find((x) => this.s.players[x] && !this.s.players[x].bot);
        this.s.vip = next || null;
      }
    }
  }

  async vipAction(ws, m) {
    const s = this.s;
    const a = m.a;
    if (a === 'kid') {
      s.settings.kid = !!m.on;
      return void (await this.commit());
    }
    if (a === 'prize') {
      s.settings.prize = String(m.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
      return void (await this.commit());
    }
    if (a === 'kick' && m.id && m.id !== this.vipId() && s.players[m.id]) {
      for (const w of this.socketsFor(m.id)) try { w.close(4004, 'kicked'); } catch {}
      this.removePlayer(m.id);
      return void (await this.commit());
    }
    if (a === 'skip-phase' && s.game) {
      this.timeout();
      return void (await this.commit());
    }
    if (a === 'start' || a === 'again') {
      if (s.phase !== 'lobby' && s.phase !== 'podium') return;
      const type = a === 'again' ? s.lastType : m.game;
      const G = GAMES[type];
      if (!G) return;
      const count = s.order.length;
      if (count < G.min) {
        return void this.send(ws, { t: 'error', code: 'MIN', msg: `${G.title} needs at least ${G.min} players.` });
      }
      this.startGame(type);
      return void (await this.commit());
    }
    if (a === 'skip' && s.phase === 'intro') {
      this.timeout();
      return void (await this.commit());
    }
    if (a === 'switch' || a === 'end') {
      this.toLobby();
      return void (await this.commit());
    }
  }

  startGame(type) {
    const s = this.s;
    const G = GAMES[type];
    for (const id of s.order) {
      s.players[id].inGame = true;
      s.players[id].score = 0;
    }
    s.stats = {};
    s.top = null;
    s.podium = null;
    s.game = { type };
    Object.assign(s.game, G.init(this));
    this.phase('intro', 22, { hostPaced: true });
  }

  toLobby() {
    const s = this.s;
    s.game = null;
    s.podium = null;
    for (const id of Object.keys(s.players)) {
      if (s.players[id].left) { delete s.players[id]; this.ctx.storage.delete('av:' + id); }
    }
    for (const id of s.order) s.players[id].inGame = true;
    this.phase('lobby', 0);
  }

  // Called by game modules when the game is over.
  finish() {
    const s = this.s;
    const G = this.G();
    const ranking = this.active()
      .map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score }))
      .sort((a, b) => b.score - a.score);
    const st = (id) => s.stats[id] || {};
    const ids = this.active().map((p) => p.id);
    const awards = [];
    const best = (score, filter = () => true) => {
      let top = null;
      for (const id of ids) {
        if (!filter(id)) continue;
        const v = score(id);
        if (v == null) continue;
        if (!top || v > top.v) top = { id, v };
      }
      return top;
    };
    const speed = best((id) => (st(id).subN >= 2 ? -st(id).subMs / st(id).subN : null));
    if (speed) awards.push({ title: 'SPEED DEMON', icon: '⚡', id: speed.id, detail: `answers in ${(-speed.v / 1000).toFixed(1)}s on average` });
    const fav = best((id) => st(id).got || null);
    if (fav) awards.push({ title: 'CROWD FAVORITE', icon: '💖', id: fav.id, detail: `${fav.v} reactions from the couch` });
    if (G.awards) for (const aw of G.awards(this, st, best)) if (aw) awards.push(aw);
    const hype = best((id) => st(id).sent || null);
    if (hype) awards.push({ title: 'HYPE MACHINE', icon: '📣', id: hype.id, detail: `sent ${hype.v} reactions` });
    for (const aw of awards) aw.name = this.name(aw.id);
    s.podium = { ranking, awards: awards.slice(0, 4), top: s.top, title: G.title, type: s.game.type };
    s.lastType = s.game.type;
    s.game = null;
    this.phase('podium', 0);
  }
}

export { clamp };

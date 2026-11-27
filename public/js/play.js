import { Conn, esc } from './net.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const scr = $('#scr');
const bar = $('#bar');
const LS = 'cc-player';

let saved = {};
try { saved = JSON.parse(localStorage.getItem(LS)) || {}; } catch {}
const save = () => { try { localStorage.setItem(LS, JSON.stringify(saved)); } catch {} };

let conn = null;
let V = null;
let key = null;
let pendingJoin = null;
let medalPicks = [];

const vib = (p) => { try { navigator.vibrate && navigator.vibrate(p); } catch {} };
const act = (a, extra = {}) => conn && conn.send({ t: 'act', a, ...extra });
const vip = (a, extra = {}) => conn && conn.send({ t: 'vip', a, ...extra });

function toast(msg) {
  $$('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

// Keep the screen awake while playing (where supported).
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => (wakeLock = null)); } } catch {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') keepAwake(); });
document.addEventListener('pointerdown', keepAwake, { once: false, passive: true });

// tactile press feedback on every button
document.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) vib(12); }, { passive: true });

// ---------------------------------------------------------------- connection
function connect(code) {
  if (conn && conn.code === code) return conn.ensure();
  if (conn) conn.close();
  conn = new Conn(code, 'player', {
    open: () => {
      if (saved.pid && saved.code === code) conn.send({ t: 'hello', pid: saved.pid });
      else if (pendingJoin) conn.send(pendingJoin);
      setOffline(false);
    },
    msg: onMsg,
    status: (st) => {
      if (st === 'closed') setOffline(true);
      if (st === 'open') setOffline(false);
      if (st === 'replaced') showReplaced();
      if (st === 'gone') { forget(); showJoin('That room has ended. Ask for the new code!'); }
    },
  });
}

let offT = null;
function setOffline(on) {
  clearTimeout(offT);
  if (!on) return $$('.offline').forEach((e) => e.remove());
  offT = setTimeout(() => {
    if (!$('.offline')) document.body.insertAdjacentHTML('beforeend', '<div class="offline">RECONNECTING…</div>');
  }, 1200);
}

function forget() {
  delete saved.pid;
  save();
}

function onMsg(m) {
  if (m.t === 'welcome') {
    saved.pid = m.pid;
    saved.code = m.code;
    pendingJoin = null;
    save();
    vib([30, 40, 30]);
  } else if (m.t === 'unknown') {
    if (pendingJoin) { conn.send(pendingJoin); return; }
    forget();
    showJoin();
  } else if (m.t === 'state') {
    render(m.v);
  } else if (m.t === 'error') {
    if (m.code === 'NO_ROOM') { forget(); showJoin('Room not found. Check the code on the TV.'); }
    else toast(m.msg || 'Oops!');
    if (['NAME_TAKEN', 'FULL', 'NAME'].includes(m.code)) { pendingJoin = null; enableJoin(); }
  }
}

function showReplaced() {
  bar.classList.add('hidden');
  key = 'replaced';
  scr.innerHTML = `<div class="logo">COUCH CHAOS</div>
    <div class="box"><div class="prm">You opened the game in another tab or phone.</div></div>
    <button class="btn go" id="rc">USE THIS ONE</button>`;
  $('#rc').onclick = () => { conn.dead = false; conn.connect(); key = null; };
}

// ---------------------------------------------------------------- JOIN
let doodleDirty = false;
function showJoin(msg) {
  V = null;
  key = 'join';
  bar.classList.add('hidden');
  document.body.className = '';
  const params = new URLSearchParams(location.search);
  const code = (params.get('code') || saved.code || '').toUpperCase().slice(0, 4);
  scr.innerHTML = `
    <img class="join-emblem" src="/img/emblem-lobby.svg" alt="" />
    <div class="logo">COUCH CHAOS</div>
    <label class="f">ROOM CODE</label>
    <input class="t code" id="code" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" value="${esc(code)}" />
    <label class="f">YOUR NAME</label>
    <input class="t" id="name" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="NAME" value="${esc(saved.name || '')}" />
    <label class="f">DRAW YOURSELF! (3 SECONDS, NO PRESSURE)</label>
    <div class="doodle">
      <canvas id="cv" width="240" height="240"></canvas>
      <div class="swatches">
        <button data-c="#111111" class="on" style="background:#111"></button>
        <button data-c="#ff2d8a" style="background:#ff2d8a"></button>
        <button data-c="#1638ff" style="background:#1638ff"></button>
        <button data-c="#ffd23f" style="background:#ffd23f"></button>
        <button class="clear" id="clr">CLEAR</button>
      </div>
    </div>
    <button class="btn go" id="join">JOIN GAME</button>
    ${msg ? `<div class="note">${esc(msg)}</div>` : ''}
  `;
  const ci = $('#code');
  ci.addEventListener('input', () => { ci.value = ci.value.toUpperCase().replace(/[^A-Z]/g, ''); });
  setupDoodle();
  $('#join').onclick = doJoin;
  $('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });
}

function setupDoodle() {
  const cv = $('#cv');
  const ctx = cv.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#111111';
  doodleDirty = false;
  if (saved.avatar) {
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, 0, 0, 240, 240); doodleDirty = true; };
    img.src = saved.avatar;
  }
  let drawing = false, last = null;
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 240, y: ((e.clientY - r.top) / r.height) * 240 };
  };
  cv.addEventListener('pointerdown', (e) => {
    drawing = true;
    cv.setPointerCapture(e.pointerId);
    last = pos(e);
    ctx.beginPath();
    ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
    doodleDirty = true;
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  });
  const end = () => { drawing = false; };
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  for (const b of $$('.swatches [data-c]')) {
    b.onclick = () => {
      ctx.strokeStyle = b.dataset.c;
      $$('.swatches [data-c]').forEach((x) => x.classList.toggle('on', x === b));
    };
  }
  $('#clr').onclick = () => { ctx.clearRect(0, 0, 240, 240); doodleDirty = false; saved.avatar = null; };
}

function enableJoin() {
  const b = $('#join');
  if (b) { b.disabled = false; b.textContent = 'JOIN GAME'; }
}

async function doJoin() {
  const code = $('#code').value.trim().toUpperCase();
  const name = $('#name').value.trim().toUpperCase();
  if (code.length !== 4) return toast('Room code is 4 letters (on the TV).');
  if (!name) return toast('Type your name!');
  const b = $('#join');
  b.disabled = true;
  b.textContent = 'JOINING…';
  const info = await fetch('/api/room/' + code).then((r) => r.json()).catch(() => ({ exists: false, err: true }));
  if (!info.exists) {
    enableJoin();
    return toast(info.err ? 'No connection. Check your internet.' : 'No room with that code. Check the TV!');
  }
  let avatar = null;
  if (doodleDirty) avatar = $('#cv').toDataURL('image/png');
  saved.name = name;
  saved.avatar = avatar;
  if (saved.code !== code) delete saved.pid;
  saved.code = code;
  save();
  pendingJoin = { t: 'join', name, avatar };
  if (conn && conn.code === code && conn.ws && conn.ws.readyState === 1) conn.send(pendingJoin);
  else connect(code);
}

// ---------------------------------------------------------------- RENDER
function screenKey(v) {
  const pv = v.pv || {};
  const ph = v.phase;
  if (ph === 'lobby') return `lobby:${v.me.vip}`;
  if (ph === 'podium') return `pod:${v.phaseId}:${v.me.vip}`;
  if (!v.me.inGame) return 'next-game';
  if (ph === 'intro') return `intro:${v.phaseId}:${v.me.vip}`;
  if (ph === 'z-write' || ph === 'z-fwrite') {
    const nx = (pv.prompts || []).find((p) => !p.done);
    return `zw:${v.phaseId}:${nx ? nx.key : 'done'}`;
  }
  if (ph === 'z-vote') return `zv:${v.phaseId}:${pv.author ? 'auth' : pv.voted ? 'voted' : 'vote'}`;
  if (ph === 'z-fvote') return `zfv:${v.phaseId}:${pv.done}`;
  if (ph === 'h-guess') return `hg:${v.phaseId}:${pv.role}`;
  if (ph === 'h-bet') return `hb:${v.phaseId}:${pv.role}:${pv.bet || ''}`;
  if (ph === 'h-fguess') return `hf:${v.phaseId}:${pv.locked != null}`;
  if (ph === 'f-task') return `ft:${v.phaseId}:${pv.ready}`;
  if (ph === 'f-count' || ph === 'f-freeze') return `${ph}:${v.phaseId}`;
  if (ph === 'f-discuss') return `fd:${v.phaseId}:${v.me.vip}`;
  if (ph === 'f-vote') return `fv:${v.phaseId}:${pv.voted || ''}`;
  return `tv:${ph}:${v.phaseId}`;
}

function render(v) {
  V = v;
  const theme = v.phase === 'podium' ? 'podium' : v.game ? v.game.type : 'lobby';
  document.body.className = 'theme-' + theme;
  renderBar(v);
  const k = screenKey(v);
  if (k === key) return update(v);
  key = k;
  scr.innerHTML = '';
  const fn = SCREENS[v.phase] || eyes;
  if (!v.me.inGame && v.phase !== 'lobby' && v.phase !== 'podium') return nextGame(v);
  fn(v);
  window.scrollTo(0, 0);
}

function update(v) {
  const c = $('[data-count]');
  if (c) c.textContent = v.count;
}

function renderBar(v) {
  bar.classList.remove('hidden');
  bar.innerHTML = `<div class="me"><div class="dot" style="background:${v.me.color}"></div><span>${v.me.vip ? '👑 ' : ''}${esc(v.me.name)}</span></div>
    <div class="sp"></div><div class="clock hidden" id="clock"></div>
    ${v.me.vip && v.game ? '<button class="menu" id="vmenu">⋯</button>' : ''}`;
  const m = $('#vmenu');
  if (m) m.onclick = vipMenu;
  tickClock();
}

function vipMenu() {
  const d = document.createElement('div');
  d.className = 'vipmenu';
  const others = (V && V.players || []).filter((p) => p.id !== V.me.id);
  const kicks = others.length
    ? `<div class="kicker" style="margin-top:6px">KICK AFK / DUPLICATE PLAYER</div>` + others.map((p) => `<button class="btn white small" data-kick="${p.id}">🚫 Kick ${esc(p.name)}${p.connected || p.bot ? '' : ' (disconnected)'}</button>`).join('')
    : '';
  d.innerHTML = `<div class="box"><div class="kicker">👑 VIP CONTROLS</div>
    <button class="btn go small" id="vm-skip">⏭ SKIP CURRENT TIMER / ADVANCE</button>
    <button class="btn red small" id="vm-end">END GAME → BACK TO LOBBY</button>
    ${kicks}
    <button class="btn white small" id="vm-x">CLOSE</button></div>`;
  document.body.appendChild(d);
  $('#vm-x', d).onclick = () => d.remove();
  d.onclick = (e) => { if (e.target === d) d.remove(); };
  $('#vm-skip', d).onclick = () => { vip('skip-phase'); d.remove(); };
  $('#vm-end', d).onclick = () => { if (confirm('End this game for everyone?')) { vip('end'); d.remove(); } };
  for (const b of $$('[data-kick]', d)) b.onclick = () => { if (confirm(`Kick ${b.textContent.replace('🚫 Kick ', '')}?`)) { vip('kick', { id: b.dataset.kick }); d.remove(); } };
}

setInterval(tickClock, 250);
function tickClock() {
  const c = $('#clock');
  if (!c || !V) return;
  if (!V.deadline) return c.classList.add('hidden');
  const left = Math.max(0, V.deadline - conn.now());
  c.classList.remove('hidden');
  c.textContent = Math.ceil(left / 1000);
  c.classList.toggle('urgent', left < 10000);
  // flush the draft right before time runs out
  if (left < 1600 && left > 0 && draftEl && !draftFlushed) { draftFlushed = true; sendDraft(); }
}

const put = (html) => { scr.insertAdjacentHTML('beforeend', html); };

function reactions() {
  put(`<div class="reacts">
    <button data-e="😂">😂</button><button data-e="😱">😱</button>
    <button data-e="👏">👏</button><button data-e="🍅">🍅</button></div>`);
  for (const b of $$('.reacts button')) b.onclick = () => { conn.send({ t: 'react', e: b.dataset.e }); vib(20); };
}

function eyes(v, title = 'EYES ON THE TV!', sub = 'Smash a reaction:') {
  put(`<div class="eyes">👀</div><div class="h1">${title}</div><div class="note">${sub}</div>`);
  reactions();
}

function nextGame() {
  eyes(null, "YOU'RE IN!", "You'll join at the start of the next game. Cheer them on:");
}

// ---------------------------------------------------------------- text answer (Zinger)
let draftEl = null, draftKey = null, draftT = null, draftFlushed = false;
function sendDraft() {
  if (draftEl && draftKey != null) act('draft', { key: draftKey, text: draftEl.value });
}

function writeScreen(v) {
  const ps = v.pv.prompts || [];
  const nx = ps.find((p) => !p.done);
  draftEl = null;
  if (!nx) {
    put(`<div class="eyes">✅</div><div class="h1">ANSWERS LOCKED!</div><div class="note">Waiting on the slowpokes… heckle them:</div>`);
    return reactions();
  }
  const idx = ps.indexOf(nx);
  put(`<div class="box tilt"><div class="kicker">${ps.length > 1 ? `PROMPT ${idx + 1} OF ${ps.length}` : 'FINAL PROMPT'}</div><div class="prm">${esc(nx.text)}</div></div>
    <textarea class="t" id="ans" maxlength="80" placeholder="Type something funny…" autocomplete="off" autocapitalize="sentences"></textarea>
    <div class="count" id="cnt">0/80</div>
    <button class="btn go" id="send">SUBMIT</button>
    <button class="btn red small" id="panic">😱 PANIC BUTTON <span class="sub">Silly auto-answer, half points</span></button>`);
  const ta = $('#ans');
  draftEl = ta;
  draftKey = nx.key;
  draftFlushed = false;
  const draftKeyLS = `cc-draft:${v.phaseId}:${nx.key}`;
  try { ta.value = sessionStorage.getItem(draftKeyLS) || ''; } catch {}
  $('#cnt').textContent = ta.value.length + '/80';
  ta.addEventListener('input', () => {
    $('#cnt').textContent = ta.value.length + '/80';
    try { sessionStorage.setItem(draftKeyLS, ta.value); } catch {}
    clearTimeout(draftT);
    draftT = setTimeout(sendDraft, 600);
  });
  $('#send').onclick = () => {
    const text = ta.value.trim();
    if (!text) return toast('Type something — or hit PANIC!');
    act('answer', { key: nx.key, text });
    vib([20, 30, 60]);
    $('#send').disabled = true;
  };
  $('#panic').onclick = () => {
    act('answer', { key: nx.key, panic: true });
    vib([60, 40, 60]);
    $('#panic').disabled = true;
  };
}

// ---------------------------------------------------------------- slider (Hunch)
function sliderScreen({ title, q, onLock, live }) {
  put(`<div class="box tilt"><div class="kicker">${title}</div><div class="prm">${esc(q)}</div></div>
    <div class="bignum" id="num">50%</div>
    <input type="range" class="slider" id="sl" min="0" max="100" value="50" />
    <div class="ticks"><span>0%</span><span>50%</span><span>100%</span></div>
    <div class="nudge"><button class="btn white" id="m1">−1</button><button class="btn white" id="p1">+1</button></div>
    <button class="btn go" id="lock">LOCK IN</button>`);
  const sl = $('#sl');
  let lastSent = 0, lastV = -1;
  const show = () => {
    $('#num').textContent = sl.value + '%';
    const n = +sl.value;
    if (n !== lastV) { lastV = n; if (n % 5 === 0) vib(6); }
    const now = Date.now();
    if (live && now - lastSent > 70) { lastSent = now; act('slide', { v: n }); }
  };
  sl.addEventListener('input', show);
  sl.addEventListener('change', () => live && act('slide', { v: +sl.value }));
  $('#m1').onclick = () => { sl.value = Math.max(0, +sl.value - 1); show(); live && act('slide', { v: +sl.value }); };
  $('#p1').onclick = () => { sl.value = Math.min(100, +sl.value + 1); show(); live && act('slide', { v: +sl.value }); };
  $('#lock').onclick = () => { onLock(+sl.value); vib([30, 40, 80]); $('#lock').disabled = true; };
}

// ---------------------------------------------------------------- SCREENS
const SCREENS = {
  lobby(v) {
    const addEdit = () => {
      put(`<button class="btn white small" id="editme">✏️ EDIT NAME / REDRAW DOODLE</button>`);
      $('#editme').onclick = () => { if (conn) conn.close(); conn = null; forget(); showJoin(); };
    };
    if (!v.me.vip) {
      put(`<div class="logo">YOU'RE IN!</div>
        <div class="box tilt" style="text-align:center"><div class="prm">Look for yourself on the TV.</div>
        <div class="note" style="color:var(--ink);text-shadow:none;margin-top:6px">👑 ${esc(v.vipName)} picks the game.</div></div>`);
      reactions();
      return addEdit();
    }
    put(`<div class="h1">👑 YOU'RE THE VIP</div><div class="note">Pick a game when everyone's in (<b data-count>${v.count}</b> players)</div>`);
    for (const g of v.games) {
      put(`<button class="btn game ${g.id}" data-g="${g.id}"><img class="g-emblem" src="/img/emblem-${g.id}.svg" alt="" /><span class="g-copy"><span class="t">${esc(g.title)}</span><span class="sub">${esc(g.tagline)} · ${g.min}+ players</span></span></button>`);
    }
    put(`<div class="toggle ${v.settings.kid ? 'on' : ''}" id="kid"><span>🧒 KID MODE<br><small style="font-family:var(--body)">50% longer timers</small></span><div class="sw"></div></div>
      <label class="f" style="margin-top:4px">🏆 WINNER'S PRIZE (OPTIONAL)</label>
      <input class="t" id="prize" maxlength="60" placeholder="e.g. Last slice of pie!" value="${esc(v.settings.prize || '')}" />`);
    for (const b of $$('[data-g]')) b.onclick = () => { vip('start', { game: b.dataset.g }); vib([30, 30, 90]); };
    $('#kid').onclick = () => vip('kid', { on: !V.settings.kid });
    let pt = null;
    $('#prize').addEventListener('input', (e) => { clearTimeout(pt); pt = setTimeout(() => vip('prize', { text: e.target.value }), 400); });
    addEdit();
  },

  intro(v) {
    eyes(v, 'EYES ON THE TV!', 'The host is explaining the rules.');
    if (v.me.vip) {
      put('<button class="btn white" id="skip">⏭ SKIP INTRO</button>');
      $('#skip').onclick = () => vip('skip');
    }
  },

  podium(v) {
    const p = v.podium || {};
    const medal = ['🥇', '🥈', '🥉'][p.rank - 1] || '🎉';
    put(`<div class="eyes">${medal}</div><div class="h1">YOU PLACED #${p.rank || '?'}${p.of ? ` OF ${p.of}` : ''}</div>`);
    if (p.awards && p.awards.length) put(`<div class="box" style="text-align:center"><div class="kicker">YOU WON</div><div class="prm">${p.awards.map(esc).join('<br>')}</div></div>`);
    if (v.me.vip) {
      put(`<button class="btn go" id="again">🔁 PLAY AGAIN</button>
        <button class="btn pink" id="switch">🎮 SWITCH GAME<span class="sub">Keeps everyone joined</span></button>`);
      $('#again').onclick = () => vip('again');
      $('#switch').onclick = () => vip('switch');
    } else {
      put(`<div class="note">👑 ${esc(v.vipName)} picks what's next.</div>`);
      reactions();
    }
  },

  // ---- Zinger
  'z-write': writeScreen,
  'z-fwrite': writeScreen,
  'z-vote'(v) {
    const pv = v.pv;
    if (pv.author) return eyes(v, "THAT'S YOUR PROMPT! 🤞", 'Watch the TV and look innocent.');
    if (pv.voted) return eyes(v, 'VOTE LOCKED 🔒', 'Smash a reaction:');
    put(`<div class="box tilt"><div class="kicker">WHICH IS FUNNIER?</div><div class="prm">${esc(pv.prompt)}</div></div>
      <button class="btn pink choice" data-s="a">${esc(pv.A)}</button>
      <button class="btn blue choice" data-s="b">${esc(pv.B)}</button>`);
    for (const b of $$('[data-s]')) b.onclick = () => { act('vote', { side: b.dataset.s }); vib([20, 30, 70]); $$('[data-s]').forEach((x) => (x.disabled = true)); };
  },
  'z-fvote'(v) {
    const pv = v.pv;
    if (pv.done) return eyes(v, 'MEDALS AWARDED 🏅', 'Smash a reaction:');
    medalPicks = [];
    const MED = ['🥇', '🥈', '🥉'];
    put(`<div class="box tilt"><div class="kicker">HAND OUT ${pv.need} MEDAL${pv.need > 1 ? 'S' : ''}</div><div class="prm">${esc(pv.prompt)}</div></div>
      <div class="note" id="mhint">Tap your favorite for 🥇</div><div id="mlist" style="display:flex;flex-direction:column;gap:12px"></div>
      <button class="btn go" id="mlock" disabled>LOCK IN MEDALS</button>`);
    const list = $('#mlist');
    for (const a of pv.answers) {
      list.insertAdjacentHTML('beforeend', `<button class="btn white choice" data-i="${a.i}"><span class="medal"></span>${esc(a.text)}</button>`);
    }
    const paint = () => {
      for (const b of $$('[data-i]', list)) {
        const r = medalPicks.indexOf(+b.dataset.i);
        b.classList.toggle('picked', r >= 0);
        $('.medal', b).textContent = r >= 0 ? MED[r] : '';
      }
      const n = medalPicks.length;
      $('#mhint').textContent = n < pv.need ? `Tap your pick for ${MED[n]}` : 'Looks good? Lock it in!';
      $('#mlock').disabled = n < pv.need;
    };
    for (const b of $$('[data-i]', list)) b.onclick = () => {
      const i = +b.dataset.i;
      const r = medalPicks.indexOf(i);
      if (r >= 0) medalPicks.splice(r, 1);
      else if (medalPicks.length < pv.need) medalPicks.push(i);
      vib(15);
      paint();
    };
    $('#mlock').onclick = () => { act('medals', { picks: medalPicks }); vib([30, 30, 90]); $('#mlock').disabled = true; };
  },

  // ---- Hunch
  'h-guess'(v) {
    const pv = v.pv;
    if (pv.role !== 'guesser') return eyes(v, `${esc(pv.guesser)} IS GUESSING!`, 'Shout advice at them! Or just react:');
    sliderScreen({ title: "YOU'RE THE GUESSER!", q: pv.q, live: true, onLock: (n) => act('lock', { v: n }) });
    act('slide', { v: 50 });
  },
  'h-bet'(v) {
    const pv = v.pv;
    if (pv.role === 'guesser') return eyes(v, 'THEY\'RE BETTING ON YOU', 'Watch the TV…');
    const LBL = { 'much-lower': 'MUCH LOWER', lower: 'LOWER', higher: 'HIGHER', 'much-higher': 'MUCH HIGHER' };
    if (pv.bet) return eyes(v, `BET: ${LBL[pv.bet]} 🔒`, 'Smash a reaction:');
    put(`<div class="box tilt"><div class="kicker">${esc(pv.guesser)} GUESSED</div><div class="bignum" style="color:var(--yellow)">${pv.guess}%</div><div class="prm" style="font-size:17px">${esc(pv.q)}</div></div>
      <div class="note">The real answer is…</div>
      <div class="betgrid">
        <button class="btn much" data-b="much-higher">⏫ MUCH HIGHER<span class="sub">Double or nothing: off by 15+</span></button>
        <button class="btn go" data-b="higher">⬆️ HIGHER</button>
        <button class="btn pink" data-b="lower">⬇️ LOWER</button>
        <button class="btn much" data-b="much-lower">⏬ MUCH LOWER<span class="sub">Double or nothing: off by 15+</span></button>
      </div>`);
    for (const b of $$('[data-b]')) b.onclick = () => { act('bet', { bet: b.dataset.b }); vib([20, 30, 70]); $$('[data-b]').forEach((x) => (x.disabled = true)); };
  },
  'h-fguess'(v) {
    const pv = v.pv;
    if (pv.locked != null) return eyes(v, `LOCKED AT ${pv.locked}% 🔒`, 'Smash a reaction:');
    sliderScreen({ title: 'FINAL ROUND: EVERYONE GUESSES', q: pv.q, live: false, onLock: (n) => act('lock', { v: n }) });
  },

  // ---- Faker
  'f-task'(v) {
    const pv = v.pv;
    secretCard(pv);
    if (!pv.ready) {
      put('<button class="btn go" id="ready">GOT IT 👍</button>');
      $('#ready').onclick = () => { act('ready'); vib(40); $('#ready').disabled = true; };
    } else put('<div class="note">Ready! Watch the TV for the countdown…</div>');
  },
  'f-count'(v) {
    put(`<div class="eyes">⏱️</div><div class="h1">GET READY…</div><div class="note">Do it when the TV says <b>DO IT NOW!</b></div>`);
    secretCard(v.pv);
  },
  'f-freeze'(v) {
    vib([120, 60, 120]);
    put(`<div class="eyes">🧊</div><div class="h1" style="font-size:54px">FREEZE!</div><div class="note">Hold your pose. Don't change a thing!</div>`);
  },
  'f-discuss'(v) {
    put(`<div class="eyes">🕵️</div><div class="h1">WHO'S FAKING?</div><div class="note">Accuse each other out loud!</div>`);
    if (v.me.vip) {
      put('<button class="btn go" id="sv">🗳️ START VOTE</button>');
      $('#sv').onclick = () => { act('start-vote'); vib([30, 30, 90]); };
    }
    reactions();
  },
  'f-vote'(v) {
    const pv = v.pv;
    if (pv.voted) {
      const who = (pv.options || []).find((o) => o.id === pv.voted);
      return eyes(v, `YOU ACCUSED ${esc(who ? who.name : '???')}`, 'Smash a reaction:');
    }
    put(`<div class="h1">WHO'S THE FAKER?</div>${pv.isFaker ? '<div class="note">(Psst — you are. Vote for someone else!)</div>' : ''}`);
    for (const o of pv.options) put(`<button class="btn white player-btn" data-t="${o.id}"><span class="dot" style="background:${o.color}"></span>${esc(o.name)}</button>`);
    for (const b of $$('[data-t]')) b.onclick = () => { act('vote', { target: b.dataset.t }); vib([20, 30, 70]); $$('[data-t]').forEach((x) => (x.disabled = true)); };
  },
};

function secretCard(pv) {
  const icon = pv.cat ? `<img class="cat-icon" src="/img/faker-${esc(pv.cat)}.svg" alt="" />` : '';
  if (pv.isFaker) {
    put(`<div class="box secret faker">${icon}<div class="cat">${esc(pv.label)}</div>
      <div class="big">🤫 YOU'RE THE FAKER!</div>
      <div class="prm">You don't know the task. Watch everyone and blend in!</div>
      <div style="margin-top:8px;font-size:15px">${esc(pv.how)}</div></div>`);
  } else {
    put(`<div class="box secret">${icon}<div class="cat">${esc(pv.label)}</div>
      <div class="kicker" style="margin-top:10px">YOUR SECRET TASK</div>
      <div class="task">${esc(pv.task)}</div>
      <div style="font-size:15px">Don't do it yet! Wait for <b>DO IT NOW</b> on the TV.</div></div>`);
  }
}

// ---------------------------------------------------------------- boot
const urlCode = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
if (saved.pid && saved.code && (!urlCode || urlCode === saved.code)) {
  scr.innerHTML = '<div class="logo">COUCH CHAOS</div><div class="spin"></div><div class="note">Getting your seat back…</div>';
  connect(saved.code);
} else {
  if (urlCode && urlCode !== saved.code) delete saved.pid;
  showJoin();
}

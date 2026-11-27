import { Conn, esc } from './net.js';
import { audio, say, wait, hushVoice } from './audio.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const screen = $('#screen');
const strip = $('#strip');
const LS = 'cc-host';

let conn = null;
let V = null; // latest host view
let avatars = {};
let choreo = 0; // bumps on every phase change; stale choreography stops itself
let curScene = null;
let lobbySeen = new Set();

// ---------------------------------------------------------------- boot
async function boot() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS)); } catch {}
  const forceNew = new URLSearchParams(location.search).has('new');
  if (forceNew) history.replaceState(null, '', '/host');
  if (saved && !forceNew) {
    const r = await fetch('/api/room/' + saved.code).then((r) => r.json()).catch(() => ({}));
    if (r.exists) return start(saved);
  }
  const r = await fetch('/api/new', { method: 'POST' }).then((r) => r.json());
  const s = { code: r.code, hostKey: r.hostKey };
  localStorage.setItem(LS, JSON.stringify(s));
  start(s);
}

function start(s) {
  conn = new Conn(s.code, 'host', {
    open: () => conn.send({ t: 'host-hello', hostKey: s.hostKey }),
    msg: onMsg,
    status: (st) => {
      $('#conn').classList.toggle('hidden', st === 'open' || st === 'connecting');
      if (st === 'gone') { localStorage.removeItem(LS); location.href = '/host?new'; }
    },
  });
}

function onMsg(m) {
  if (m.t === 'state') render(m.v);
  else if (m.t === 'avatars') { avatars = m.map || {}; refreshAvatars(); }
  else if (m.t === 'avatar') { if (m.data) avatars[m.id] = m.data; else delete avatars[m.id]; refreshAvatars(m.id); }
  else if (m.t === 'react') floatEmoji(m.e);
  else if (m.t === 'slide') setNeedle(m.v);
  else if (m.t === 'error' && m.code === 'BAD_HOST') { localStorage.removeItem(LS); location.href = '/host?new'; }
}

// ---------------------------------------------------------------- helpers
const P = (id) => (V && V.players.find((p) => p.id === id)) || { id, name: '???', color: '#ccc' };
const inGame = () => V.players.filter((p) => p.inGame);
const avInner = (p) =>
  avatars[p.id] ? `<img src="${avatars[p.id]}" alt="">` : p.bot ? '<img src="/img/bot-avatar.svg" alt="Bot">' : `<span class="ini">${esc((p.name || '?')[0])}</span>`;
const av = (p, cls = '') => `<div class="av ${cls}" style="--c:${p.color}" data-av="${p.id}">${avInner(p)}</div>`;
function refreshAvatars(id) {
  for (const el of $$(id ? `[data-av="${id}"]` : '[data-av]')) el.innerHTML = avInner(P(el.dataset.av));
}
const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const add = (html, parent = screen) => { const el = h(html); parent.appendChild(el); return el; };
const tilt = () => (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random() * 1.5);
const live = (tk) => tk === choreo;
const done = (v) => conn.send({ t: 'host-done', phaseId: v.phaseId });
const spell = (n) => String(n);
const QUIPS = {
  zing: [
    (n) => `Zing! ${n} takes every single vote. Total annihilation!`,
    (n) => `Zing! Unanimous! ${n} just owned the whole room!`,
    (n) => `Zing! Clean sweep by ${n}. Not even close!`,
    (n) => `Zing! ${n} crushed it with a hundred percent of the votes!`,
  ],
  win: [
    (n) => `${n} takes the win!`,
    (n) => `Point goes to ${n}! Nice one.`,
    (n) => `${n} wins that matchup!`,
    (n) => `The crowd has spoken: ${n} wins!`,
  ],
  tie: [
    () => "It's a tie! Everybody wins! Or nobody wins. Mostly nobody.",
    () => "Dead heat! You're splitting the points on this one.",
    () => "A tie! The couch could not decide.",
  ],
  bull: [
    (a) => `It's ${a} percent! Bullseye! Are you secretly a supercomputer?`,
    (a) => `It's ${a} percent! Spot on! That's a bullseye!`,
    (a) => `It's ${a} percent! Nailed it! Massive bullseye bonus!`,
  ],
  close: [
    (a) => `It's ${a} percent! Ooh, super close!`,
    (a) => `It's ${a} percent! Solid hunch!`,
  ],
  whiff: [
    (a) => `It's ${a} percent! Yikes, not even in the same zip code.`,
    (a) => `It's ${a} percent! Bold guess. Wildly wrong, but bold!`,
    (a) => `It's ${a} percent! Ouch, that's gonna leave a mark.`,
  ],
  caught: [
    (n) => `${n} was the faker! Caught red-handed!`,
    (n) => `Busted! ${n} was faking the whole time!`,
    (n) => `Case closed! ${n} couldn't fool this room!`,
  ],
  escaped: [
    (n) => `${n} was the faker and got away with it! Oscar-worthy performance!`,
    (n) => `Unbelievable! ${n} fooled all of you and escaped!`,
  ],
};
const quip = (k, ...args) => { const a = QUIPS[k]; return a[Math.floor(Math.random() * a.length)](...args); };

function shake() {
  const app = $('#app');
  app.classList.remove('shake');
  void app.offsetWidth;
  app.classList.add('shake');
}

function confetti(n = 140) {
  const fx = $('#fx');
  const colors = ['#ffd23f', '#ff2d8a', '#1638ff', '#2bd96b', '#ff8c2e', '#2ec4ff', '#fff'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.setProperty('--dx', (Math.random() - 0.5) * 40 + 'vw');
    c.style.setProperty('--rot', (Math.random() * 1440 - 720) + 'deg');
    c.style.setProperty('--d', 2.4 + Math.random() * 2.2 + 's');
    c.style.animationDelay = Math.random() * 0.6 + 's';
    if (Math.random() < 0.4) c.style.borderRadius = '50%';
    fx.appendChild(c);
    setTimeout(() => c.remove(), 6000);
  }
}

function floatEmoji(e) {
  const el = document.createElement('div');
  el.className = 'emoji';
  el.textContent = e;
  el.style.left = 6 + Math.random() * 86 + 'vw';
  el.style.setProperty('--dx', (Math.random() - 0.5) * 18 + 'vw');
  $('#fx').appendChild(el);
  setTimeout(() => el.remove(), 3400);
  if (audio.ok() && Math.random() < 0.5) audio.tick(Math.random() < 0.5);
}

function stamp(text, cls = '', parent = screen) {
  const s = add(`<div class="stampx ${cls}">${esc(text)}</div>`, parent);
  audio.stamp();
  return s;
}

function banner(text, cls = '') {
  $$('.livebanner').forEach((b) => b.remove());
  const b = add(`<div class="banner livebanner slam ${cls}" style="--r:-2deg;margin-top:3vh">${text}</div>`);
  return b;
}

// ---------------------------------------------------------------- render loop
function render(v) {
  const changed = !V || v.phaseId !== V.phaseId;
  const prevScene = curScene;
  V = v;
  setTheme(v);
  setTimer(v);
  setJoinBug(v);
  if (changed) {
    choreo++;
    hushVoice();
    audio.hush(false);
    audio.setUrgent(false);
    const R = SCENES[v.phase] || SCENES.unknown;
    const cont = R.scene && R.scene === prevScene && !R.restart;
    curScene = R.scene || v.phase;
    if (cont) R.enter(v, choreo, true);
    else {
      const tk = choreo;
      wipeTo(() => {
        if (tk !== choreo) return;
        screen.innerHTML = '';
        R.enter(V, tk, false);
        renderStrip(V);
      });
    }
  } else {
    const R = SCENES[v.phase];
    R && R.update && R.update(v);
  }
  renderStrip(v);
}

function wipeTo(fn) {
  const w = $('#wipe');
  w.classList.remove('go');
  void w.offsetWidth;
  w.classList.add('go');
  audio.whoosh(0.5);
  setTimeout(fn, 420);
}

function setTheme(v) {
  let t = 'lobby';
  if (v.phase === 'podium') t = 'podium';
  else if (v.game) t = v.game.type;
  document.body.className = 'theme-' + t;
  audio.setTheme(t === 'podium' ? 'lobby' : t);
  const title = v.game ? v.game.title : v.phase === 'podium' && v.podium ? v.podium.title : null;
  $('#logo').innerHTML = title ? `${esc(title)}<small>COUCH CHAOS</small>` : 'COUCH CHAOS';
}

function setJoinBug(v) {
  const jb = $('#joinbug');
  const show = v.phase !== 'lobby';
  jb.classList.toggle('hidden', !show);
  if (show) jb.innerHTML = `JOIN: <b>${esc(location.host)}</b> &nbsp;CODE <b>${esc(v.code)}</b>`;
}

// ---------------------------------------------------------------- timer
let deadline = null;
let lastSec = null;
function setTimer(v) {
  deadline = v.deadline;
  $('#timer').classList.toggle('hidden', !deadline);
}
setInterval(() => {
  const vig = $('#urgent-vignette');
  if (!deadline || !conn) { audio.setUrgent(false); vig && vig.classList.remove('on'); return; }
  const total = Math.max(1, (deadline - (V.phaseStart || deadline - 60000)));
  const left = Math.max(0, deadline - conn.now());
  const sec = Math.ceil(left / 1000);
  $('#timer-n').textContent = sec;
  $('#timer .fgc').setAttribute('stroke-dashoffset', String(100 - (left / total) * 100));
  const urgent = left > 0 && left <= 10000;
  $('#timer').classList.toggle('urgent', urgent);
  vig && vig.classList.toggle('on', left > 0 && left <= 5000);
  audio.setUrgent(urgent);
  if (sec !== lastSec && sec <= 5 && sec > 0) {
    audio.tick(sec <= 3);
    if (sec === 5 && total >= 15000) say('Five seconds!', { rate: 1.15 });
  }
  lastSec = sec;
}, 200);

// ---------------------------------------------------------------- strip
function renderStrip(v) {
  const gv = v.gv || {};
  let marks = null, who = null;
  const ph = v.phase;
  if (ph === 'z-write' || ph === 'z-fwrite' || ph === 'h-fguess') marks = gv.done;
  if (ph === 'z-vote' || ph === 'z-fvote' || ph === 'f-vote') { marks = gv.voted; who = gv.voters; }
  if (ph === 'h-bet') { marks = gv.betted; who = gv.bettors; }
  if (ph === 'f-task') marks = gv.ready;
  if (!marks) { strip.innerHTML = ''; return; }
  const list = (who ? who.map(P) : inGame());
  const want = list.map((p) => p.id).join(',');
  if (strip.dataset.who !== want) {
    strip.dataset.who = want;
    strip.innerHTML = list.map((p) => `<div class="chip" data-id="${p.id}">${av(p)}<div class="nm">${esc(p.name)}</div></div>`).join('');
  }
  for (const el of $$('.chip', strip)) {
    const p = P(el.dataset.id);
    const isDone = marks.includes(el.dataset.id);
    if (isDone && !el.classList.contains('done')) audio.thwump();
    el.classList.toggle('done', isDone);
    el.classList.toggle('wait', !isDone);
    el.classList.toggle('off', !p.connected && !p.bot);
  }
}

// ---------------------------------------------------------------- scoreboard
function scoreboard(v, title = 'SCORES', sub = '') {
  add(`<div class="mega m slam">${esc(title)}</div>`);
  if (sub) add(`<div class="sub">${esc(sub)}</div>`);
  const rows = [...inGame()].sort((a, b) => b.score - a.score);
  const max = Math.max(1, ...rows.map((r) => r.score));
  const board = add('<div class="board"></div>');
  rows.forEach((p, i) => {
    const row = add(`<div class="brow from-l" style="animation-delay:${0.08 * i}s">
      <div class="rk">${i + 1}</div>${av(p)}
      <div class="bar" style="--c:${p.color}"><b>${esc(p.name)}</b><span data-count="${p.score}">0</span></div></div>`, board);
    setTimeout(() => {
      $('.bar', row).style.width = `calc(24vw + ${(p.score / max) * 32}vw)`;
      countUp($('[data-count]', row), p.score, 1300);
    }, 450 + 90 * i);
  });
  return rows;
}
function countUp(el, to, ms) {
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))).toLocaleString();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- dial (Hunch)
const DIAL_LEN = Math.PI * 240;
function dialSVG() {
  let ticks = '';
  for (let i = 0; i <= 100; i += 5) {
    const a = Math.PI * (1 - i / 100);
    const r1 = 282, r2 = i % 10 ? 270 : 258;
    const x1 = 300 + r1 * Math.cos(a), y1 = 300 - r1 * Math.sin(a);
    const x2 = 300 + r2 * Math.cos(a), y2 = 300 - r2 * Math.sin(a);
    ticks += `<line class="tickl" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
    if (i % 20 === 0) {
      const xt = 300 + 228 * Math.cos(a), yt = 300 - 228 * Math.sin(a) + 8;
      ticks += `<text class="tickt" x="${xt}" y="${yt}">${i}</text>`;
    }
  }
  return `<svg class="dial" viewBox="-10 -10 620 340">
    <path class="face" d="M 4 300 A 296 296 0 0 1 596 300 Z" />
    <path class="arcbg" d="M 60 300 A 240 240 0 0 1 540 300" />
    <path class="arcfill" d="M 60 300 A 240 240 0 0 1 540 300" stroke-dasharray="${DIAL_LEN}" stroke-dashoffset="${DIAL_LEN}" />
    ${ticks}
    <g class="markers"></g>
    <g class="needle" style="transform: rotate(0deg)">
      <polygon points="292,300 300,62 308,300" fill="#111" />
      <polygon points="296,296 300,80 304,296" fill="#ff2d8a" />
    </g>
    <circle cx="300" cy="300" r="26" fill="#111" /><circle cx="300" cy="300" r="12" fill="#ffd23f" />
  </svg>`;
}
function buildDial(parent = screen) {
  const wrap = add(`<div class="dialwrap pop">${dialSVG()}<div class="dialnum">50%</div></div>`, parent);
  return wrap;
}
function setNeedle(v, slow = false) {
  const n = $('.dial .needle');
  if (!n) return;
  n.classList.toggle('slow', slow);
  n.style.transform = `rotate(${-90 + v * 1.8}deg)`;
  const num = $('.dialnum');
  if (num && !num.classList.contains('real')) num.textContent = Math.round(v) + '%';
}
function setFill(v) {
  const f = $('.dial .arcfill');
  if (f) f.setAttribute('stroke-dashoffset', String(DIAL_LEN * (1 - v / 100)));
}
function addMarker(v, color, label) {
  const g = $('.dial .markers');
  if (!g) return;
  const a = Math.PI * (1 - v / 100);
  const x = 300 + 300 * Math.cos(a), y = 300 - 300 * Math.sin(a);
  const deg = -90 + v * 1.8;
  g.insertAdjacentHTML('beforeend', `<g transform="translate(${x} ${y}) rotate(${deg})">
     <polygon points="-14,-34 14,-34 0,-4" fill="${color}" stroke="#111" stroke-width="4" />
     <text y="-44" text-anchor="middle" font-family="Archivo Black" font-size="20" fill="#fff" stroke="#111" stroke-width="5" paint-order="stroke">${esc(label)}</text></g>`);
}
function creep(to, ms, onFrame) {
  return new Promise((res) => {
    const t0 = performance.now();
    const from = onFrame.from || 0;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      onFrame(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
      else res();
    };
    requestAnimationFrame(step);
  });
}

// ---------------------------------------------------------------- scenes
const ZROUND = {
  1: ['ROUND 1', 'Answer 2 prompts. Funniest answer wins!', 'Round one! Answer your prompts. The funniest answer wins.'],
  2: ['ROUND 2', 'DOUBLE POINTS!', 'Round two! Everything is worth double points.'],
  3: ['FINAL ZING', 'Everyone answers the same prompt!', 'The final round! Everyone answers the same prompt.'],
};
const BET_LABEL = { 'much-lower': 'MUCH LOWER', lower: 'LOWER', higher: 'HIGHER', 'much-higher': 'MUCH HIGHER' };

function matchScene(v, cont) {
  if (cont && $('.matchbox')) return $('.matchbox');
  screen.innerHTML = '';
  const box = add('<div class="matchbox" style="display:flex;flex-direction:column;align-items:center;width:100%"></div>');
  add(`<div class="card prompt tilt-l">${esc(v.gv.prompt)}</div>`, box);
  add(`<div class="answers">
      <div class="card ans a"><div class="txt">${esc(v.gv.A)}</div></div>
      <div class="vs">VS</div>
      <div class="card ans b"><div class="txt">${esc(v.gv.B)}</div></div></div>`, box);
  return box;
}

const SCENES = {
  unknown: { enter() {} },

  // ---------------- LOBBY ----------------
  lobby: {
    enter(v) {
      lobbySeen = new Set();
      const url = location.host;
      const joinUrl = `${location.origin}/?code=${v.code}`;
      add(`<div class="lobby">
        <div class="card joincard drop">
          <img class="lobby-emblem pop" src="/img/emblem-lobby.svg" alt="" />
          <div class="small">Grab your phone and go to</div>
          <div class="url">${esc(url)}</div>
          <div class="small">Room code</div>
          <div class="code">${esc(v.code)}</div>
          <img class="qr" alt="QR code" />
          <div class="qrlabel">…or scan to join</div>
        </div>
        <div class="lobby-right">
          <div class="stage"></div>
          <div class="card lobby-msg"></div>
        </div></div>`);
      try {
        const qr = window.qrcode(0, 'M');
        qr.addData(joinUrl);
        qr.make();
        $('.qr').src = qr.createDataURL(8, 2);
      } catch {
        $('.qr').remove();
        $('.qrlabel').remove();
      }
      add(`<div class="hostbtns"><button id="newroom">New Room</button></div>`);
      $('#newroom').onclick = () => { if (confirm('Start a brand-new room? Everyone will need the new code.')) { localStorage.removeItem(LS); location.href = '/host?new'; } };
      this.update(v, true);
    },
    update(v, first) {
      const stage = $('.stage');
      if (!stage) return;
      const ids = v.players.map((p) => p.id);
      for (const el of $$('.ptile[data-id]', stage)) if (!ids.includes(el.dataset.id)) el.remove();
      $$('.ptile.slot', stage).forEach((e) => e.remove());
      v.players.forEach((p, i) => {
        let el = $(`.ptile[data-id="${p.id}"]`, stage);
        if (!el) {
          const r = tilt();
          el = add(`<div class="ptile pop" data-id="${p.id}" style="--r:${r}deg">
            <div class="breath" style="--r:${r}deg;animation-delay:${-Math.random() * 3}s">${av(p)}</div>
            <div class="tag">${esc(p.name)}</div></div>`, stage);
          if (!first && !lobbySeen.has(p.id)) audio.pop(i);
          lobbySeen.add(p.id);
        }
        const tag = $('.tag', el); if (tag && tag.textContent !== p.name) tag.textContent = p.name;
        el.style.opacity = p.connected || p.bot ? 1 : 0.45;
        const isVip = v.vip === p.id;
        const crown = $('.crown', el);
        if (isVip && !crown) el.insertAdjacentHTML('beforeend', '<div class="crown">👑</div>');
        if (!isVip && crown) crown.remove();
      });
      if (v.players.length < 10) add(`<div class="ptile slot"><div class="av">?</div><div class="tag" style="opacity:.6">JOIN!</div></div>`, stage);
      const msg = $('.lobby-msg');
      const humans = v.players.filter((p) => !p.bot);
      const vip = v.players.find((p) => p.id === v.vip);
      if (!humans.length) msg.innerHTML = `Waiting for players… <b>Join on your phone!</b>`;
      else msg.innerHTML = `👑 <b>${esc(vip ? vip.name : 'VIP')}</b> is the VIP. Pick a game on your phone!${v.settings.prize ? ` <br>🏆 Playing for: <b>${esc(v.settings.prize)}</b>` : ''}${v.settings.kid ? ' <br>🧒 Kid Mode: longer timers' : ''}`;
    },
  },

  // ---------------- INTRO ----------------
  intro: {
    async enter(v, tk) {
      const g = v.game;
      add(`<div class="intro-head"><img class="intro-emblem pop" src="/img/emblem-${esc(g.type)}.svg" alt="" /><div class="mega xl slam" style="--r:-3deg">${esc(g.title)}</div></div>`);
      const rules = add('<div class="intro-rules"></div>');
      audio.slam();
      await say(`Welcome to ${g.title}!`);
      for (let i = 0; i < g.rules.length; i++) {
        if (!live(tk)) return;
        add(`<div class="card rule from-${i % 2 ? 'r' : 'l'}"><div class="n">${i + 1}</div><div>${esc(g.rules[i])}</div></div>`, rules);
        audio.whoosh(0.3);
        await say(g.rules[i]);
        await wait(250);
      }
      if (!live(tk)) return;
      await wait(900);
      if (live(tk)) done(v);
    },
  },

  // ---------------- ZINGER ----------------
  'z-title': {
    async enter(v, tk) {
      const [t, s, line] = ZROUND[v.pd.round] || ZROUND[1];
      add(`<div class="mega xl slam yellow" style="--r:-4deg">${t}</div>`);
      add(`<div class="sub pop" style="animation-delay:.4s">${esc(s)}</div>`);
      audio.slam();
      if (v.pd.round === 2) setTimeout(() => { shake(); audio.zing(); }, 500);
      await say(line);
      await wait(700);
      if (live(tk)) done(v);
    },
  },
  'z-write': {
    enter(v) {
      add(`<div class="phonehint">📱</div>`);
      add(`<div class="mega l slam">LOOK AT<br>YOUR PHONES!</div>`);
      add(`<div class="sub">Answer your prompts. Be funny. Be fast.</div>`);
      say('Look at your phones and answer your prompts!');
    },
  },
  'z-match': {
    scene: 'match',
    restart: true,
    async enter(v, tk) {
      const box = matchScene(v, false);
      const [pc, , ] = [$('.prompt', box)];
      const A = $('.ans.a', box), B = $('.ans.b', box), vs = $('.vs', box);
      pc.classList.add('invisible'); A.classList.add('invisible'); B.classList.add('invisible'); vs.classList.add('invisible');
      add(`<div class="sub" style="font-size:3vh;margin-top:3vh">Matchup ${v.gv.mi + 1} of ${v.gv.of}</div>`, box);
      await wait(250);
      pc.classList.remove('invisible'); pc.classList.add('slam'); audio.slam();
      await say(v.gv.prompt);
      if (!live(tk)) return;
      A.classList.remove('invisible'); A.classList.add('from-l'); audio.whoosh(0.35); setTimeout(() => audio.slam(), 300);
      await wait(350);
      await say(v.gv.A);
      if (!live(tk)) return;
      await wait(1500);
      if (!live(tk)) return;
      vs.classList.remove('invisible'); vs.classList.add('pop');
      B.classList.remove('invisible'); B.classList.add('from-r'); audio.whoosh(0.35); setTimeout(() => audio.slam(), 300);
      await wait(350);
      await say(v.gv.B);
      await wait(500);
      if (live(tk)) done(v);
    },
  },
  'z-vote': {
    scene: 'match',
    enter(v, tk, cont) {
      const box = matchScene(v, cont);
      $$('.invisible', box).forEach((e) => e.classList.remove('invisible'));
      $$('.sub', box).forEach((e) => e.remove());
      const b = h(`<div class="banner livebanner slam" style="--r:-2deg;margin-top:4vh">🗳️ VOTE NOW ON YOUR PHONE!</div>`);
      box.appendChild(b);
      audio.ding();
      say('Vote for your favorite!');
    },
  },
  'z-result': {
    scene: 'match',
    async enter(v, tk, cont) {
      const box = matchScene(v, cont);
      $$('.invisible', box).forEach((e) => e.classList.remove('invisible'));
      $$('.livebanner, .sub', box).forEach((e) => e.remove());
      const r = v.gv.res;
      const pa = r.total ? Math.round((r.A.length / r.total) * 100) : 50;
      const pb = r.total ? 100 - pa : 50;
      const tug = h(`<div class="tug"><div class="ta">0%</div><div class="tb">0%</div></div>`);
      box.appendChild(tug);
      await wait(400);
      // woodblock ticks per vote
      const n = r.A.length + r.B.length;
      for (let i = 0; i < n; i++) { if (!live(tk)) return; audio.tick(i % 2 === 0); await wait(140); }
      $('.ta', tug).style.width = Math.max(pa, r.total ? 8 : 50) + '%';
      $('.tb', tug).style.width = Math.max(pb, r.total ? 8 : 50) + '%';
      $('.ta', tug).textContent = r.total ? pa + '%' : '–';
      $('.tb', tug).textContent = r.total ? pb + '%' : '–';
      await wait(1500);
      if (!live(tk)) return;
      const reveal = (el, id, pts, voters, how, win) => {
        el.classList.add(win ? 'win' : r.winner === 'tie' ? 'tie' : 'lose');
        el.insertAdjacentHTML('beforeend', `<div class="who pop">${av(P(id))}<span>${esc(P(id).name)}</span></div>
          ${how !== 'typed' ? `<div class="tagpanic">${how === 'panic' ? '😱 PANIC BUTTON' : '⏰ OUT OF TIME'} · half points</div>` : ''}
          <div class="voters">${voters.map((x) => av(P(x))).join('')}</div>
          <div class="pts pop">+${pts}</div>`);
      };
      reveal($('.ans.a', box), v.gv.a, r.pa, r.A, v.gv.howA, r.winner === 'a');
      reveal($('.ans.b', box), v.gv.b, r.pb, r.B, v.gv.howB, r.winner === 'b');
      audio.ding();
      await wait(600);
      if (!live(tk)) return;
      if (r.zing) {
        const st = stamp('ZING!', 'zing', box);
        st.style.top = '28%';
        shake();
        audio.zing();
        confetti(120);
        await say(quip('zing', P(r.winner === 'a' ? v.gv.a : v.gv.b).name));
      } else if (r.winner === 'tie') {
        const st = stamp('TIE!', '', box);
        st.style.top = '30%';
        await say(r.total ? quip('tie') : 'Nobody voted! Awkward.');
      } else {
        const wid = r.winner === 'a' ? v.gv.a : v.gv.b;
        await say(quip('win', P(wid).name));
      }
      await wait(1800);
      if (live(tk)) done(v);
    },
  },
  'z-scores': {
    async enter(v, tk) {
      const rows = scoreboard(v, v.gv.round >= 2 ? 'SCORES' : 'ROUND 1 SCORES', v.gv.round === 1 ? 'Round 2 is worth DOUBLE!' : 'Final round next!');
      await wait(900);
      if (rows[0]) await say(`${rows[0].name} is in the lead!`);
      await wait(2600);
      if (live(tk)) done(v);
    },
  },
  'z-fwrite': {
    enter(v) {
      add(`<div class="mega m slam pink">EVERYONE ANSWERS!</div>`);
      add(`<div class="card prompt tilt-r pop" style="margin-top:4vh;animation-delay:.3s">${esc(v.gv.prompt)}</div>`);
      say('Everyone, answer this: ' + v.gv.prompt);
    },
  },
  'z-freveal': {
    scene: 'final',
    async enter(v, tk) {
      add(`<div class="card small-prompt tilt-l slam">${esc(v.gv.prompt)}</div>`);
      const grid = add('<div class="fgrid"></div>');
      await say(v.gv.prompt);
      for (const text of v.gv.answers) {
        if (!live(tk)) return;
        add(`<div class="card fcard slam"><div class="txt">${esc(text)}</div></div>`, grid);
        audio.slam();
        await say(text);
        await wait(350);
      }
      await wait(600);
      if (live(tk)) done(v);
    },
  },
  'z-fvote': {
    scene: 'final',
    enter(v, tk, cont) {
      if (!cont || !$('.fgrid')) {
        screen.innerHTML = '';
        add(`<div class="card small-prompt tilt-l">${esc(v.gv.prompt)}</div>`);
        const grid = add('<div class="fgrid"></div>');
        for (const text of v.gv.answers) add(`<div class="card fcard"><div class="txt">${esc(text)}</div></div>`, grid);
      }
      const b = h(`<div class="banner livebanner slam" style="--r:-2deg;margin-top:3vh">HAND OUT YOUR 🥇🥈🥉 ON YOUR PHONE!</div>`);
      screen.appendChild(b);
      audio.ding();
      say('Hand out your gold, silver and bronze medals!');
    },
  },
  'z-fresult': {
    async enter(v, tk) {
      add(`<div class="card small-prompt tilt-l">${esc(v.gv.prompt)}</div>`);
      const grid = add('<div class="fgrid"></div>');
      const res = v.gv.results;
      const cards = res.map((r) => add(`<div class="card fcard invisible"><div class="txt">${esc(r.text)}</div>
        <div class="meta">${av(P(r.id))}<b>${esc(P(r.id).name)}</b>
        <span>${'🥇'.repeat(r.counts[0])}${'🥈'.repeat(r.counts[1])}${'🥉'.repeat(r.counts[2])}</span>
        <span class="pts">+${r.pts}</span></div></div>`, grid));
      await wait(500);
      for (let i = 0; i < cards.length; i++) {
        if (!live(tk)) return;
        const last = i === cards.length - 1;
        if (last && cards.length > 1) { audio.drumroll(1.8); await wait(1900); }
        cards[i].classList.remove('invisible');
        cards[i].classList.add(last ? 'slam' : 'pop');
        if (last) { cards[i].classList.add('win'); shake(); audio.zing(); confetti(100); await say(`${P(res[i].id).name} wins the final round!`); }
        else { audio.tick(); await wait(900); }
      }
      await wait(1500);
      if (live(tk)) done(v);
    },
  },

  // ---------------- HUNCH ----------------
  'h-guess': {
    scene: 'dial',
    restart: true, // each new question wipes in fresh; bet/reveal continue on the same dial
    async enter(v, tk) {
      const gp = P(v.gv.gid);
      add(`<div class="card qcard tilt-l slam">${esc(v.gv.q)}</div>`);
      buildDial();
      setNeedle(v.gv.slide ?? 50);
      add(`<div class="banner livebanner pop" style="--r:2deg;margin-top:3vh;display:flex;align-items:center;gap:1vw">${av(gp, '')}<span>${esc(gp.name)} IS GUESSING… SHOUT ADVICE!</span></div>`);
      const b = $('.livebanner .av'); if (b) { b.style.width = '6vh'; b.style.fontSize = '2.4vh'; }
      audio.slam();
      await say(`${gp.name}: ${v.gv.q}`);
    },
  },
  'h-bet': {
    scene: 'dial',
    enter(v, tk, cont) {
      if (!cont || !$('.dial')) {
        screen.innerHTML = '';
        add(`<div class="card qcard tilt-l">${esc(v.gv.q)}</div>`);
        buildDial();
      }
      setNeedle(v.gv.guess, true);
      $('.dialnum').textContent = v.gv.guess + '%';
      banner('⬆️ HIGHER OR LOWER? ⬇️ BET ON YOUR PHONE!');
      audio.thwump();
      say(`${P(v.gv.gid).name} guessed ${v.gv.guess} percent. Higher, or lower?`);
    },
  },
  'h-reveal': {
    scene: 'dial',
    async enter(v, tk, cont) {
      if (!cont || !$('.dial')) {
        screen.innerHTML = '';
        add(`<div class="card qcard tilt-l">${esc(v.gv.q)}</div>`);
        buildDial();
      }
      $$('.livebanner').forEach((e) => e.remove());
      const g = v.gv;
      setNeedle(g.guess, true);
      const num = $('.dialnum');
      num.textContent = g.guess + '%';
      addMarker(g.guess, P(g.gid).color, P(g.gid).name);
      await say("Let's see the real answer!");
      if (!live(tk)) return;
      audio.hush(true);
      const slow = g.a * 0.86;
      audio.rise(3.2);
      const mini = add(`<div class="dialnum mini">0%</div>`, $('.dialwrap'));
      await creep(slow, 3200, (x) => { setFill(x); mini.textContent = Math.round(x) + '%'; });
      if (!live(tk)) return audio.hush(false);
      audio.drumroll(1.4);
      await wait(1500);
      if (!live(tk)) return audio.hush(false);
      const f = (x) => { setFill(x); mini.textContent = Math.round(x) + '%'; };
      f.from = slow;
      await creep(g.a, 420, f);
      mini.remove();
      num.classList.add('real', 'slam');
      num.textContent = g.a + '%';
      audio.hush(false);
      audio.slam();
      const diff = Math.abs(g.a - g.guess);
      if (diff <= 2) { stamp('BULLSEYE!', 'green', $('.dialwrap')).style.top = '20%'; shake(); audio.zing(); confetti(90); }
      const bets = add('<div class="bets"></div>');
      bets.insertAdjacentHTML('beforeend', `<div class="card bet right pop">${av(P(g.gid))}<span>${esc(P(g.gid).name)}: ${g.guess}%</span><span class="p">+${g.pts[g.gid] || 0}</span></div>`);
      Object.entries(g.bets).forEach(([id, bet], i) => {
        const pts = g.pts[id] || 0;
        bets.insertAdjacentHTML('beforeend', `<div class="card bet ${pts ? 'right' : 'wrong'} pop" style="animation-delay:${0.12 * (i + 1)}s">${av(P(id))}<span>${BET_LABEL[bet]}</span>${pts ? `<span class="p">+${pts}</span>` : ''}</div>`);
      });
      add(`<div class="card dialnote pop" style="animation-delay:.3s">${esc(g.note)}</div>`);
      const line = diff <= 2 ? quip('bull', g.a) : diff <= 10 ? quip('close', g.a) : diff >= 28 ? quip('whiff', g.a) : `It's ${g.a} percent!`;
      await say(line);
      await wait(2600);
      if (live(tk)) done(v);
    },
  },
  'h-scores': {
    async enter(v, tk) {
      const rows = scoreboard(v, 'SCORES', v.pd.next === 'round2' ? 'Round 2: DOUBLE POINTS!' : 'Final round: EVERYONE guesses!');
      await wait(900);
      if (rows[0]) await say(`${rows[0].name} is in the lead!`);
      await wait(2600);
      if (live(tk)) done(v);
    },
  },
  'h-ftitle': {
    async enter(v, tk) {
      add(`<div class="mega xl slam yellow" style="--r:-4deg">FINAL ROUND</div>`);
      add(`<div class="sub pop" style="animation-delay:.4s">Everyone guesses. Closest wins up to 2,000!</div>`);
      audio.slam();
      await say('Final round! Everyone guesses. The closest guess wins big.');
      await wait(600);
      if (live(tk)) done(v);
    },
  },
  'h-fguess': {
    enter(v) {
      add(`<div class="card qcard tilt-l slam">${esc(v.gv.q)}</div>`);
      buildDial();
      $('.dial .needle').style.display = 'none';
      $('.dialnum').textContent = '??%';
      banner('📱 EVERYONE: SLIDE &amp; LOCK IN!');
      say(v.gv.q);
    },
  },
  'h-freveal': {
    async enter(v, tk) {
      const g = v.gv;
      add(`<div class="card qcard tilt-l">${esc(g.q)}</div>`);
      buildDial();
      $('.dial .needle').style.display = 'none';
      const num = $('.dialnum');
      num.textContent = '??%';
      const entries = Object.entries(g.guesses).sort((a, b) => a[1] - b[1]);
      for (const [id, val] of entries) {
        if (!live(tk)) return;
        addMarker(val, P(id).color, P(id).name);
        audio.tick();
        await wait(380);
      }
      await say('And the real answer is…');
      if (!live(tk)) return;
      audio.hush(true);
      audio.rise(3);
      await creep(g.a * 0.86, 3000, (x) => { setFill(x); num.textContent = Math.round(x) + '%'; });
      if (!live(tk)) return audio.hush(false);
      audio.drumroll(1.4);
      await wait(1500);
      if (!live(tk)) return audio.hush(false);
      const f = (x) => { setFill(x); num.textContent = Math.round(x) + '%'; };
      f.from = g.a * 0.86;
      await creep(g.a, 400, f);
      if (!live(tk)) return audio.hush(false);
      audio.hush(false);
      num.classList.add('real', 'slam');
      num.textContent = g.a + '%';
      audio.zing();
      shake();
      const rank = Object.entries(g.pts).sort((a, b) => b[1] - a[1]);
      const bets = add('<div class="bets"></div>');
      rank.forEach(([id, pts], i) => bets.insertAdjacentHTML('beforeend', `<div class="card bet ${i === 0 ? 'right' : ''} pop" style="animation-delay:${0.12 * i}s">${av(P(id))}<span>${esc(P(id).name)}: ${g.guesses[id]}%</span><span class="p">+${pts}</span></div>`));
      if (rank[0]) await say(`It's ${g.a} percent! ${P(rank[0][0]).name} was closest!`);
      await wait(2600);
      if (live(tk)) done(v);
    },
  },

  // ---------------- FAKER ----------------
  'f-cat': {
    async enter(v, tk) {
      const g = v.gv;
      add(`<div class="mega m slam" style="--r:-3deg">CASE ${g.n} OF ${g.of}</div>`);
      add(`<div class="card casecard drop" style="margin-top:3vh"><img class="case-icon pop" src="/img/faker-${esc(g.cat)}.svg" alt="" /><div class="k">THIS CASE:</div><div class="label">${esc(g.label)}</div><div class="how">${esc(g.how)}</div></div>`);
      audio.slam();
      await say(`Case ${g.n}. ${g.label}! ${g.how}`);
      await wait(800);
      if (live(tk)) done(v);
    },
  },
  'f-task': {
    enter(v) {
      const g = v.gv;
      add(`<div class="phonehint">📱</div>`);
      add(`<div class="mega l slam">CHECK YOUR<br>PHONES!</div>`);
      add(`<div class="sub">${g.strikes ? `Strike ${g.strikes}! Same Faker, new task.` : 'One of you is the FAKER… 🤫'}</div>`);
      if (g.strikes) strikes(g.strikes);
      say(g.strikes ? 'Same faker. New task. Check your phones.' : 'Check your phones. One of you is the faker.');
    },
  },
  'f-count': {
    async enter(v, tk) {
      const el = add(`<div class="mega xl count"></div>`);
      for (const n of [3, 2, 1]) {
        if (!live(tk)) return;
        el.textContent = n;
        el.classList.remove('slam'); void el.offsetWidth; el.classList.add('slam');
        audio.beep(false);
        await wait(900);
      }
      if (!live(tk)) return;
      el.innerHTML = 'DO IT<br>NOW!';
      el.style.fontSize = '20vh';
      el.classList.remove('slam'); void el.offsetWidth; el.classList.add('slam');
      audio.doItNow();
      shake();
      await wait(1300);
      if (live(tk)) done(v);
    },
  },
  'f-freeze': {
    enter() {
      add(`<div class="mega xl slam yellow">FREEZE!</div>`);
      add(`<div class="sub pop">Hold it right there! ✋ 👉 🖐️</div>`);
      audio.stamp();
      say('Freeze! Hold it!');
    },
  },
  'f-discuss': {
    scene: 'discuss',
    async enter(v, tk) {
      const g = v.gv;
      add(`<div class="card taskcard slam"><div class="k">THE TASK WAS:</div><div class="t">${esc(g.task)}</div></div>`);
      strikes(g.strikes);
      add(`<div class="sub">Who's the Faker? Argue it out! <br>👑 ${esc(P(v.vip).name)} taps <b>START VOTE</b> when ready.</div>`);
      audio.slam();
      await say(`The task was: ${g.task}. So… who's faking?`);
    },
  },
  'f-vote': {
    scene: 'discuss',
    enter(v, tk, cont) {
      if (!cont || !$('.taskcard')) {
        screen.innerHTML = '';
        add(`<div class="card taskcard"><div class="k">THE TASK WAS:</div><div class="t">${esc(v.gv.task)}</div></div>`);
        strikes(v.gv.strikes);
      }
      $$('.sub').forEach((e) => e.remove());
      banner('🕵️ VOTE FOR THE FAKER ON YOUR PHONE!');
      audio.ding();
      say('Vote for the faker!');
    },
  },
  'f-result': {
    async enter(v, tk) {
      const g = v.gv;
      const r = g.res;
      add(`<div class="mega m slam">THE ROOM ACCUSES…</div>`);
      audio.hush(true);
      audio.drumroll(2.2);
      await wait(2300);
      audio.hush(false);
      if (!live(tk)) return;
      screen.innerHTML = '';
      const sus = (into) => {
        const row = add('<div class="suspects"></div>', into);
        inGame().forEach((p) => row.insertAdjacentHTML('beforeend', `<div class="suspect pop">${av(p)}<div class="nm">${esc(p.name)}</div>${r.counts[p.id] ? `<div class="votes">${r.counts[p.id]}</div>` : ''}</div>`));
      };
      if (r.accused) {
        const acc = add(`<div class="accused slam">${av(P(r.accused))}<div class="nm">${esc(P(r.accused).name)}</div></div>`);
        await wait(700);
        if (r.caught) {
          stamp('CAUGHT!', 'green', acc);
          shake(); audio.fanfare(); confetti(120);
          sus();
          await say(quip('caught', P(r.accused).name));
        } else {
          stamp('INNOCENT!', '', acc);
          audio.buzzer();
          sus();
          await say(`${P(r.accused).name} is innocent! ${r.escaped ? '' : `Strike ${r.strikes}.`}`);
        }
      } else {
        add(`<div class="accused slam"><div class="mega l">${r.none ? 'NO VOTES!' : 'HUNG JURY!'}</div></div>`);
        audio.buzzer();
        sus();
        await say(r.none ? 'Nobody voted! That counts as a strike.' : `It's a tie! That's strike ${r.strikes}.`);
      }
      if (!live(tk)) return;
      if (r.escaped && g.faker) {
        await wait(1200);
        if (!live(tk)) return;
        screen.innerHTML = '';
        add(`<div class="mega m slam">THE FAKER WAS…</div>`);
        audio.drumroll(1.6);
        await wait(1700);
        if (!live(tk)) return;
        const acc = add(`<div class="accused slam" style="margin-top:2vh">${av(P(g.faker))}<div class="nm">${esc(P(g.faker).name)}</div></div>`);
        stamp('ESCAPED!', '', acc);
        shake(); audio.zing();
        await say(quip('escaped', P(g.faker).name));
      } else if (!r.caught) strikes(r.strikes);
      await wait(2200);
      if (live(tk)) done(v);
    },
  },
  'f-scores': {
    async enter(v, tk) {
      const rows = scoreboard(v, 'SCORES', 'Next case coming up…');
      await wait(900);
      if (rows[0]) await say(`${rows[0].name} is in the lead!`);
      await wait(2600);
      if (live(tk)) done(v);
    },
  },

  // ---------------- PODIUM ----------------
  podium: {
    async enter(v, tk) {
      const pd = v.podium;
      if (!pd) return;
      const grid = add('<div class="podgrid"></div>');
      const left = add('<div style="display:flex;flex-direction:column;align-items:center"></div>', grid);
      add(`<img class="trophy pop" src="/img/trophy.svg" alt="" />`, left);
      add(`<div class="mega m slam">WINNER!</div>`, left);
      const pod = add('<div class="podium"></div>', left);
      const order = [1, 0, 2];
      const peds = order.map((i) => {
        const p = pd.ranking[i];
        if (!p) return null;
        return add(`<div class="ped p${i + 1} invisible">${av(p)}<div class="nm">${esc(p.name)}</div>
          <div class="block" style="background:${i === 0 ? '' : ''}"><div class="place">${i + 1}</div><div class="sc">${p.score.toLocaleString()}</div></div></div>`, pod);
      });
      const right = add('<div style="display:flex;flex-direction:column;gap:1vh"></div>', grid);
      audio.hush(true);
      audio.drumroll(2);
      await wait(600);
      for (const idx of [2, 1]) {
        const el = peds[order.indexOf(idx)];
        if (el) { el.classList.remove('invisible'); el.classList.add('rise'); audio.slam(); await wait(500); }
      }
      await wait(900);
      if (!live(tk)) return audio.hush(false);
      const first = peds[order.indexOf(0)];
      if (first) { first.classList.remove('invisible'); first.classList.add('rise'); }
      audio.hush(false);
      audio.fanfare();
      confetti(180);
      shake();
      const w = pd.ranking[0];
      if (w) await say(`${w.name} wins ${pd.title}!`);
      if (!live(tk)) return;
      const aw = add('<div class="awards"></div>', right);
      for (const a of pd.awards) {
        if (!live(tk)) return;
        add(`<div class="card award pop"><div class="ic">${a.icon}</div><div><div class="t">${esc(a.title)}</div><div class="n">${esc(a.name)}</div><div class="d">${esc(a.detail)}</div></div></div>`, aw);
        audio.pop(3);
        await say(`${a.title}: ${a.name}!`, { rate: 1.08 });
      }
      if (pd.top) {
        add(`<div class="card topquote pop"><div class="k">⭐ PLAY OF THE GAME</div>
          ${pd.top.sub ? `<div style="font-size:2.2vh">${esc(pd.top.sub)}</div>` : ''}
          <div class="q">“${esc(pd.top.text)}”</div><div class="by">— ${esc(pd.top.byName)} · ${pd.top.pts.toLocaleString()} pts</div></div>`, right);
        audio.ding();
      }
      if (v.settings && v.settings.prize) add(`<div class="banner pop" style="--r:1.5deg;margin-top:2vh;font-size:3.2vh;background:var(--yellow)">🏆 PRIZE: ${esc(v.settings.prize)}</div>`);
      add(`<div class="banner pop" style="--r:-1deg;margin-top:2vh;font-size:2.8vh">👑 VIP: PLAY AGAIN or SWITCH GAME on your phone</div>`);
    },
  },
};

function strikes(n) {
  $$('.strikes').forEach((e) => e.remove());
  const row = add('<div class="strikes"></div>');
  for (let i = 1; i <= 3; i++) row.insertAdjacentHTML('beforeend', `<div class="strike ${i <= n ? 'on pop' : ''}">${i <= n ? '✗' : ''}</div>`);
}

// ---------------------------------------------------------------- controls
$('#unmute').onclick = () => {
  audio.unlock();
  $('#unmute-wrap').classList.add('hidden');
  audio.chime();
  setTimeout(() => say('Welcome to Couch Chaos! Grab your phones and join in.'), 400);
};
$('#btn-voice').onclick = (e) => { audio.voiceOn = !audio.voiceOn; e.currentTarget.classList.toggle('off', !audio.voiceOn); if (!audio.voiceOn) hushVoice(); };
$('#btn-music').onclick = (e) => { audio.setMusic(!audio.musicOn); e.currentTarget.classList.toggle('off', !audio.musicOn); };
$('#vol-music').oninput = (e) => audio.setMusicVol(+e.target.value);
const fullscreen = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}));
$('#btn-full').onclick = fullscreen;
document.addEventListener('keydown', (e) => { if (e.key === 'f' || e.key === 'F') fullscreen(); });

boot();

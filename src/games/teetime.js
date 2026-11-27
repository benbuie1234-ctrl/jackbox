import { TEE_DRAW_PROMPTS, TEE_SLOGAN_FALLBACKS } from '../content.js';
import { shuffle, cleanText, pick, rid } from '../util.js';

const DRAW = 75, SLOGAN = 60, BUILD = 50, VOTE = 20;
const COLORS = ['#fffdf6', '#1d1d22', '#ff2d8a', '#1638ff', '#ffd23f'];
const MAX_ART = 160000;
const SLOGAN_MAX = 45;
const PTS = { creator: 400, artist: 300, writer: 300, ko: 250 };

// ---------------------------------------------------------------- helpers
const slotsDone = (slots) => (slots || []).every((x) => x.id);
const shirtOwners = (room) => Object.keys(room.g.shirts).filter((id) => room.s.players[id]);

function botArt() {
  const fills = ['#ff2d8a', '#1638ff', '#ffd23f', '#2bd96b', '#ff8c2e', '#b26bff'];
  const f = pick(fills);
  const mouth = pick(['M36 64 Q50 76 64 64', 'M36 68 Q50 58 64 68', 'M38 66 L62 66']);
  const r = 24 + Math.floor(Math.random() * 10);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
    <circle cx='50' cy='52' r='${r}' fill='${f}' stroke='#111' stroke-width='5'/>
    <circle cx='41' cy='47' r='5' fill='#111'/><circle cx='59' cy='47' r='5' fill='#111'/>
    <path d='${mouth}' stroke='#111' stroke-width='5' fill='none' stroke-linecap='round'/>
    <path d='M30 ${52 - r + 2} L40 ${44 - r} L50 ${52 - r} L60 ${44 - r} L70 ${52 - r + 2}' stroke='#111' stroke-width='4' fill='#ffd23f'/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Deal k items, spreading usage so every drawing/slogan gets a chance.
function dealSpread(items, k, use) {
  const sorted = shuffle(items).sort((a, b) => (use[a.id] || 0) - (use[b.id] || 0));
  const out = sorted.slice(0, k);
  for (const x of out) use[x.id] = (use[x.id] || 0) + 1;
  return out.map((x) => x.id);
}

function shirtV(room, pid, credits = false) {
  const g = room.g;
  const sh = g.shirts[pid];
  if (!sh) return null;
  const sl = g.slogans[sh.s];
  const v = { id: pid, d: sh.d, text: sl ? sl.text : '', c: sh.c, wins: g.wins[pid] || 0 };
  if (credits) {
    v.by = pid;
    v.artBy = sh.d ? g.draws[sh.d].by : null;
    v.slBy = sl ? sl.by : null;
  }
  return v;
}

// ---------------------------------------------------------------- phases
function startDraw(room) {
  const g = room.g;
  const prompts = shuffle(TEE_DRAW_PROMPTS);
  let k = 0;
  for (const p of room.active()) {
    g.dslots[p.id] = Array.from({ length: g.nDraw }, (_, i) => ({ key: i, prompt: prompts[k++ % prompts.length], id: null }));
  }
  room.phase('t-draw', DRAW, { input: true });
  room.botsDo('draw', 2500, 9000);
}

function startSlogans(room) {
  const g = room.g;
  for (const p of room.active()) {
    g.sslots[p.id] = Array.from({ length: g.nSlogan }, (_, i) => ({ key: i, id: null }));
  }
  room.phase('t-slogan', SLOGAN, { input: true });
  room.botsDo('slogan', 2000, 8000);
}

function addSlogan(room, pid, slot, text, how) {
  const id = rid();
  room.g.slogans[id] = { id, by: pid, text, how };
  slot.id = id;
}

function fillSlogans(room) {
  const g = room.g;
  const used = new Set(Object.values(g.slogans).map((s) => s.text));
  for (const [pid, slots] of Object.entries(g.sslots)) {
    if (!room.s.players[pid]) continue;
    for (const slot of slots) {
      if (slot.id) continue;
      const d = g.drafts[pid + ':' + slot.key];
      let t = d;
      if (!t) {
        const fresh = TEE_SLOGAN_FALLBACKS.filter((x) => !used.has(x));
        t = pick(fresh.length ? fresh : TEE_SLOGAN_FALLBACKS);
      }
      used.add(t);
      addSlogan(room, pid, slot, t, d ? 'typed' : 'auto');
    }
  }
}

function startBuild(room) {
  const g = room.g;
  const allD = Object.values(g.draws);
  const allS = Object.values(g.slogans);
  const useD = {}, useS = {};
  for (const p of room.active()) {
    let ds = allD.filter((d) => d.by !== p.id);
    if (ds.length < 2) ds = allD;
    let ss = allS.filter((s) => s.by !== p.id);
    if (ss.length < 2) ss = allS;
    g.deals[p.id] = {
      d: dealSpread(ds, g.quick ? 3 : 4, useD),
      s: dealSpread(ss, g.quick ? 4 : 5, useS),
    };
  }
  room.phase('t-build', BUILD, { input: true });
  room.botsDo('build', 2000, 8000);
}

function randomShirt(room, pid) {
  const deal = room.g.deals[pid];
  if (!deal || !deal.s.length) return null;
  return { by: pid, d: deal.d.length ? pick(deal.d) : null, s: pick(deal.s), c: pick(COLORS), auto: true };
}

function startArena(room) {
  const g = room.g;
  for (const p of room.active()) {
    if (!g.shirts[p.id]) {
      const sh = randomShirt(room, p.id);
      if (sh) g.shirts[p.id] = sh;
    }
  }
  g.order = shuffle(shirtOwners(room));
  g.champ = g.order[0];
  g.ci = 1;
  room.phase('t-arena', 10, { hostPaced: true, data: { n: g.order.length } });
}

function startMatch(room) {
  const g = room.g;
  if (g.ci >= g.order.length) {
    room.phase('t-champ', 18, { hostPaced: true, spot: [g.champ] });
    return;
  }
  g.match = { L: g.champ, R: g.order[g.ci], votes: {}, res: null };
  room.phase('t-match', 30, { hostPaced: true, spot: [g.match.L, g.match.R], data: { mi: g.ci, of: g.order.length - 1 } });
}

const voters = (room) => room.needed().filter((p) => p.id !== room.g.match.L && p.id !== room.g.match.R);

function openVote(room) {
  const m = room.g.match;
  room.phase('t-vote', VOTE, { timer: true, spot: [m.L, m.R] });
  room.botsDo('vote', 1200, 5000, (p) => p.id !== m.L && p.id !== m.R);
}

function tally(room) {
  const g = room.g;
  const m = g.match;
  const L = Object.entries(m.votes).filter(([, v]) => v === 'L').map(([id]) => id);
  const R = Object.entries(m.votes).filter(([, v]) => v === 'R').map(([id]) => id);
  const total = L.length + R.length;
  // Ties go to the defending champ.
  let winner = null;
  if (total) winner = R.length > L.length ? 'R' : 'L';
  const ko = !!winner && total >= 2 && (L.length === 0 || R.length === 0);
  const pts = {};
  const add = (id, n) => { if (!id || !room.s.players[id]) return; pts[id] = (pts[id] || 0) + n; room.addScore(id, n); };
  if (winner) {
    const wid = winner === 'L' ? m.L : m.R;
    const sh = g.shirts[wid];
    const sl = g.slogans[sh.s];
    add(wid, PTS.creator + (ko ? PTS.ko : 0));
    if (sh.d) { add(g.draws[sh.d].by, PTS.artist); room.stat(g.draws[sh.d].by, 'artPts', PTS.artist); }
    if (sl) {
      const w = sl.how === 'typed' ? PTS.writer : Math.round(PTS.writer / 2);
      add(sl.by, w);
      room.stat(sl.by, 'slogPts', w);
    }
    room.stat(wid, 'shirtWins');
    if (ko) room.stat(wid, 'kos');
    g.wins[wid] = (g.wins[wid] || 0) + 1;
    g.champ = wid;
    if (sl) room.quote(sl.text, wid, pts[wid] || 0, 'T-SHIRT BATTLE');
  }
  m.res = { L, R, total, winner: winner || 'L', tie: total > 0 && L.length === R.length, none: total === 0, ko, pts };
  room.phase('t-result', 20, { hostPaced: true, spot: [m.L, m.R] });
}

// ---------------------------------------------------------------- actions
function doDrawing(room, pid, key, data) {
  const g = room.g;
  if (room.phaseName !== 't-draw') return false;
  const slot = (g.dslots[pid] || [])[key];
  if (!slot || slot.id) return false;
  if (typeof data !== 'string' || !data.startsWith('data:image/') || data.length > MAX_ART) return false;
  const id = rid();
  g.draws[id] = { id, by: pid, prompt: slot.prompt };
  slot.id = id;
  room.ctx.storage.put('tt:' + id, data);
  room.sendArt(id, data);
  room.submitted(pid);
  if (room.needed().every((p) => slotsDone(g.dslots[p.id]))) startSlogans(room);
  return true;
}

function doSlogan(room, pid, key, text, panic) {
  const g = room.g;
  if (room.phaseName !== 't-slogan') return false;
  const slot = (g.sslots[pid] || [])[key];
  if (!slot || slot.id) return false;
  const t = panic ? pick(TEE_SLOGAN_FALLBACKS) : cleanText(text, SLOGAN_MAX);
  if (!t) return false;
  addSlogan(room, pid, slot, t, panic ? 'panic' : 'typed');
  room.submitted(pid);
  if (room.needed().every((p) => slotsDone(g.sslots[p.id]))) { fillSlogans(room); startBuild(room); }
  return true;
}

function doShirt(room, pid, d, s, c) {
  const g = room.g;
  if (room.phaseName !== 't-build' || g.shirts[pid]) return false;
  const deal = g.deals[pid];
  if (!deal) return false;
  if (deal.d.length ? !deal.d.includes(d) : d != null) return false;
  if (!deal.s.includes(s) || !COLORS.includes(c)) return false;
  g.shirts[pid] = { by: pid, d: d ?? null, s, c, auto: false };
  room.submitted(pid);
  if (room.needed().every((p) => g.shirts[p.id])) startArena(room);
  return true;
}

export default {
  title: 'TEE TIME',
  tagline: 'Draw, write slogans, build shirts. Last shirt standing wins.',
  min: 3,
  rules: [
    'Draw silly pictures on your phone.',
    'Write punchy T-shirt slogans.',
    'Mix other people\'s drawings and slogans into the perfect shirt.',
    'Shirts battle head-to-head. Winner stays on until one champion is crowned!',
  ],

  init(room, opts = {}) {
    room.clearArt();
    const quick = !!opts.quick;
    return {
      quick, nDraw: quick ? 1 : 2, nSlogan: quick ? 1 : 2,
      draws: {}, dslots: {}, slogans: {}, sslots: {}, drafts: {},
      deals: {}, shirts: {}, order: [], champ: null, ci: 1, match: null, wins: {},
    };
  },

  begin(room) { startDraw(room); },

  timeout(room) {
    const g = room.g;
    switch (room.phaseName) {
      case 't-draw': return startSlogans(room);
      case 't-slogan': fillSlogans(room); return startBuild(room);
      case 't-build': return startArena(room);
      case 't-arena': return startMatch(room);
      case 't-match': return openVote(room);
      case 't-vote': return tally(room);
      case 't-result': g.ci++; return startMatch(room);
      case 't-champ': return room.finish();
    }
  },

  action(room, pid, m) {
    const g = room.g;
    if (m.a === 'drawing') return doDrawing(room, pid, Number(m.key), m.data) ? 'ok' : 'none';
    if (m.a === 'draft') {
      if (room.phaseName !== 't-slogan') return 'none';
      g.drafts[pid + ':' + m.key] = cleanText(m.text, SLOGAN_MAX);
      return 'quiet';
    }
    if (m.a === 'slogan') return doSlogan(room, pid, Number(m.key), m.text, !!m.panic) ? 'ok' : 'none';
    if (m.a === 'shirt') return doShirt(room, pid, m.d ?? null, m.s, m.c) ? 'ok' : 'none';
    if (m.a === 'tvote' && room.phaseName === 't-vote') {
      const mt = g.match;
      if (pid === mt.L || pid === mt.R || mt.votes[pid] || !['L', 'R'].includes(m.side)) return 'none';
      mt.votes[pid] = m.side;
      if (voters(room).every((p) => mt.votes[p.id])) tally(room);
      return 'ok';
    }
    return 'none';
  },

  bot(room, { pid, kind }) {
    const g = room.g;
    if (kind === 'draw') for (const s of g.dslots[pid] || []) if (!s.id) doDrawing(room, pid, s.key, botArt());
    if (kind === 'slogan') {
      const used = new Set(Object.values(g.slogans).map((s) => s.text));
      for (const s of g.sslots[pid] || []) {
        if (s.id || room.phaseName !== 't-slogan') continue;
        const fresh = TEE_SLOGAN_FALLBACKS.filter((x) => !used.has(x));
        const t = pick(fresh.length ? fresh : TEE_SLOGAN_FALLBACKS);
        used.add(t);
        doSlogan(room, pid, s.key, t, false);
      }
    }
    if (kind === 'build') {
      const sh = randomShirt(room, pid);
      if (sh) doShirt(room, pid, sh.d, sh.s, sh.c);
    }
    if (kind === 'vote') this.action(room, pid, { a: 'tvote', side: Math.random() < 0.5 ? 'L' : 'R' });
  },

  hostView(room) {
    const g = room.g;
    const ph = room.phaseName;
    const v = { quick: g.quick };
    if (ph === 't-draw') v.done = room.active().filter((p) => slotsDone(g.dslots[p.id])).map((p) => p.id);
    if (ph === 't-slogan') v.done = room.active().filter((p) => slotsDone(g.sslots[p.id])).map((p) => p.id);
    if (ph === 't-build') v.done = Object.keys(g.shirts);
    if (['t-match', 't-vote', 't-result'].includes(ph) && g.match) {
      const m = g.match;
      const credits = ph === 't-result';
      v.L = shirtV(room, m.L, credits);
      v.R = shirtV(room, m.R, credits);
      v.mi = g.ci;
      v.of = g.order.length - 1;
      if (ph === 't-vote') { v.voters = voters(room).map((p) => p.id); v.voted = Object.keys(m.votes); }
      if (ph === 't-result') v.res = m.res;
    }
    if (ph === 't-champ') v.champ = shirtV(room, g.champ, true);
    return v;
  },

  playerView(room, pid) {
    const g = room.g;
    const ph = room.phaseName;
    if (ph === 't-draw') return { slots: (g.dslots[pid] || []).map((s) => ({ key: s.key, prompt: s.prompt, done: !!s.id })) };
    if (ph === 't-slogan') return { slots: (g.sslots[pid] || []).map((s) => ({ key: s.key, done: !!s.id })), max: SLOGAN_MAX };
    if (ph === 't-build') {
      const deal = g.deals[pid] || { d: [], s: [] };
      return { d: deal.d, s: deal.s.map((id) => ({ id, text: g.slogans[id].text })), colors: COLORS, done: !!g.shirts[pid] };
    }
    if (ph === 't-vote' && g.match) {
      const m = g.match;
      const sv = (id) => { const x = shirtV(room, id); return { d: x.d, text: x.text, c: x.c }; };
      return { mine: pid === m.L || pid === m.R, voted: m.votes[pid] || null, L: sv(m.L), R: sv(m.R) };
    }
    return {};
  },

  awards(room, st, best) {
    const out = [];
    const t = best((id) => st(id).shirtWins || null);
    if (t) out.push({ title: 'MASTER TAILOR', icon: '👕', id: t.id, detail: `${t.v} shirt battle win${t.v > 1 ? 's' : ''}` });
    const a = best((id) => st(id).artPts || null);
    if (a) out.push({ title: 'PICASSO', icon: '🎨', id: a.id, detail: `${a.v} points from their drawings` });
    const w = best((id) => st(id).slogPts || null);
    if (w) out.push({ title: 'WORDSMITH', icon: '✍️', id: w.id, detail: `${w.v} points from their slogans` });
    return out;
  },
};

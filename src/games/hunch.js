import { HUNCH_QUESTIONS } from '../content.js';
import { shuffle, deal, clamp } from '../util.js';

const GUESS = 45, BET = 20, FGUESS = 40;
const BETS = ['much-lower', 'lower', 'higher', 'much-higher'];

const round10 = (n) => Math.max(0, Math.round(n / 10) * 10);

function nextQuestion(room) {
  const g = room.g;
  if (g.qi < g.queue.length) {
    const item = g.queue[g.qi];
    const q = g.qs[g.qi];
    g.cur = { q: q.q, a: q.a, note: q.note, gid: item.gid, r: item.r, guess: null, bets: {}, pts: {} };
    room.live.slide = {};
    room.phase('h-guess', GUESS, { input: true, spot: [item.gid], data: { r: item.r, n: g.qi + 1, of: g.queue.length } });
    room.botsDo('guess', 2000, 5000, (p) => p.id === item.gid);
    return;
  }
  const q = g.qs[g.queue.length];
  g.cur = { q: q.q, a: q.a, note: q.note, final: true, guesses: {}, pts: {} };
  room.live.slide = {};
  room.phase('h-ftitle', 7, { hostPaced: true });
}

function lockGuess(room, v) {
  const g = room.g;
  g.cur.guess = clamp(Math.round(Number(v)), 0, 100);
  room.submitted(g.cur.gid);
  room.phase('h-bet', BET, { timer: true, spot: [g.cur.gid] });
  room.botsDo('bet', 1200, 5000, (p) => p.id !== g.cur.gid);
}

const bettors = (room) => room.needed().filter((p) => p.id !== room.g.cur.gid);

function reveal(room) {
  const g = room.g;
  const c = g.cur;
  const diff = Math.abs(c.guess - c.a);
  const mult = c.r;
  let gp = round10(1000 - 40 * diff);
  if (diff <= 2) gp += 500;
  gp *= mult;
  c.pts[c.gid] = gp;
  room.addScore(c.gid, gp);
  room.stat(c.gid, 'guesses');
  room.stat(c.gid, 'diffSum', diff);
  if (diff <= 2) room.stat(c.gid, 'bullseyes');
  room.quote(`Guessed ${c.guess}% — it was ${c.a}%`, c.gid, gp, c.q);
  for (const [id, bet] of Object.entries(c.bets)) {
    const up = c.a > c.guess, down = c.a < c.guess;
    const right = (bet.endsWith('higher') && up) || (bet.endsWith('lower') && down);
    let pts = 0;
    if (bet.startsWith('much')) pts = right && diff > 15 ? 1000 : 0;
    else pts = right ? 500 : 0;
    pts *= mult;
    c.pts[id] = pts;
    if (pts) { room.addScore(id, pts); room.stat(id, 'betsWon'); }
  }
  room.phase('h-reveal', 25, { hostPaced: true, spot: [c.gid] });
}

function finalReveal(room) {
  const c = room.g.cur;
  for (const p of room.active()) {
    if (c.guesses[p.id] == null) c.guesses[p.id] = clamp(Math.round(room.live.slide[p.id] ?? 50), 0, 100);
  }
  for (const [id, v] of Object.entries(c.guesses)) {
    const diff = Math.abs(v - c.a);
    let pts = round10(2000 - 80 * diff);
    if (diff === 0) pts += 1000;
    c.pts[id] = pts;
    room.addScore(id, pts);
    room.stat(id, 'guesses');
    room.stat(id, 'diffSum', diff);
    room.quote(`Final guess ${v}% — it was ${c.a}%`, id, pts, c.q);
  }
  room.phase('h-freveal', 28, { hostPaced: true });
}

export default {
  title: 'HUNCH',
  tagline: 'Guess the percentage. Everyone else bets higher or lower.',
  min: 2,
  rules: [
    'One player drags the slider to guess a percentage.',
    'Everyone else bets: HIGHER or LOWER?',
    'Feeling bold? MUCH HIGHER or MUCH LOWER pays double… if it\'s off by more than 15.',
    'Final round: everyone guesses. Closest wins big.',
  ],

  init(room) {
    const ids = room.active().map((p) => p.id);
    const rounds = ids.length <= 4 ? 2 : 1;
    const queue = [];
    for (let r = 1; r <= rounds; r++) for (const gid of shuffle(ids)) queue.push({ gid, r });
    room.s.used ??= [];
    const qs = deal(HUNCH_QUESTIONS, queue.length + 1, room.s.used);
    room.s.used.push(...qs.map((q) => q.q));
    return { queue, qs, qi: 0, cur: null, rounds };
  },

  begin(room) { nextQuestion(room); },

  timeout(room) {
    const g = room.g;
    switch (room.phaseName) {
      case 'h-guess': return lockGuess(room, room.live.slide[g.cur.gid] ?? 50);
      case 'h-bet': return reveal(room);
      case 'h-reveal': {
        g.qi++;
        const endOfRound = g.qi < g.queue.length && g.queue[g.qi].r !== g.queue[g.qi - 1].r;
        if (endOfRound || g.qi === g.queue.length) return room.phase('h-scores', 9, { hostPaced: true, data: { next: g.qi === g.queue.length ? 'final' : 'round2' } });
        return nextQuestion(room);
      }
      case 'h-scores': return nextQuestion(room);
      case 'h-ftitle':
        room.phase('h-fguess', FGUESS, { input: true });
        room.botsDo('fguess', 2000, 8000);
        return;
      case 'h-fguess': return finalReveal(room);
      case 'h-freveal': return room.finish();
    }
  },

  action(room, pid, m) {
    const g = room.g;
    const c = g.cur;
    const ph = room.phaseName;
    if (m.a === 'slide') {
      const v = clamp(Math.round(Number(m.v) || 0), 0, 100);
      room.live.slide[pid] = v;
      if (ph === 'h-guess' && pid === c.gid) room.toHosts({ t: 'slide', v });
      return 'none';
    }
    if (m.a === 'lock') {
      if (ph === 'h-guess' && pid === c.gid) { lockGuess(room, m.v); return 'ok'; }
      if (ph === 'h-fguess' && c.guesses[pid] == null) {
        c.guesses[pid] = clamp(Math.round(Number(m.v) || 0), 0, 100);
        room.submitted(pid);
        if (room.needed().every((p) => c.guesses[p.id] != null)) finalReveal(room);
        return 'ok';
      }
      return 'none';
    }
    if (m.a === 'bet' && ph === 'h-bet' && pid !== c.gid && !c.bets[pid] && BETS.includes(m.bet)) {
      c.bets[pid] = m.bet;
      if (bettors(room).every((p) => c.bets[p.id])) reveal(room);
      return 'ok';
    }
    return 'none';
  },

  bot(room, { pid, kind }) {
    const c = room.g.cur;
    const near = () => clamp(c.a + Math.round((Math.random() - 0.5) * 50), 0, 100);
    if (kind === 'guess' && room.phaseName === 'h-guess') lockGuess(room, near());
    if (kind === 'bet') this.action(room, pid, { a: 'bet', bet: BETS[Math.floor(Math.random() * 4)] });
    if (kind === 'fguess') this.action(room, pid, { a: 'lock', v: near() });
  },

  hostView(room) {
    const g = room.g;
    const c = g.cur;
    const ph = room.phaseName;
    const v = { qi: g.qi, total: g.queue.length, rounds: g.rounds };
    if (!c) return v;
    v.q = c.q;
    if (!c.final) {
      v.gid = c.gid; v.r = c.r;
      v.slide = room.live.slide[c.gid] ?? 50;
      if (ph !== 'h-guess') v.guess = c.guess;
      if (ph === 'h-bet') { v.bettors = bettors(room).map((p) => p.id); v.betted = Object.keys(c.bets); }
      if (ph === 'h-reveal') { v.a = c.a; v.note = c.note; v.bets = c.bets; v.pts = c.pts; }
    } else {
      v.final = true;
      if (ph === 'h-fguess') v.done = Object.keys(c.guesses);
      if (ph === 'h-freveal') { v.a = c.a; v.note = c.note; v.guesses = c.guesses; v.pts = c.pts; }
    }
    return v;
  },

  playerView(room, pid) {
    const c = room.g.cur;
    const ph = room.phaseName;
    if (!c) return {};
    if (ph === 'h-guess') {
      return pid === c.gid ? { role: 'guesser', q: c.q } : { role: 'watch', q: c.q, guesser: room.name(c.gid) };
    }
    if (ph === 'h-bet') {
      return pid === c.gid
        ? { role: 'guesser', q: c.q, guess: c.guess }
        : { role: 'bettor', q: c.q, guess: c.guess, guesser: room.name(c.gid), bet: c.bets[pid] || null };
    }
    if (ph === 'h-fguess') return { role: 'final', q: c.q, locked: c.guesses[pid] ?? null };
    return {};
  },

  awards(room, st, best) {
    const out = [];
    const calc = best((id) => (st(id).guesses ? -st(id).diffSum / st(id).guesses : null));
    if (calc) out.push({ title: 'HUMAN CALCULATOR', icon: '🧮', id: calc.id, detail: `off by ${(-calc.v).toFixed(1)} points on average` });
    const bets = best((id) => st(id).betsWon || null);
    if (bets) out.push({ title: 'CRYSTAL BALL', icon: '🔮', id: bets.id, detail: `${bets.v} winning bets` });
    return out;
  },
};

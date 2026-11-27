import { ZINGER_PROMPTS, ZINGER_FINALS } from '../content.js';
import { shuffle, deal, cleanText, pick } from '../util.js';

const WRITE = 90, VOTE = 20, FWRITE = 75, FVOTE = 35;
const MEDALS = [300, 200, 100];

function used(room) {
  room.s.used ??= [];
  return room.s.used;
}
function markUsed(room, list) {
  const u = used(room);
  u.push(...list);
  if (u.length > 400) u.splice(0, u.length - 400);
}
function fillNames(room, text) {
  const humans = room.active().filter((p) => !p.bot);
  const pool = humans.length ? humans : room.active();
  return text.replace(/\{NAME\}/g, () => pick(pool).name);
}

const mine = (g, pid) => g.prompts.filter((pr) => pr.a === pid || pr.b === pid);
const cur = (g) => g.prompts[g.mi];

function startRound(room, r) {
  room.g.round = r;
  room.g.drafts = {};
  room.phase('z-title', 8, { hostPaced: true, data: { round: r } });
}

function setupWrite(room) {
  const g = room.g;
  const ps = shuffle(room.active());
  const N = ps.length;
  const texts = deal(ZINGER_PROMPTS, N, used(room));
  markUsed(room, texts);
  g.prompts = texts.map((t, i) => ({
    id: i, text: fillNames(room, t), a: ps[i].id, b: ps[(i + 1) % N].id,
    ans: {}, how: {}, votes: {}, res: null,
  }));
  g.prompts = shuffle(g.prompts).map((pr, i) => ({ ...pr, id: i }));
  g.mi = 0;
  room.phase('z-write', WRITE, { input: true, data: { round: g.round } });
  room.botsDo('answer', 2500, 9000);
}

function allWritten(room) {
  const g = room.g;
  return room.needed().every((p) => mine(g, p.id).every((pr) => pr.ans[p.id] != null));
}

function fillMissing(room) {
  const g = room.g;
  for (const pr of g.prompts) {
    for (const id of [pr.a, pr.b]) {
      if (pr.ans[id] != null) continue;
      const d = g.drafts[id + ':' + pr.id];
      pr.ans[id] = d || room.fallback();
      pr.how[id] = d ? 'typed' : 'auto';
    }
  }
}

function startMatch(room) {
  const pr = cur(room.g);
  room.phase('z-match', 30, { hostPaced: true, spot: [pr.a, pr.b], data: { mi: room.g.mi } });
}

function openVote(room) {
  const pr = cur(room.g);
  room.phase('z-vote', VOTE, { timer: true, spot: [pr.a, pr.b] });
  room.botsDo('vote', 1200, 5500, (p) => p.id !== pr.a && p.id !== pr.b);
}

const voters = (room, pr) => room.needed().filter((p) => p.id !== pr.a && p.id !== pr.b);

function tally(room) {
  const g = room.g;
  const pr = cur(g);
  const vs = Object.entries(pr.votes);
  const A = vs.filter(([, s]) => s === 'a').map(([id]) => id);
  const B = vs.filter(([, s]) => s === 'b').map(([id]) => id);
  const total = A.length + B.length;
  const mult = g.round;
  const winner = A.length > B.length ? 'a' : B.length > A.length ? 'b' : 'tie';
  const zing = total >= 2 && (A.length === 0 || B.length === 0);
  const calc = (side, n, id) => {
    let pts = n * 100;
    if (winner === side) pts += 100;
    if (winner === side && zing) pts += 250;
    pts *= mult;
    if (pr.how[id] !== 'typed') pts = Math.round(pts / 2);
    return pts;
  };
  const pa = calc('a', A.length, pr.a);
  const pb = calc('b', B.length, pr.b);
  room.addScore(pr.a, pa);
  room.addScore(pr.b, pb);
  if (zing) room.stat(winner === 'a' ? pr.a : pr.b, 'zings');
  room.stat(pr.a, 'votes', A.length);
  room.stat(pr.b, 'votes', B.length);
  room.quote(pr.ans[pr.a], pr.a, pa, pr.text);
  room.quote(pr.ans[pr.b], pr.b, pb, pr.text);
  pr.res = { A, B, pa, pb, winner, zing, total };
  room.phase('z-result', 22, { hostPaced: true, spot: [pr.a, pr.b] });
}

function setupFinal(room) {
  const g = room.g;
  const [text] = deal(ZINGER_FINALS, 1, used(room));
  markUsed(room, [text]);
  g.final = { text: fillNames(room, text), ans: {}, how: {}, medals: {}, order: [], pts: {}, counts: {} };
  room.phase('z-fwrite', FWRITE, { input: true });
  room.botsDo('final', 2500, 9000);
}

function finalReveal(room) {
  const g = room.g;
  const f = g.final;
  for (const p of room.active()) {
    if (f.ans[p.id] != null) continue;
    const d = g.drafts[p.id + ':final'];
    f.ans[p.id] = d || room.fallback();
    f.how[p.id] = d ? 'typed' : 'auto';
  }
  f.order = shuffle(Object.keys(f.ans));
  room.phase('z-freveal', 8 + 5 * f.order.length, { hostPaced: true });
}

function openFinalVote(room) {
  room.phase('z-fvote', FVOTE, { timer: true });
  room.botsDo('medals', 1500, 7000);
}

const medalsNeeded = (room) => Math.min(3, room.g.final.order.length - 1);

function finalTally(room) {
  const f = room.g.final;
  for (const id of f.order) { f.pts[id] = 0; f.counts[id] = [0, 0, 0]; }
  for (const picks of Object.values(f.medals)) {
    picks.forEach((i, rank) => {
      const id = f.order[i];
      if (id == null) return;
      f.pts[id] += MEDALS[rank];
      f.counts[id][rank]++;
    });
  }
  for (const id of f.order) {
    const pts = f.how[id] === 'typed' ? f.pts[id] : Math.round(f.pts[id] / 2);
    f.pts[id] = pts;
    room.addScore(id, pts);
    room.stat(id, 'votes', f.counts[id][0] + f.counts[id][1] + f.counts[id][2]);
    room.quote(f.ans[id], id, pts, f.text);
  }
  room.phase('z-fresult', 10 + 2.5 * f.order.length, { hostPaced: true });
}

function doAnswer(room, pid, key, text, panic) {
  const g = room.g;
  if (room.phaseName === 'z-write') {
    const pr = g.prompts[key];
    if (!pr || (pr.a !== pid && pr.b !== pid) || pr.ans[pid] != null) return false;
    const t = panic ? room.fallback() : cleanText(text);
    if (!t) return false;
    pr.ans[pid] = t;
    pr.how[pid] = panic ? 'panic' : 'typed';
    room.submitted(pid);
    if (allWritten(room)) { fillMissing(room); startMatch(room); }
    return true;
  }
  if (room.phaseName === 'z-fwrite' && key === 'final') {
    const f = g.final;
    if (f.ans[pid] != null) return false;
    const t = panic ? room.fallback() : cleanText(text);
    if (!t) return false;
    f.ans[pid] = t;
    f.how[pid] = panic ? 'panic' : 'typed';
    room.submitted(pid);
    if (room.needed().every((p) => f.ans[p.id] != null)) finalReveal(room);
    return true;
  }
  return false;
}

function doMedals(room, pid, picks) {
  const f = room.g.final;
  if (room.phaseName !== 'z-fvote' || f.medals[pid]) return false;
  const need = medalsNeeded(room);
  const me = f.order.indexOf(pid);
  if (!Array.isArray(picks)) return false;
  const clean = [...new Set(picks.map(Number))].filter((i) => Number.isInteger(i) && i >= 0 && i < f.order.length && i !== me);
  if (clean.length < Math.min(need, 1)) return false;
  f.medals[pid] = clean.slice(0, need);
  if (room.needed().every((p) => f.medals[p.id] || f.order.indexOf(p.id) < 0)) finalTally(room);
  return true;
}

export default {
  title: 'ZINGER',
  tagline: 'Two players, one prompt. Funniest answer wins.',
  min: 3,
  rules: [
    'Answer two silly prompts on your phone.',
    'Your answer goes head-to-head with another player.',
    'Everyone else votes. Win every vote for a ZING!',
    'Stuck? Hit PANIC for a silly answer at half points.',
  ],

  init(room, opts = {}) {
    return { round: 0, prompts: [], mi: 0, final: null, drafts: {}, quick: !!opts.quick };
  },

  begin(room) { startRound(room, 1); },

  timeout(room) {
    const g = room.g;
    switch (room.phaseName) {
      case 'z-title': return g.round <= 2 ? setupWrite(room) : setupFinal(room);
      case 'z-write': fillMissing(room); return startMatch(room);
      case 'z-match': return openVote(room);
      case 'z-vote': return tally(room);
      case 'z-result':
        g.mi++;
        if (g.mi < g.prompts.length) return startMatch(room);
        return room.phase('z-scores', 9, { hostPaced: true, data: { round: g.round } });
      case 'z-scores': return startRound(room, g.quick && g.round === 1 ? 3 : g.round + 1);
      case 'z-fwrite': return finalReveal(room);
      case 'z-freveal': return openFinalVote(room);
      case 'z-fvote': return finalTally(room);
      case 'z-fresult': return room.finish();
    }
  },

  action(room, pid, m) {
    const g = room.g;
    if (m.a === 'draft') {
      if (room.phaseName !== 'z-write' && room.phaseName !== 'z-fwrite') return 'none';
      g.drafts[pid + ':' + m.key] = cleanText(m.text);
      return 'quiet';
    }
    if (m.a === 'answer') return doAnswer(room, pid, m.key, m.text, !!m.panic) ? 'ok' : 'none';
    if (m.a === 'vote' && room.phaseName === 'z-vote') {
      const pr = cur(g);
      if (pid === pr.a || pid === pr.b || pr.votes[pid] || !['a', 'b'].includes(m.side)) return 'none';
      pr.votes[pid] = m.side;
      if (voters(room, pr).every((p) => pr.votes[p.id])) tally(room);
      return 'ok';
    }
    if (m.a === 'medals') return doMedals(room, pid, m.picks) ? 'ok' : 'none';
    return 'none';
  },

  bot(room, { pid, kind }) {
    const g = room.g;
    if (kind === 'answer' && room.phaseName === 'z-write') {
      for (const pr of mine(g, pid)) {
        if (pr.ans[pid] != null) continue;
        const other = pr.ans[pr.a === pid ? pr.b : pr.a];
        let t = room.fallback();
        for (let i = 0; i < 5 && t === other; i++) t = room.fallback();
        doAnswer(room, pid, pr.id, t, false);
      }
    }
    if (kind === 'final') doAnswer(room, pid, 'final', room.fallback(), false);
    if (kind === 'vote' && room.phaseName === 'z-vote') this.action(room, pid, { a: 'vote', side: Math.random() < 0.5 ? 'a' : 'b' });
    if (kind === 'medals' && room.phaseName === 'z-fvote') {
      const me = g.final.order.indexOf(pid);
      const opts = shuffle(g.final.order.map((_, i) => i).filter((i) => i !== me));
      doMedals(room, pid, opts);
    }
  },

  hostView(room) {
    const g = room.g;
    const ph = room.phaseName;
    const v = { round: g.round, mi: g.mi, of: g.prompts.length, quick: !!g.quick };
    if (ph === 'z-write') {
      v.done = room.active().filter((p) => mine(g, p.id).every((pr) => pr.ans[p.id] != null)).map((p) => p.id);
    }
    if (['z-match', 'z-vote', 'z-result'].includes(ph)) {
      const pr = cur(g);
      v.prompt = pr.text;
      v.A = pr.ans[pr.a];
      v.B = pr.ans[pr.b];
      if (ph === 'z-vote') {
        v.voters = voters(room, pr).map((p) => p.id);
        v.voted = Object.keys(pr.votes);
      }
      if (ph === 'z-result') {
        v.res = pr.res;
        v.a = pr.a; v.b = pr.b;
        v.howA = pr.how[pr.a]; v.howB = pr.how[pr.b];
      }
    }
    if (g.final && ['z-fwrite', 'z-freveal', 'z-fvote', 'z-fresult'].includes(ph)) {
      const f = g.final;
      v.prompt = f.text;
      if (ph === 'z-fwrite') v.done = Object.keys(f.ans);
      if (ph !== 'z-fwrite') v.answers = f.order.map((id) => f.ans[id]);
      if (ph === 'z-fvote') { v.voted = Object.keys(f.medals); v.voters = room.needed().map((p) => p.id); }
      if (ph === 'z-fresult') {
        v.results = f.order.map((id, i) => ({ id, text: f.ans[id], pts: f.pts[id], counts: f.counts[id], how: f.how[id], i }))
          .sort((a, b) => a.pts - b.pts);
      }
    }
    return v;
  },

  playerView(room, pid) {
    const g = room.g;
    const ph = room.phaseName;
    if (ph === 'z-write') {
      return { prompts: mine(g, pid).map((pr) => ({ key: pr.id, text: pr.text, done: pr.ans[pid] != null })) };
    }
    if (ph === 'z-fwrite') {
      return { prompts: [{ key: 'final', text: g.final.text, done: g.final.ans[pid] != null }] };
    }
    if (ph === 'z-vote') {
      const pr = cur(g);
      return { prompt: pr.text, A: pr.ans[pr.a], B: pr.ans[pr.b], author: pid === pr.a || pid === pr.b, voted: pr.votes[pid] || null };
    }
    if (ph === 'z-fvote') {
      const f = g.final;
      const me = f.order.indexOf(pid);
      return {
        prompt: f.text, need: medalsNeeded(room), done: !!f.medals[pid],
        answers: f.order.map((id, i) => ({ i, text: f.ans[id] })).filter((a) => a.i !== me),
      };
    }
    return {};
  },

  awards(room, st, best) {
    const z = best((id) => st(id).zings || null);
    const out = [];
    if (z) out.push({ title: 'ZING MACHINE', icon: '⚡', id: z.id, detail: `${z.v} unanimous ZING${z.v > 1 ? 's' : ''}` });
    const v = best((id) => st(id).votes || null);
    if (v) out.push({ title: 'PEOPLE\'S CHAMP', icon: '🗳️', id: v.id, detail: `${v.v} votes collected` });
    return out;
  },
};

import { FAKER_TASKS } from '../content.js';
import { shuffle, deal } from '../util.js';

const CATS = ['hands', 'point', 'fingers', 'face'];
const TASK = 12, DISCUSS = 60, VOTE = 25;

function startCase(room) {
  const g = room.g;
  const c = g.cases[g.ci];
  c.strikes = 0;
  c.tasks = [];
  c.over = false;
  room.phase('f-cat', 9, { hostPaced: true, data: { cat: c.cat, n: g.ci + 1, of: g.cases.length } });
}

function newTask(room) {
  const g = room.g;
  const c = g.cases[g.ci];
  const pool = FAKER_TASKS[c.cat].tasks;
  room.s.used ??= [];
  const [text] = deal(pool, 1, room.s.used);
  room.s.used.push(text);
  g.task = { text, ready: {}, votes: {}, res: null };
  room.phase('f-task', TASK, { input: true, data: { cat: c.cat, strike: c.strikes } });
  room.botsDo('ready', 800, 3000);
}

function tally(room) {
  const g = room.g;
  const c = g.cases[g.ci];
  const t = g.task;
  const counts = {};
  for (const target of Object.values(t.votes)) counts[target] = (counts[target] || 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  const top = Object.keys(counts).filter((id) => counts[id] === max);
  const accused = max > 0 && top.length === 1 ? top[0] : null;
  const caught = accused === c.faker;
  const pts = {};
  const add = (id, n) => { pts[id] = (pts[id] || 0) + n; room.addScore(id, n); };
  for (const [voter, target] of Object.entries(t.votes)) {
    if (voter === c.faker) continue;
    if (target === c.faker) {
      add(voter, 250);
      room.stat(voter, 'sharp');
      if (caught) add(voter, 500);
    }
  }
  if (!caught) {
    c.strikes++;
    add(c.faker, 500);
  }
  const escaped = !caught && c.strikes >= 3;
  if (escaped) { add(c.faker, 1000); room.stat(c.faker, 'escapes'); room.quote(`Escaped as the Faker in "${FAKER_TASKS[c.cat].label}"`, c.faker, 1500 + 1000, 'MASTER OF DISGUISE'); }
  if (caught) room.stat(c.faker, 'caught');
  c.over = caught || escaped;
  c.tasks.push(t.text);
  t.res = { counts, accused, tie: max > 0 && top.length > 1, none: max === 0, caught, escaped, strikes: c.strikes, pts };
  room.phase('f-result', 16, { hostPaced: true, spot: accused ? [accused] : [] });
}

export default {
  title: 'FAKER AMONG US',
  tagline: 'Everyone gets a secret task… except the Faker.',
  min: 3,
  rules: [
    'Everyone gets a secret task on their phone. One player is the FAKER and doesn\'t.',
    'When the TV says DO IT NOW, everyone acts at once. Then FREEZE!',
    'Argue about who faked it, then vote.',
    'Three wrong guesses and the Faker escapes!',
  ],

  init(room) {
    const ids = shuffle(room.active().map((p) => p.id));
    const humans = ids.filter((id) => !room.s.players[id].bot);
    const pool = humans.length >= 3 ? shuffle(humans) : ids;
    const chosen = shuffle(CATS).slice(0, 3);
    const cases = chosen.map((cat, i) => ({ cat, faker: pool[i % pool.length], strikes: 0, tasks: [], over: false }));
    return { cases, ci: 0, task: null };
  },

  begin(room) { startCase(room); },

  timeout(room) {
    const g = room.g;
    switch (room.phaseName) {
      case 'f-cat': return newTask(room);
      case 'f-task': return room.phase('f-count', 7, { hostPaced: true });
      case 'f-count': return room.phase('f-freeze', 4.5);
      case 'f-freeze': return room.phase('f-discuss', DISCUSS, { timer: true });
      case 'f-discuss':
        room.phase('f-vote', VOTE, { timer: true });
        room.botsDo('vote', 1500, 6000);
        return;
      case 'f-vote': return tally(room);
      case 'f-result': {
        const c = g.cases[g.ci];
        if (!c.over) return newTask(room);
        g.ci++;
        if (g.ci < g.cases.length) return room.phase('f-scores', 9, { hostPaced: true });
        return room.finish();
      }
      case 'f-scores': return startCase(room);
    }
  },

  action(room, pid, m) {
    const g = room.g;
    const ph = room.phaseName;
    if (m.a === 'ready' && ph === 'f-task' && !g.task.ready[pid]) {
      g.task.ready[pid] = true;
      if (room.needed().every((p) => g.task.ready[p.id])) room.phase('f-count', 7, { hostPaced: true });
      return 'ok';
    }
    if (m.a === 'start-vote' && ph === 'f-discuss' && room.vipId() === pid) {
      this.timeout(room);
      return 'ok';
    }
    if (m.a === 'vote' && ph === 'f-vote' && !g.task.votes[pid] && m.target !== pid && room.s.players[m.target]?.inGame) {
      g.task.votes[pid] = m.target;
      room.submitted(pid);
      if (room.needed().every((p) => g.task.votes[p.id])) tally(room);
      return 'ok';
    }
    return 'none';
  },

  bot(room, { pid, kind }) {
    if (kind === 'ready') this.action(room, pid, { a: 'ready' });
    if (kind === 'vote') {
      const others = room.active().filter((p) => p.id !== pid);
      const t = others[Math.floor(Math.random() * others.length)];
      if (t) this.action(room, pid, { a: 'vote', target: t.id });
    }
  },

  hostView(room) {
    const g = room.g;
    const c = g.cases[g.ci];
    const ph = room.phaseName;
    if (!c) return {};
    const cat = FAKER_TASKS[c.cat];
    const v = { cat: c.cat, label: cat.label, how: cat.how, n: g.ci + 1, of: g.cases.length, strikes: c.strikes };
    if (ph === 'f-task') v.ready = Object.keys(g.task.ready);
    // The task is only revealed on the TV once everyone has frozen.
    if (['f-discuss', 'f-vote', 'f-result'].includes(ph)) v.task = g.task.text;
    if (ph === 'f-vote') { v.voted = Object.keys(g.task.votes); v.voters = room.needed().map((p) => p.id); }
    if (ph === 'f-result') {
      v.res = g.task.res;
      v.votes = g.task.votes;
      if (g.task.res.caught || g.task.res.escaped) v.faker = c.faker;
    }
    return v;
  },

  playerView(room, pid) {
    const g = room.g;
    const c = g.cases[g.ci];
    const ph = room.phaseName;
    if (!c) return {};
    const cat = FAKER_TASKS[c.cat];
    const isFaker = c.faker === pid;
    const base = { cat: c.cat, label: cat.label, how: cat.how, isFaker };
    if (ph === 'f-task' || ph === 'f-count' || ph === 'f-freeze') {
      return { ...base, task: isFaker ? null : g.task.text, ready: !!g.task.ready[pid] };
    }
    if (ph === 'f-discuss') return { ...base, task: isFaker ? null : g.task.text };
    if (ph === 'f-vote') {
      return {
        ...base, voted: g.task.votes[pid] || null,
        options: room.active().filter((p) => p.id !== pid).map((p) => ({ id: p.id, name: p.name, color: p.color })),
      };
    }
    if (ph === 'f-result') return { ...base, res: { caught: g.task.res.caught, escaped: g.task.res.escaped } };
    return base;
  },

  awards(room, st, best) {
    const out = [];
    const bluff = best((id) => st(id).escapes || null);
    if (bluff) out.push({ title: 'MASTER BLUFF', icon: '🎭', id: bluff.id, detail: 'escaped as the Faker' });
    const eye = best((id) => st(id).sharp || null);
    if (eye) out.push({ title: 'SHARP EYE', icon: '🔍', id: eye.id, detail: `pointed at the real Faker ${eye.v} time${eye.v > 1 ? 's' : ''}` });
    return out;
  },
};

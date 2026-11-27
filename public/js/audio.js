// Couch Chaos sound engine: everything is synthesized with Web Audio. No files to 404.
let ctx, master, musicBus, sfxBus, noiseBuf, comp;
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

const THEMES = {
  lobby: {
    bpm: 106, root: 53, swing: 0.12,
    prog: [[0, 'maj7'], [5, 'maj7'], [-3, 'm7'], [2, 'm7']],
    bass: [0, null, null, 12, null, 0, 7, null, 0, null, 10, null, 12, 7, null, 5],
    kick: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1],
    hat: [1, 0, 1, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 0, 1, 0],
    stab: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
    stabWave: 'square', bell: true,
  },
  zinger: {
    bpm: 116, root: 45, swing: 0.08,
    prog: [[0, 'm7'], [0, 'm7'], [5, 'm7'], [7, '7']],
    bass: [0, null, 12, 0, null, 0, 10, null, 0, 12, null, 7, null, 10, 12, null],
    kick: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    stab: [0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1],
    stabWave: 'sawtooth',
  },
  hunch: {
    bpm: 112, root: 50, swing: 0,
    prog: [[0, 'maj7'], [-2, 'maj7'], [-5, 'maj7'], [-3, 'm7']],
    bass: [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, 7, 12, 10],
    kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1],
    stab: [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0],
    stabWave: 'triangle', bell: true,
  },
  faker: {
    bpm: 94, root: 52, swing: 0.22,
    prog: [[0, 'm7'], [0, 'm7'], [-4, 'maj7'], [-5, '7']],
    bass: [0, null, null, 7, null, null, 10, null, 0, null, 3, null, 5, null, 7, null],
    kick: [1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0],
    snare: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    hat: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    stab: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0],
    stabWave: 'sawtooth',
  },
};
const CHORDS = { maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], 7: [0, 4, 7, 10] };

function noiseSrc(t, dur) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.start(t, Math.random() * 0.5);
  s.stop(t + dur + 0.05);
  return s;
}
function gainEnv(t, a, peak, d, dest) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  g.connect(dest);
  return g;
}
function tone(type, f, t, a, peak, d, dest, f2) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + d);
  const g = gainEnv(t, a, peak, d, dest);
  o.connect(g);
  o.start(t);
  o.stop(t + a + d + 0.05);
  return o;
}
function filt(type, f, q, dest) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  if (q) b.Q.value = q;
  b.connect(dest);
  return b;
}

// --- drum + synth voices (music) ---
function kick(t, dest = musicBus, vol = 0.9) {
  tone('sine', 150, t, 0.003, vol, 0.32, dest, 42);
}
function snare(t, dest = musicBus, vol = 0.35) {
  const f = filt('highpass', 1200, 0, gainEnv(t, 0.002, vol, 0.16, dest));
  noiseSrc(t, 0.2).connect(f);
  tone('triangle', 200, t, 0.002, vol * 0.6, 0.08, dest, 140);
}
function hat(t, dest = musicBus, vol = 0.12) {
  const f = filt('highpass', 7500, 0, gainEnv(t, 0.001, vol, 0.035, dest));
  noiseSrc(t, 0.06).connect(f);
}
function bass(t, midi, len) {
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = mtof(midi);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 6;
  lp.frequency.setValueAtTime(1400, t);
  lp.frequency.exponentialRampToValueAtTime(220, t + len);
  const g = gainEnv(t, 0.005, 0.42, len, musicBus);
  o.connect(lp);
  lp.connect(g);
  o.start(t);
  o.stop(t + len + 0.1);
}
function stab(t, midis, len, wave) {
  const lp = filt('lowpass', wave === 'triangle' ? 3000 : 1900, 1, gainEnv(t, 0.006, 0.1, len, musicBus));
  for (const m of midis) {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = wave;
      o.frequency.value = mtof(m);
      o.detune.value = det;
      o.connect(lp);
      o.start(t);
      o.stop(t + len + 0.1);
    }
  }
}
function bell(t, midi) {
  tone('sine', mtof(midi), t, 0.003, 0.08, 0.5, musicBus);
  tone('sine', mtof(midi) * 2.01, t, 0.003, 0.03, 0.3, musicBus);
}

// --- scheduler ---
const seq = { step: 0, next: 0, timer: null };
function scheduler() {
  const th = THEMES[audio.theme] || THEMES.lobby;
  const bpm = th.bpm * (audio.urgent ? 1.2 : 1);
  const trans = audio.urgent ? 2 : 0;
  const sd = 60 / bpm / 4;
  if (seq.next < ctx.currentTime - 0.5) seq.next = ctx.currentTime + 0.05;
  while (seq.next < ctx.currentTime + 0.12) {
    const s = seq.step % 16;
    const bar = Math.floor(seq.step / 16) % 4;
    const t = seq.next + (s % 2 ? th.swing * sd : 0);
    if (audio.musicOn && !audio.silent) {
      const [cr, q] = th.prog[bar];
      const root = th.root + cr + trans;
      if (th.kick[s]) kick(t);
      if (th.snare[s]) snare(t);
      if (th.hat[s]) hat(t, musicBus, s % 4 === 2 ? 0.16 : 0.08);
      if (audio.urgent && s % 2 === 1) hat(t, musicBus, 0.07);
      const b = th.bass[s];
      if (b != null) bass(t, root - 12 + b, sd * 1.6);
      if (th.stab[s]) stab(t, CHORDS[q].map((n) => root + 12 + n), sd * 1.2, th.stabWave);
      if (th.bell && s === 0 && bar % 2 === 0) bell(t, root + 24 + CHORDS[q][2]);
      if (th.bell && s === 10) bell(t, root + 24 + CHORDS[q][3]);
    }
    seq.next += sd;
    seq.step++;
  }
}

function crash(t, vol = 0.35, dur = 1.4) {
  const f = filt('highpass', 4500, 0, gainEnv(t, 0.002, vol, dur, sfxBus));
  noiseSrc(t, dur + 0.1).connect(f);
}
function brass(t, midis, len, vol = 0.12) {
  for (const m of midis) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = mtof(m);
    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = mtof(m) * 1.004;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2;
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.exponentialRampToValueAtTime(3500, t + 0.06);
    lp.frequency.exponentialRampToValueAtTime(1400, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.03);
    g.gain.setValueAtTime(vol, t + len * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(lp); o2.connect(lp); lp.connect(g); g.connect(sfxBus);
    o.start(t); o2.start(t); o.stop(t + len + 0.05); o2.stop(t + len + 0.05);
  }
}

export const audio = {
  unlocked: false,
  musicOn: true,
  voiceOn: true,
  theme: 'lobby',
  urgent: false,
  silent: false,

  unlock() {
    if (this.unlocked) { ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(comp);
    comp.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0.3;
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    ctx.resume();
    seq.next = ctx.currentTime + 0.1;
    seq.timer = setInterval(scheduler, 25);
    this.unlocked = true;
    // a tiny "speech warm-up" so the voice is allowed too
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch {}
  },

  setTheme(name) { if (THEMES[name]) this.theme = name; },
  setUrgent(on) { this.urgent = !!on; },
  setMusic(on) { this.musicOn = on; },
  musicVol: 0.3,
  setMusicVol(pct) {
    this.musicVol = Math.max(0, Math.min(1, pct / 100)) * 0.5;
    if (ctx && musicBus) musicBus.gain.setTargetAtTime(this.musicVol, ctx.currentTime, 0.05);
  },
  duck(on) {
    if (!ctx) return;
    musicBus.gain.setTargetAtTime(on ? this.musicVol * 0.33 : this.musicVol, ctx.currentTime, 0.08);
  },
  hush(on) { this.silent = on; },

  get t() { return ctx ? ctx.currentTime + 0.01 : 0; },
  ok() { return this.unlocked && ctx && ctx.state === 'running'; },

  pop(n = 0) {
    if (!this.ok()) return;
    const t = this.t;
    const f = 520 * Math.pow(2, ((n * 2) % 14) / 12);
    tone('sine', f, t, 0.004, 0.5, 0.13, sfxBus, f * 1.9);
    tone('triangle', f * 2, t + 0.06, 0.004, 0.18, 0.12, sfxBus);
  },
  thwump() {
    if (!this.ok()) return;
    const t = this.t;
    tone('sine', 220, t, 0.003, 0.9, 0.22, sfxBus, 45);
    const f = filt('lowpass', 500, 0, gainEnv(t, 0.002, 0.5, 0.18, sfxBus));
    noiseSrc(t, 0.25).connect(f);
    const h = filt('bandpass', 2500, 2, gainEnv(t + 0.02, 0.01, 0.12, 0.12, sfxBus));
    noiseSrc(t, 0.2).connect(h);
  },
  whoosh(dur = 0.4) {
    if (!this.ok()) return;
    const t = this.t;
    const b = ctx.createBiquadFilter();
    b.type = 'bandpass';
    b.Q.value = 1.4;
    b.frequency.setValueAtTime(250, t);
    b.frequency.exponentialRampToValueAtTime(4500, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    noiseSrc(t, dur + 0.1).connect(b);
    b.connect(g);
    g.connect(sfxBus);
  },
  slam() {
    if (!this.ok()) return;
    const t = this.t;
    kick(t, sfxBus, 1);
    const f = filt('lowpass', 2500, 0, gainEnv(t, 0.001, 0.5, 0.12, sfxBus));
    noiseSrc(t, 0.15).connect(f);
  },
  tick(hi = false) {
    if (!this.ok()) return;
    const t = this.t;
    const f = hi ? 1250 : 880;
    tone('sine', f, t, 0.001, 0.45, 0.06, sfxBus);
    const b = filt('bandpass', f * 1.5, 9, gainEnv(t, 0.001, 0.5, 0.03, sfxBus));
    noiseSrc(t, 0.05).connect(b);
  },
  ding() {
    if (!this.ok()) return;
    const t = this.t;
    tone('sine', 1568, t, 0.003, 0.35, 0.9, sfxBus);
    tone('sine', 3136, t, 0.003, 0.1, 0.5, sfxBus);
  },
  chime() {
    if (!this.ok()) return;
    const t = this.t;
    [72, 76, 79, 84].forEach((m, i) => {
      tone('sine', mtof(m), t + i * 0.08, 0.003, 0.3, 0.8, sfxBus);
      tone('triangle', mtof(m + 12), t + i * 0.08, 0.003, 0.06, 0.4, sfxBus);
    });
  },
  beep(hi = false) {
    if (!this.ok()) return;
    const t = this.t;
    const f = hi ? 1320 : 660;
    const lp = filt('lowpass', 3000, 0, gainEnv(t, 0.004, 0.3, hi ? 0.6 : 0.2, sfxBus));
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = f;
    o.connect(lp);
    o.start(t);
    o.stop(t + 0.8);
  },
  doItNow() {
    if (!this.ok()) return;
    const t = this.t;
    brass(t, [60, 64, 67, 72], 0.7, 0.13);
    kick(t, sfxBus, 1);
    crash(t, 0.4, 1.2);
    [84, 88, 91].forEach((m, i) => tone('sine', mtof(m), t + i * 0.05, 0.003, 0.25, 0.9, sfxBus));
  },
  drumroll(sec = 2) {
    if (!this.ok()) return;
    const t0 = this.t;
    let t = t0;
    let gap = 0.09;
    while (t < t0 + sec) {
      const k = (t - t0) / sec;
      snare(t, sfxBus, 0.08 + 0.25 * k);
      t += gap;
      gap = Math.max(0.035, gap * 0.97);
    }
    kick(t0 + sec, sfxBus, 1);
    crash(t0 + sec, 0.45, 1.6);
  },
  fanfare() {
    if (!this.ok()) return;
    const t = this.t;
    const n = [[67], [67], [67], [72, 76, 79]];
    const times = [0, 0.14, 0.28, 0.46];
    n.forEach((ns, i) => brass(t + times[i], ns.concat(ns.map((x) => x - 12)), i === 3 ? 1.6 : 0.13, 0.1));
    brass(t + 1.0, [74, 77, 81], 0.25, 0.09);
    brass(t + 1.3, [72, 76, 79, 84], 1.8, 0.1);
    [0.46, 1.3].forEach((d) => { kick(t + d, sfxBus, 1); crash(t + d, 0.35, 2); });
  },
  zing() {
    if (!this.ok()) return;
    const t = this.t;
    tone('sine', 500, t, 0.005, 0.3, 0.35, sfxBus, 2800);
    brass(t + 0.12, [70, 74, 77], 0.16, 0.12);
    brass(t + 0.32, [72, 76, 79, 84], 1.2, 0.13);
    kick(t + 0.32, sfxBus, 1);
    crash(t + 0.32, 0.5, 1.8);
  },
  buzzer() {
    if (!this.ok()) return;
    const t = this.t;
    const lp = filt('lowpass', 900, 0, gainEnv(t, 0.01, 0.35, 0.8, sfxBus));
    for (const f of [98, 104]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 0.9);
    }
  },
  stamp() {
    if (!this.ok()) return;
    const t = this.t;
    kick(t, sfxBus, 1);
    tone('square', 90, t, 0.002, 0.3, 0.12, sfxBus, 50);
    const f = filt('lowpass', 1200, 0, gainEnv(t, 0.001, 0.6, 0.1, sfxBus));
    noiseSrc(t, 0.12).connect(f);
  },
  rise(sec = 4) {
    if (!this.ok()) return;
    const t = this.t;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(900, t + sec);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + sec * 0.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + sec + 0.05);
    o.connect(g);
    g.connect(sfxBus);
    o.start(t);
    o.stop(t + sec + 0.1);
  },
};

// ---------------- Voice ----------------
let bestVoice = null;
function scoreVoice(v) {
  if (!/^en/i.test(v.lang)) return -1;
  let s = 0;
  if (/natural|neural|online/i.test(v.name)) s += 60;
  if (/premium|enhanced/i.test(v.name)) s += 45;
  if (/Google US English|Samantha|Ava|Allison|Zoe|Evan|Nathan|Aria|Jenny|Guy|Daniel|Serena|Karen|Moira/i.test(v.name)) s += 30;
  if (/en[-_]US/i.test(v.lang)) s += 10;
  if (/Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Wobble|Whisper|Zarvox|Trinoids|Jester|Organ|Superstar|Grandma|Grandpa|Junior|Ralph|Fred/i.test(v.name)) s -= 100;
  return s;
}
function loadVoices() {
  try {
    const vs = speechSynthesis.getVoices();
    if (!vs.length) return;
    bestVoice = [...vs].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
  } catch {}
}
if ('speechSynthesis' in window) {
  loadVoices();
  speechSynthesis.onvoiceschanged = loadVoices;
}
export const voiceName = () => (bestVoice ? bestVoice.name : 'none');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export { wait };

export function say(text, { rate = 1.02, pitch = 1 } = {}) {
  const words = String(text).split(/\s+/).length;
  const est = 500 + words * 330;
  if (!audio.voiceOn || !audio.unlocked || !('speechSynthesis' in window)) return wait(Math.min(est * 0.55, 2500));
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      audio.duck(false);
      resolve();
    };
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (bestVoice) u.voice = bestVoice;
      u.rate = rate;
      u.pitch = pitch;
      u.onend = finish;
      u.onerror = finish;
      audio.duck(true);
      speechSynthesis.speak(u);
      setTimeout(finish, est * 1.8 + 2000);
    } catch {
      finish();
    }
  });
}
export function hushVoice() {
  try { speechSynthesis.cancel(); } catch {}
  audio.duck(false);
}

// Every sound is synthesised, no samples. Tune by ear on the real speakers.
const MIX = {
  master: 0.9,
  ticks: 2.6,
  bells: 0.38,
  heart: 1.0,
  cuckoo: 0.32,
  alarm: 0.13,
  room: 0.3, // small panelled room, on everything close
  hall: 0.6, // stone tower, mostly on the church bells
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];

// Stereo noise tail. `dark` sets how fast the highs die: low for a bright room, high for stone.
function impulse(ctx, seconds, dark) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len, k = dark + (0.98 - dark) * t;
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * (1 - t) ** 2.4 * (1.2 + 2 * dark);
    }
    // a few early reflections off nearby walls
    for (let r = 0; r < 7; r++) {
      const at = Math.floor(ctx.sampleRate * (0.003 + Math.random() * 0.03));
      d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - r * 0.06);
    }
  }
  return buf;
}

// Escapement voices. click: where the pallet impact rings, body: the case, metal: the steel parts.
const VOICES = {
  longcase: { click: 2100, body: 190, metal: 1350, level: 0.55, len: 1.5, gap: 0.016 },
  wall: { click: 3300, body: 430, metal: 2450, level: 0.36, len: 1.0, gap: 0.011 },
  mantel: { click: 4300, body: 760, metal: 3600, level: 0.27, len: 0.8, gap: 0.008 },
  pocket: { click: 6800, body: 1700, metal: 5600, level: 0.18, len: 0.5, gap: 0.005 },
};
// Seconds per beat of each movement
export const BEAT = { longcase: 1, wall: 0.5, mantel: 0.5, pocket: 0.2 };

// Partials as [ratio to the prime, level, decay seconds].
// Church bell: hum, prime, minor-third tierce, quint, nominal and the bright upper set.
const BELL = [[0.5, 0.5, 4], [1, 0.45, 2.8], [1.183, 0.45, 2.1], [1.506, 0.18, 1.5], [2, 0.5, 1.2],
  [2.514, 0.2, 0.75], [2.662, 0.16, 0.65], [3.011, 0.14, 0.5], [4.166, 0.08, 0.32], [5.433, 0.05, 0.2]];
// Gong rod in a mantel clock: a free bar, so the overtones are inharmonic
const ROD = [[1, 0.6, 2.4], [2.756, 0.35, 1.0], [5.404, 0.16, 0.45], [8.933, 0.07, 0.2]];
// Small alarm-clock dome
const DOME = [[1, 0.5, 0.45], [2.32, 0.25, 0.2], [4.25, 0.12, 0.08]];

// Westminster quarters (E major), as Big Ben plays them; the hour bell is E3
const NOTE = { 'G#': 415.3, 'F#': 369.99, E: 329.63, B: 246.94 };
const QUARTERS = [['G#', 'F#', 'E', 'B'], ['E', 'G#', 'F#', 'B'], ['E', 'F#', 'G#', 'E'], ['G#', 'E', 'F#', 'B'], ['B', 'F#', 'G#', 'E']];

export function createAudio(ctx = new AudioContext({ latencyHint: 'interactive' })) {
  const nyq = ctx.sampleRate / 2;
  const gain = (v, ...to) => {
    const g = ctx.createGain();
    g.gain.value = v;
    to.forEach((n) => g.connect(n));
    return g;
  };
  const osc = (type, f) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    return o;
  };
  const filter = (type, f, q = 0.7) => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = Math.min(f, nyq * 0.95);
    b.Q.value = q;
    return b;
  };
  // Run fn when the audio clock reaches t (for visuals that follow the sound)
  const at = (t, fn) => fn && setTimeout(fn, Math.max(0, (t - ctx.currentTime) * 1000));

  // Master: gentle glue, then a hard limiter so a pile-up never clips
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.2;
  limiter.connect(ctx.destination);
  const glue = ctx.createDynamicsCompressor();
  glue.threshold.value = -20;
  glue.ratio.value = 2.5;
  glue.attack.value = 0.004;
  glue.release.value = 0.3;
  glue.connect(limiter);
  const master = gain(MIX.master, glue);
  const room = ctx.createConvolver();
  room.buffer = impulse(ctx, 0.9, 0.12);
  room.connect(gain(MIX.room, master));
  const hall = ctx.createConvolver();
  hall.buffer = impulse(ctx, 6, 0.55);
  hall.connect(gain(MIX.hall, master));

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  noise.getChannelData(0).forEach((_, i, d) => (d[i] = Math.random() * 2 - 1));

  // One channel strip per screen position and kind, so each clock's sound comes from where it hangs
  const SENDS = { tick: [1, 0.9, 0.06], near: [1, 0.8, 0.25], bell: [0.3, 0.3, 1], heart: [1, 0.12, 0] };
  const strips = new Map();
  function strip(pan, kind) {
    const key = `${kind}${pan.toFixed(2)}`;
    if (!strips.has(key)) {
      const [dry, toRoom, toHall] = SENDS[kind];
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -0.9, 0.9);
      p.connect(gain(dry, master));
      p.connect(gain(toRoom, room));
      if (toHall) p.connect(gain(toHall, hall));
      strips.set(key, p);
    }
    return strips.get(key);
  }

  function env(t, level, decay, attack = 0.0006) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + attack);
    g.gain.setTargetAtTime(0, t + attack, decay);
    return g;
  }
  // Filtered noise hit. Level is normalised to the band, so a narrow filter isn't silent.
  function burst(t, dest, type, f, q, level, decay) {
    const band = type === 'bandpass' ? f / q : f;
    const norm = type === 'highpass' ? 1 : Math.min(30, Math.sqrt(nyq / band));
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.connect(filter(type, f, q)).connect(env(t, level * norm, decay)).connect(dest);
    s.start(t, Math.random() * 1.5, decay * 8 + 0.01);
  }
  function ring(t, dest, f, level, decay, attack = 0.002) {
    if (f >= nyq * 0.9) return;
    const o = osc('sine', f);
    o.connect(env(t, level, decay, attack)).connect(dest);
    o.start(t);
    o.stop(t + attack + decay * 7);
  }

  // One beat of an escapement: the pallet unlocks, the tooth drops, steel rings, the case answers.
  function tick(pan, voice, tock, delay = 0) {
    const v = VOICES[voice], out = strip(pan, 'tick');
    const t = ctx.currentTime + 0.02 + delay + Math.random() * 0.002;
    const k = (tock ? 0.92 : 1.04) * (1 + (Math.random() - 0.5) * 0.04);
    const L = v.level * MIX.ticks * (tock ? 0.82 : 1) * (0.85 + Math.random() * 0.3);
    burst(t - v.gap, out, 'bandpass', v.click * 1.4 * k, 2.5, L * 0.2, 0.0008 * v.len);
    burst(t, out, 'bandpass', v.click * k, 1.4, L, 0.0016 * v.len);
    burst(t, out, 'highpass', v.click * 1.8 * k, 0.7, L * 0.35, 0.0006 * v.len);
    [[1, 0.25], [2.756, 0.12], [5.404, 0.06]].forEach(([m, a], i) =>
      ring(t, out, v.metal * k * m, L * a, (0.014 * v.len) / (i + 1), 0.0004));
    burst(t, out, 'bandpass', v.body * k, 5, L * 0.55, 0.018 * v.len);
    ring(t + 0.001, out, v.body * 0.62 * k, L * 0.2, 0.03 * v.len);
  }

  // Each partial is a slightly split pair, which gives a real bell its slow warble
  function strike(t, f, partials, level, out, size = 1) {
    for (const [r, a, d] of partials) {
      for (const side of [-1, 1]) ring(t, out, f * r + side * 0.3 * Math.sqrt(r), level * a * 0.5, d * size, 0.0015);
    }
    burst(t, out, 'highpass', 1800, 0.7, level * 0.1, 0.005); // clapper
    burst(t, out, 'bandpass', f * 6.3, 2, level * 0.06, 0.05); // clang
  }

  // A quarter phrase, then the hours on the big bell. Returns seconds until it is over.
  function chime({ pan, hours = 0, church = true, onStrike }) {
    const out = strip(pan, church ? 'bell' : 'near');
    const parts = church ? BELL : ROD, oct = church ? 1 : 2, lvl = MIX.bells * (church ? 1 : 0.7);
    let t = ctx.currentTime + 0.05;
    pick(QUARTERS).forEach((n, i) => {
      strike(t, NOTE[n] * oct, parts, lvl * (0.9 + Math.random() * 0.2), out, church ? 1 : 0.8);
      at(t, onStrike);
      t += i === 3 ? 1.6 : 0.72;
    });
    for (let i = 0; i < hours; i++) {
      t += 0.4;
      strike(t, (NOTE.E / 2) * oct, parts, lvl * 1.2, out, church ? 1.5 : 1);
      at(t, onStrike);
      t += 1.6;
    }
    return t - ctx.currentTime + 3;
  }

  // Two light strikes on a gong rod: a countdown has run out
  function ding(pan) {
    const out = strip(pan, 'near'), t = ctx.currentTime + 0.02;
    strike(t, 880, ROD, MIX.bells * 0.35, out, 0.6);
    strike(t + 0.16, 880, ROD, MIX.bells * 0.25, out, 0.6);
  }

  // A small flue pipe, like the two in a cuckoo clock's bellows
  function pipe(t, f, dur, out, level) {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.03);
    g.gain.setValueAtTime(level, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.03);
    g.connect(out);
    for (const [h, a] of [[1, 1], [2, 0.22], [3, 0.08]]) {
      const o = osc('sine', f * h);
      o.frequency.setValueAtTime(f * h * 0.985, t); // pipes speak slightly flat, then settle
      o.frequency.exponentialRampToValueAtTime(f * h, t + 0.045);
      o.connect(gain(a, g));
      o.start(t);
      o.stop(t + dur + 0.3);
    }
    const air = ctx.createBufferSource();
    air.buffer = noise;
    air.connect(filter('bandpass', f, 8)).connect(gain(0.05 * Math.sqrt((nyq * 8) / f), g));
    air.start(t, Math.random(), dur + 0.3);
    burst(t, out, 'bandpass', f * 2.5, 2, level * 0.25, 0.012); // chiff at the pipe mouth
  }

  function cuckoo({ pan, calls }) {
    const out = strip(pan, 'near');
    let t = ctx.currentTime + 0.05;
    burst(t, out, 'bandpass', 1100, 3, 0.2, 0.008); // the little door
    burst(t, out, 'bandpass', 260, 4, 0.25, 0.02);
    t += 0.3;
    for (let i = 0; i < calls; i++) {
      burst(t - 0.05, out, 'lowpass', 220, 0.7, 0.2, 0.03); // bellows drop
      pipe(t, 740, 0.2, out, MIX.cuckoo);
      pipe(t + 0.32, 587, 0.42, out, MIX.cuckoo * 0.9);
      t += 1.05;
    }
    burst(t, out, 'bandpass', 1000, 3, 0.2, 0.008);
    return t - ctx.currentTime + 1;
  }

  // Twin-bell wind-up alarm: the hammer flicks between two domes and slows as the spring runs out
  function alarm({ pan, seconds = 2.6, onPulse }) {
    const out = strip(pan, 'near'), start = ctx.currentTime + 0.03;
    let t = start, i = 0;
    while (t < start + seconds) {
      const p = (t - start) / seconds, e = Math.min(1, p * 12) * (1 - p ** 3);
      const f = i % 2 ? 2620 : 2350;
      for (const [r, a, d] of DOME) ring(t, out, f * r, MIX.alarm * a * e, d, 0.0005);
      burst(t, out, 'bandpass', 3800, 1.5, MIX.alarm * 0.5 * e, 0.003);
      t += 1 / (19 - 7 * p ** 2);
      i++;
    }
    for (let s = 0; s < seconds; s += 0.5) at(start + s, onPulse); // 2 Hz: stays under flash-safety limits
    return seconds + 1.5;
  }

  // Heartbeat through a stethoscope: two pitch-dropping thumps, saturated so small speakers still feel them
  const heartIn = ctx.createWaveShaper();
  heartIn.curve = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh(2.5 * (i / 511.5 - 1)) / Math.tanh(2.5));
  heartIn.connect(filter('lowpass', 320, 0.5)).connect(gain(0.55, strip(0, 'heart')));
  function thump(t, f0, f1, level, decay) {
    const o = osc('sine', f0);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.1);
    o.connect(env(t, level, decay, 0.008)).connect(heartIn);
    o.start(t);
    o.stop(t + decay * 8);
    burst(t, heartIn, 'lowpass', 110, 0.7, level * 0.45, decay * 0.8); // tissue
    burst(t + 0.004, heartIn, 'bandpass', 190, 1.2, level * 0.12, decay * 0.4); // valve
  }
  function heartbeat({ seconds, from, to, onBeat }) {
    const start = ctx.currentTime + 0.05, end = start + seconds;
    let t = start;
    while (t < end) {
      const p = (t - start) / seconds, bpm = from + (to - from) * p * p;
      const v = MIX.heart * clamp(Math.min((t - start) / 2.5, (end - t) / 2), 0.15, 1);
      thump(t, 58, 38, 0.8 * v, 0.055);
      thump(t + 0.17 + (0.13 * 60) / bpm, 72, 46, 0.55 * v, 0.04);
      at(t, onBeat);
      t += (60 / bpm) * (1 + (Math.random() - 0.5) * 0.04);
    }
    return seconds + 1;
  }

  if (!(ctx instanceof OfflineAudioContext)) ctx.resume();
  return { tick, chime, ding, cuckoo, alarm, heartbeat, ctx };
}

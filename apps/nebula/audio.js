import { mtof, PROGRESSION, PAD_KEY, detectKey, transpose } from './music.js';

// Mix knobs. Tune by ear on the actual speakers or PA.
const MIX = {
  master: 0.85,
  pad: 0.11, // ambient strings
  air: 0.05, // high shimmer, reverb only
  keys: 0.55, // celesta
  reverb: 1.0,
  delay: 0.2,
};
const CHORD_SECONDS = 15;
const PAD_ATTACK = 6;
const PAD_RELEASE = 10;
const MAX_VOICES = 48;

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// Stereo noise tail with high frequencies dying faster: a soft, dark hall.
function impulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const k = 0.5 + 0.48 * t; // one-pole lowpass closing over time
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * (1 - t) ** 2.2 * 1.8;
    }
  }
  return buf;
}

export function createAudio(onChord) {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
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

  // Master chain
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.4;
  comp.connect(ctx.destination);
  const master = gain(MIX.master, comp);

  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 8);
  reverb.connect(gain(MIX.reverb, master));

  // Dark feedback delay that bleeds into the reverb
  const delay = ctx.createDelay(2);
  delay.delayTime.value = 0.46;
  const delayTone = ctx.createBiquadFilter();
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 2200;
  delay.connect(delayTone).connect(gain(0.42, delay));
  delayTone.connect(gain(0.6, master, reverb));

  // Pad: saws through one shared, slowly breathing lowpass
  const padFilter = ctx.createBiquadFilter();
  padFilter.type = 'lowpass';
  padFilter.frequency.value = 850;
  padFilter.Q.value = 0.4;
  const padBus = gain(MIX.pad, master, gain(1.4, reverb));
  padFilter.connect(padBus);
  const breath = osc('sine', 0.045);
  breath.connect(gain(380, padFilter.frequency));
  const vibrato = osc('sine', 4.6);
  const vibratoDepth = gain(3); // cents
  vibrato.connect(vibratoDepth);
  const air = gain(MIX.air, reverb);
  breath.start();
  vibrato.start();

  const keysBus = gain(MIX.keys, master, gain(0.7, reverb), gain(MIX.delay, delay));

  const noise = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
  noise.getChannelData(0).forEach((_, i, d) => (d[i] = Math.random() * 2 - 1));

  function padNote(note, t, hold, level) {
    const g = gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + PAD_ATTACK);
    g.gain.setValueAtTime(level, t + hold);
    g.gain.linearRampToValueAtTime(0, t + hold + PAD_RELEASE);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.2 - 0.6;
    g.connect(pan).connect(padFilter);
    const end = t + hold + PAD_RELEASE + 0.1;
    for (const cents of [-9, 0, 8]) {
      const o = osc('sawtooth', mtof(note));
      o.detune.value = cents;
      vibratoDepth.connect(o.detune);
      o.connect(g);
      o.start(t);
      o.stop(end);
    }
    return { g, end };
  }

  // Pad follows the key the player is in, changing only at chord boundaries.
  const hist = Array(12).fill(0);
  let tonic = PAD_KEY, last = -1;
  function nextChord() {
    tonic = detectKey(hist) ?? tonic;
    hist.forEach((v, i) => (hist[i] = v * 0.5));
    let i;
    do i = Math.floor(Math.random() * PROGRESSION.length); while (i === last);
    last = i;
    const chord = transpose(PROGRESSION[i], tonic);
    const t = ctx.currentTime + 0.05;
    chord.forEach((n) => padNote(n, t, CHORD_SECONDS, 0.22));
    // Shimmer: top two notes an octave up, wet only
    chord.slice(-2).forEach((n) => {
      const o = osc('triangle', mtof(n + 12));
      const g = gain(0, air);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.5, t + PAD_ATTACK * 1.5);
      g.gain.linearRampToValueAtTime(0, t + CHORD_SECONDS + PAD_RELEASE);
      o.connect(g);
      o.start(t);
      o.stop(t + CHORD_SECONDS + PAD_RELEASE + 0.1);
    });
    onChord?.(chord, tonic);
  }

  // Celesta: FM sine whose brightness falls away fast, plus a tine ping and a soft hammer knock.
  const voices = []; // { note, out, oscs, held, released }
  let sustain = false;

  function noteOn(note, vel) {
    hist[note % 12] += vel / 100;
    const t = ctx.currentTime, f = mtof(note), v = vel / 127;
    const tau = clamp(1.9 * Math.sqrt(523 / f), 0.7, 4.5);

    const out = gain(0);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.06 + 0.42 * v ** 1.6, t + 0.004);
    out.gain.setTargetAtTime(0, t + 0.004, tau);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(18000, f * 5 + 5000 * v);
    lp.Q.value = 0.3;
    const pan = ctx.createStereoPanner();
    pan.pan.value = clamp((note - 66) / 30, -0.7, 0.7);
    out.connect(lp).connect(pan).connect(keysBus);

    const body = osc('sine', f);
    const mod = osc('sine', f);
    const index = gain(0);
    index.gain.setValueAtTime(f * (0.5 + 1.8 * v), t);
    index.gain.setTargetAtTime(f * 0.08, t, 0.06 + 0.12 * (1 - v));
    mod.connect(index).connect(body.frequency);
    body.connect(out);

    const h2 = osc('sine', f * 2);
    const h2g = gain(0.16, out);
    h2g.gain.setTargetAtTime(0, t, tau * 0.35);
    h2.connect(h2g);

    const tine = osc('sine', f * 4.02);
    const tineG = gain(0.05 + 0.12 * v, out);
    tineG.gain.setTargetAtTime(0, t, 0.1);
    tine.connect(tineG);

    const knock = ctx.createBufferSource();
    knock.buffer = noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = Math.min(12000, f * 3);
    const knockG = gain(0.08 * v);
    knockG.gain.setTargetAtTime(0, t, 0.012);
    knock.connect(bp).connect(knockG).connect(out);
    knock.start(t);

    const oscs = [body, mod, h2, tine];
    oscs.forEach((o) => { o.start(t); o.stop(t + tau * 7); });
    body.onended = () => {
      out.disconnect();
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
    };
    const voice = { note, out, oscs, held: true };
    voices.push(voice);
    if (voices.length > MAX_VOICES) release(voices[0], 0.05);
  }

  function release(voice, time = 0.55) {
    if (voice.released) return;
    voice.released = true;
    const t = ctx.currentTime;
    voice.out.gain.setTargetAtTime(0, t, time);
    voice.oscs.forEach((o) => o.stop(t + time * 8));
  }

  function noteOff(note) {
    for (const v of voices) {
      if (v.note !== note) continue;
      v.held = false;
      if (!sustain) release(v);
    }
  }

  function setSustain(on) {
    sustain = on;
    if (!on) voices.filter((v) => !v.held).forEach((v) => release(v));
  }

  // Mod wheel opens the ambience up
  function setMod(x) {
    padFilter.frequency.setTargetAtTime(850 + x * 3200, ctx.currentTime, 0.3);
  }

  ctx.resume();
  nextChord();
  setInterval(nextChord, CHORD_SECONDS * 1000);

  return { noteOn, noteOff, setSustain, setMod, ctx };
}

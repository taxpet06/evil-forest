import { createAudio, BEAT } from './audio.js';
import { layout, crossings, tickPos, fmtClock, fmtCountdown, rand, pick, mod, clamp } from './chaos.js';

// Look-and-feel knobs. Tune on the actual screen.
const CFG = {
  plates: 15,
  gutter: 3, // half the black gap between plates
  wave: 0.4, // depth of the light waves rolling over the wall
  calm: [1400, 4200], // ms between misbehaviours
};
const INK = '#06070c', ENAMEL_HI = '#2b4fae', ENAMEL = '#1d3a8a', ENAMEL_LO = '#0b1640';
const GOLD_HI = '#f1e3b8', GOLD = '#c9a24b', GOLD_LO = '#6e5220', RED = '192,24,42';
const FONT = 'Cinzel';
const TZ = new Date().getTimezoneOffset() * 60000;
const TAU = Math.PI * 2;
const ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];

// Rates and offsets the clocks start with. Most are almost right, which is worse.
const DRIFT = [1, 1, 1.02, 0.97, 1.06, 0.93, 1.15, 0.85, 1.5, -1];
const SHIFT = [0, 2, -3, 4, -6, 9, -12, 47, -180, 2400]; // seconds
const COUNTDOWN = [12e3, 30e3, 45e3, 90e3, 300e3, 13 * 60e3, 5400e3];
const TIMER = [20e3, 45e3, 60e3, 120e3];
const VOICE = { astro: 'longcase', dial: 'wall', mirror: 'mantel', regulator: 'longcase', timer: 'pocket', digital: 'pocket', countdown: 'mantel' };
const ANALOG = new Set(['astro', 'dial', 'mirror', 'regulator', 'timer']);

const canvas = document.getElementById('wall');
const g = canvas.getContext('2d');
let audio = null;
try {
  audio = createAudio();
} catch {
  // ponytail: no Web Audio means a silent wall, not a broken one
}
addEventListener('keydown', () => audio?.ctx.resume());

let W, H, DPR, panels = [];
const audible = new Set();
const mood = { heart: 0, heartUntil: 0, dark: 0, lit: null, surge: 0 };

const gilt = (x, y0, y1) => {
  const gr = x.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, GOLD_HI);
  gr.addColorStop(0.45, GOLD);
  gr.addColorStop(0.8, GOLD_LO);
  gr.addColorStop(1, GOLD);
  return gr;
};
function surface(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * DPR);
  c.height = Math.ceil(h * DPR);
  const x = c.getContext('2d');
  x.scale(DPR, DPR);
  return [c, x];
}
// Gilt letters cut into the enamel: dark lip below, metal on top
function engrave(x, text, px, py, size, weight = 600) {
  x.font = `${weight} ${size}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = 'rgba(0,0,0,0.55)';
  x.fillText(text, px, py + size * 0.05);
  x.fillStyle = gilt(x, py - size / 2, py + size / 2);
  x.fillText(text, px, py);
}
function circle(x, r, width, cx = 0, cy = 0) {
  x.beginPath();
  x.arc(cx, cy, r, 0, TAU);
  x.lineWidth = width;
  x.stroke();
}
// Rose-engine engraving under the enamel. Two layers with different petal counts make the moiré.
function guilloche(x, R, petals, alpha) {
  x.strokeStyle = `rgba(170,195,255,${alpha})`;
  x.lineWidth = 0.7;
  const rings = Math.round(R / 5);
  for (let k = 0; k < rings; k++) {
    const r = R * 0.08 + (k * R * 0.92) / rings;
    x.beginPath();
    for (let i = 0; i <= 240; i++) {
      const a = (i / 240) * TAU, rr = r + R * 0.016 * Math.sin(petals * a + k * 0.3);
      x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    x.stroke();
  }
}
// Minute track: sixty strokes, every fifth longer
function track(x, r0, r1, lw = 1) {
  x.strokeStyle = GOLD;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU, r = i % 5 ? r0 : r0 - (r1 - r0) * 0.6;
    x.lineWidth = (i % 5 ? 0.8 : 1.6) * lw;
    x.beginPath();
    x.moveTo(Math.sin(a) * r, -Math.cos(a) * r);
    x.lineTo(Math.sin(a) * r1, -Math.cos(a) * r1);
    x.stroke();
  }
}
function numerals(x, labels, r, size, radial = true) {
  labels.forEach((n, i) => {
    const a = (i / labels.length) * TAU;
    x.save();
    if (radial) {
      x.rotate(a);
      engrave(x, n, 0, -r, size);
    } else engrave(x, n, Math.sin(a) * r, -Math.cos(a) * r, size);
    x.restore();
  });
}

// Everything that never moves on a plate, drawn once
function plate(p) {
  const { w, h } = p.rect, R = p.R;
  const [c, x] = surface(w, h);
  x.translate(w / 2, h / 2);
  const e = x.createRadialGradient(0, -h * 0.12, 0, 0, 0, Math.hypot(w, h) / 2);
  e.addColorStop(0, ENAMEL_HI);
  e.addColorStop(0.55, ENAMEL);
  e.addColorStop(1, ENAMEL_LO);
  x.fillStyle = e;
  x.beginPath();
  x.roundRect(-w / 2, -h / 2, w, h, 5);
  x.fill();
  x.strokeStyle = gilt(x, -h / 2, h / 2);
  x.lineWidth = 2;
  x.beginPath();
  x.roundRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 3);
  x.stroke();
  x.lineWidth = 0.75;
  x.beginPath();
  x.roundRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 2);
  x.stroke();

  if (!ANALOG.has(p.type)) {
    // barleycorn engraving across the plaque
    x.strokeStyle = 'rgba(170,195,255,0.07)';
    x.lineWidth = 0.7;
    for (let y = -h / 2 + 14; y < h / 2 - 12; y += 4) {
      x.beginPath();
      for (let px = -w / 2 + 12; px < w / 2 - 10; px += 4) x.lineTo(px, y + 2.2 * Math.sin(px * 0.07 + y * 0.09));
      x.stroke();
    }
    return c;
  }

  // spandrels: gilt quarter-rings in the corners outside the dial
  const m = Math.min(w, h) * 0.13;
  x.strokeStyle = GOLD;
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const cx = sx * (w / 2 - 12), cy = sy * (h / 2 - 12);
    for (const r of [m * 0.55, m * 0.8]) {
      x.beginPath();
      x.arc(cx, cy, r, 0, TAU);
      x.lineWidth = 1;
      x.stroke();
    }
    x.fillStyle = GOLD;
    x.beginPath();
    x.arc(cx - sx * m * 0.32, cy - sy * m * 0.32, m * 0.07, 0, TAU);
    x.fill();
  }

  // dial disc, a shade deeper than the plate so the face sits inside it
  x.save();
  x.beginPath();
  x.arc(0, 0, R, 0, TAU);
  x.fillStyle = ENAMEL_LO;
  x.globalAlpha = 0.45;
  x.fill();
  x.globalAlpha = 1;
  x.clip();
  guilloche(x, R, 24, 0.09);
  x.restore();
  x.strokeStyle = gilt(x, -R, R);
  circle(x, R, 2.2);
  circle(x, R * 0.975, 0.8);

  if (p.type === 'astro') {
    circle(x, R * 0.84, 1.4);
    track(x, R * 0.76, R * 0.82);
    numerals(x, ROMAN, R * 0.66, R * 0.075);
    x.strokeStyle = GOLD;
    circle(x, R * 0.58, 1);
    engrave(x, 'TEMPVS FVGIT', 0, R * 0.45, R * 0.04, 500);
  } else if (p.type === 'regulator') {
    track(x, R * 0.9, R * 0.955);
    numerals(x, Array.from({ length: 12 }, (_, i) => String(i * 5 || 60)), R * 0.8, R * 0.08, false);
    for (const [cy, labels] of [[-0.42, ['60', '15', '30', '45']], [0.42, ROMAN]]) {
      x.save();
      x.translate(0, R * cy);
      x.strokeStyle = GOLD;
      circle(x, R * 0.25, 1.2);
      x.save();
      x.scale(0.27, 0.27);
      track(x, R * 0.82, R * 0.9, 2.2);
      x.restore();
      numerals(x, labels, R * 0.17, R * (labels.length > 4 ? 0.035 : 0.045), false);
      x.restore();
    }
  } else if (p.type === 'timer') {
    track(x, R * 0.9, R * 0.955);
    numerals(x, ['0', '10', '20', '30', '40', '50'], R * 0.8, R * 0.08, false);
    x.strokeStyle = GOLD;
    circle(x, R * 0.74, 1);
    circle(x, R * 0.5, 1);
  } else {
    track(x, R * 0.9, R * 0.955);
    numerals(x, ROMAN, R * 0.76, R * 0.13);
  }
  return c;
}

// A second engraving, petals out of step with the first; it turns slowly and the dial shimmers
function moire(p) {
  const { w, h } = p.rect;
  const [c, x] = surface(w, h);
  x.translate(w / 2, h / 2);
  guilloche(x, p.R * (p.type === 'astro' ? 0.56 : 0.66), 23, 0.1);
  return c;
}

// The astronomical clock's turning rings: 24 Bohemian hours outside, an off-centre zodiac inside
function rings(p) {
  const R = p.R, s = R * 2 + 8;
  const [outer, x] = surface(s, s);
  x.translate(s / 2, s / 2);
  x.beginPath();
  x.arc(0, 0, R * 0.97, 0, TAU);
  x.arc(0, 0, R * 0.86, 0, TAU, true);
  x.fillStyle = 'rgba(6,10,30,0.6)';
  x.fill();
  x.strokeStyle = GOLD;
  circle(x, R * 0.86, 1);
  numerals(x, Array.from({ length: 24 }, (_, i) => String(i + 1)), R * 0.915, R * 0.05);
  for (let i = 0; i < 24; i++) {
    const a = ((i + 0.5) / 24) * TAU;
    x.fillStyle = GOLD;
    x.beginPath();
    x.arc(Math.sin(a) * R * 0.915, -Math.cos(a) * R * 0.915, R * 0.006, 0, TAU);
    x.fill();
  }

  const z = R * 0.44, zs = z * 2 + 8;
  const [zodiac, y] = surface(zs, zs);
  y.translate(zs / 2, zs / 2);
  y.beginPath();
  y.arc(0, 0, z, 0, TAU);
  y.arc(0, 0, z * 0.8, 0, TAU, true);
  y.fillStyle = 'rgba(6,10,30,0.55)';
  y.fill();
  y.strokeStyle = gilt(y, -z, z);
  circle(y, z, 1.4);
  circle(y, z * 0.8, 1);
  for (let i = 0; i < 72; i++) {
    const a = (i / 72) * TAU, r0 = i % 6 ? z * 0.95 : z * 0.8;
    y.lineWidth = i % 6 ? 0.6 : 1.2;
    y.beginPath();
    y.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0);
    y.lineTo(Math.sin(a) * z, -Math.cos(a) * z);
    y.stroke();
  }
  // a four-point star in each house
  y.fillStyle = GOLD;
  for (let i = 0; i < 12; i++) {
    y.save();
    y.rotate(((i + 0.5) / 12) * TAU);
    y.translate(0, -z * 0.88);
    const q = z * 0.045;
    y.beginPath();
    y.moveTo(0, -q);
    y.lineTo(q * 0.25, -q * 0.25);
    y.lineTo(q, 0);
    y.lineTo(q * 0.25, q * 0.25);
    y.lineTo(0, q);
    y.lineTo(-q * 0.25, q * 0.25);
    y.lineTo(-q, 0);
    y.lineTo(-q * 0.25, -q * 0.25);
    y.fill();
    y.restore();
  }
  return { outer, zodiac };
}

function makePanel(r, type) {
  const gap = CFG.gutter, rect = { x: r.x + gap, y: r.y + gap, w: r.w - gap * 2, h: r.h - gap * 2 };
  const rate = type === 'astro' ? 1 : pick(DRIFT), shift = type === 'astro' ? 0 : pick(SHIFT);
  const t = Date.now() + shift * 1000;
  const p = {
    rect, type, mirror: type === 'mirror', voice: VOICE[type],
    R: (Math.min(rect.w, rect.h) / 2) * (type === 'astro' ? 0.95 : 0.86),
    pan: ((rect.x + rect.w / 2) / W) * 2 - 1,
    clock: { t, rate, base: rate, target: rate, tau: 1 },
    sweep: type === 'astro' || Math.random() < 0.25, h24: Math.random() < 0.5,
    phase: rand(0, TAU), breath: rand(0.2, 0.6), turn: pick([-1, 1]) * rand(0.01, 0.04),
    glow: 0, flash: 0, red: 0, trail: 0, ghost: 0, jitter: 0, spin: null, last: t, tock: false,
  };
  if (type === 'countdown' || type === 'timer') {
    p.total = pick(type === 'timer' ? TIMER : COUNTDOWN);
    p.end = t + p.total * rand(0.3, 1);
  }
  p.plate = plate(p);
  if (ANALOG.has(type)) p.moire = moire(p);
  if (type === 'astro') p.rings = rings(p);
  if (!ANALOG.has(type) || type === 'timer') {
    // size the numerals once so they never jump; every digit gets the same cell
    const box = type === 'timer' ? [p.R * 0.85, p.R * 0.25] : [rect.w * 0.82, rect.h * 0.52];
    g.font = `600 100px ${FONT}`;
    const cell = Math.max(...'0123456789'.split('').map((d) => g.measureText(d).width));
    p.size = Math.min(box[1], (box[0] / (cell * 6.9)) * 100);
    p.cell = (cell * p.size) / 100;
  }
  return p;
}

function build() {
  DPR = devicePixelRatio || 1;
  W = innerWidth;
  H = innerHeight;
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.fillStyle = INK;
  g.fillRect(0, 0, W, H);

  const rects = layout(W, H, CFG.plates);
  const squarish = (r) => Math.max(r.w / r.h, r.h / r.w) < 1.55;
  // The mirrored, upside-down dial takes the squarest plate nearest the top right
  let mirror = -1, best = -Infinity;
  rects.forEach((r, i) => {
    if (i && squarish(r) && r.x + r.w - r.y > best) {
      best = r.x + r.w - r.y;
      mirror = i;
    }
  });
  const analog = ['dial', 'timer', 'regulator', 'dial', 'regulator', 'dial'];
  const digital = ['digital', 'countdown', 'digital', 'countdown', 'digital'].sort(() => Math.random() - 0.5);
  let a = 0, d = 0;
  audible.clear();
  panels = rects.map((r, i) => makePanel(r, i === 0 ? 'astro' : i === mirror ? 'mirror'
    : squarish(r) ? analog[a++ % analog.length] : digital[d++ % digital.length]));
}

// ---- drawing ----

function hand(ang, len, wd) {
  const r = wd * 1.7, ring = len * 0.64;
  g.save();
  g.rotate(ang);
  const sheen = g.createLinearGradient(-wd, 0, wd, 0);
  sheen.addColorStop(0, GOLD_LO);
  sheen.addColorStop(0.5, GOLD_HI);
  sheen.addColorStop(1, GOLD);
  g.fillStyle = sheen;
  g.strokeStyle = sheen;
  g.beginPath(); // shaft from the tail to the Breguet ring
  g.moveTo(-wd * 0.5, len * 0.16);
  g.lineTo(-wd * 0.34, -ring + r);
  g.lineTo(wd * 0.34, -ring + r);
  g.lineTo(wd * 0.5, len * 0.16);
  g.fill();
  g.beginPath(); // the hollow "moon"
  g.arc(0, -ring, r, 0, TAU);
  g.lineWidth = wd * 0.55;
  g.stroke();
  g.beginPath(); // lance tip
  g.moveTo(-wd * 0.34, -ring - r);
  g.lineTo(0, -len);
  g.lineTo(wd * 0.34, -ring - r);
  g.fill();
  g.restore();
}
function needle(ang, len, wd, color = GOLD_HI) {
  g.save();
  g.rotate(ang);
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = wd;
  g.beginPath();
  g.moveTo(0, len * 0.22);
  g.lineTo(0, -len);
  g.stroke();
  g.beginPath();
  g.arc(0, len * 0.18, wd * 3, 0, TAU);
  g.fill();
  g.restore();
}
function pin(r) {
  g.fillStyle = GOLD;
  g.beginPath();
  g.arc(0, 0, r, 0, TAU);
  g.fill();
}
function sun(ang, r, size) {
  g.save();
  g.rotate(ang);
  g.translate(0, -r);
  g.fillStyle = GOLD_HI;
  g.beginPath();
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * TAU, rr = i % 2 ? size : size * 1.9;
    g.lineTo(Math.sin(a) * rr, -Math.cos(a) * rr);
  }
  g.fill();
  g.fillStyle = GOLD;
  g.beginPath();
  g.arc(0, 0, size, 0, TAU);
  g.fill();
  g.restore();
}
function moon(ang, r, size, phase) {
  g.save();
  g.rotate(ang);
  g.translate(0, -r);
  g.rotate(phase * TAU);
  g.fillStyle = '#d9dce6';
  g.beginPath();
  g.arc(0, 0, size, -Math.PI / 2, Math.PI / 2);
  g.fill();
  g.fillStyle = INK;
  g.beginPath();
  g.arc(0, 0, size, Math.PI / 2, Math.PI * 1.5);
  g.fill();
  g.restore();
}

// Numerals in fixed cells so the readout never shuffles sideways
function digits(p, text, color, y = 0) {
  g.font = `600 ${p.size}px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const narrow = (ch) => ch === ':' || ch === '.';
  const total = [...text].reduce((s, ch) => s + (narrow(ch) ? p.cell * 0.45 : p.cell), 0);
  let x = -total / 2;
  const fill = color ? `rgb(${color})` : gilt(g, y - p.size / 2, y + p.size / 2);
  for (const ch of text) {
    const cw = narrow(ch) ? p.cell * 0.45 : p.cell;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillText(ch, x + cw / 2, y + p.size * 0.05);
    g.fillStyle = fill;
    g.fillText(ch, x + cw / 2, y);
    x += cw;
  }
}

function face(p, T) {
  const L = T - TZ, R = p.R;
  const sec = mod(L / 1000, 60), s = p.sweep ? sec : tickPos(sec);
  const min = mod(L / 60000, 60), hr = mod(L / 3.6e6, 12);
  if (p.type === 'digital') return digits(p, fmtClock(L, p.h24));
  if (p.type === 'countdown') {
    const left = p.end - T;
    return digits(p, fmtCountdown(left), left < 10e3 ? RED : null);
  }
  if (p.type === 'timer') {
    const left = clamp(p.end - T, 0, p.total), f = left / p.total;
    g.beginPath();
    g.arc(0, 0, R * 0.72, -Math.PI / 2, -Math.PI / 2 + f * TAU);
    g.arc(0, 0, R * 0.52, -Math.PI / 2 + f * TAU, -Math.PI / 2, true);
    g.fillStyle = left < 5e3 ? `rgba(${RED},0.9)` : gilt(g, -R * 0.72, R * 0.72);
    g.fill();
    return digits(p, fmtCountdown(left).slice(0, 5), left < 5e3 ? RED : null);
  }
  if (p.type === 'regulator') {
    g.save();
    g.translate(0, -R * 0.42);
    needle((s / 60) * TAU, R * 0.21, R * 0.008);
    pin(R * 0.02);
    g.translate(0, R * 0.84);
    hand((hr / 12) * TAU, R * 0.2, R * 0.03);
    pin(R * 0.025);
    g.restore();
    hand((min / 60) * TAU, R * 0.88, R * 0.03);
    return pin(R * 0.035);
  }
  if (p.type === 'astro') {
    const day = mod(L / 86400000, 1);
    g.save();
    g.rotate(-day * TAU * 3 + p.phase); // Bohemian hours, turning against the sun
    g.drawImage(p.rings.outer, -R - 4, -R - 4, R * 2 + 8, R * 2 + 8);
    g.restore();
    const z = p.rings.zodiac.width / DPR;
    g.save();
    g.translate(0, -R * 0.12); // the zodiac is off-centre, as on Prague's Orloj
    g.rotate(mod(L / 120000, 1) * TAU);
    g.drawImage(p.rings.zodiac, -z / 2, -z / 2, z, z);
    g.restore();
    g.strokeStyle = GOLD;
    g.lineWidth = R * 0.006;
    g.save();
    g.rotate(day * TAU);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(0, -R * 0.86);
    g.stroke();
    g.restore();
    sun(day * TAU, R * 0.5, R * 0.035);
    const lunar = mod(L / 90000, 1); // ponytail: the moon runs a 90-second month so you can watch it
    moon(lunar * TAU, R * 0.36, R * 0.03, lunar);
    hand((hr / 12) * TAU, R * 0.48, R * 0.04);
    hand((min / 60) * TAU, R * 0.74, R * 0.03);
    needle((s / 60) * TAU, R * 0.8, R * 0.006);
    return pin(R * 0.03);
  }
  hand((hr / 12) * TAU, R * 0.52, R * 0.05);
  hand((min / 60) * TAU, R * 0.78, R * 0.036);
  needle((s / 60) * TAU, R * 0.88, R * 0.009);
  pin(R * 0.035);
}

// Light: waves roll across the wall, rings spread from the middle, every plate breathes on its own
function light(p, s) {
  const { x, y, w, h } = p.rect, u = (x + w / 2) / W, v = (y + h / 2) / H;
  const sweep = Math.sin(s * 0.7 - u * 6 + Math.sin(s * 0.11) * 3);
  const ripple = Math.sin(s * 1.1 - Math.hypot(u - 0.5, ((v - 0.5) * H) / W) * 14);
  const depth = CFG.wave * (0.5 + 0.8 * Math.sin(s * 0.05) ** 2) + mood.surge;
  let L = 0.7 + depth * (0.6 * sweep + 0.35 * ripple) + 0.1 * Math.sin(s * p.breath + p.phase) + p.glow;
  if (mood.heartUntil > s) L = L * 0.6 + 0.45 * mood.heart;
  if (mood.dark > s) L = p === mood.lit ? 1.25 : L * 0.1;
  return clamp(L, 0.03, 1.6);
}

function drawPanel(p, s) {
  const { x, y, w, h } = p.rect, T = p.clock.t + p.jitter;
  const keep = p.trail;
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.translate(x + w / 2, y + h / 2);
  if (p.mirror) {
    g.scale(-1, 1);
    g.rotate(Math.PI);
  }
  if (p.spin) {
    const k = clamp((s - p.spin.from) / p.spin.dur, 0, 1);
    if (k >= 1) p.spin = null;
    else {
      g.globalAlpha = 1 - keep;
      g.fillStyle = INK;
      g.fillRect(-w, -h, w * 2, h * 2);
      g.rotate(p.spin.dir * TAU * (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2));
    }
  }
  g.globalAlpha = 1 - keep; // trails: let the last frames show through
  g.drawImage(p.plate, -w / 2, -h / 2, w, h);
  if (p.moire) {
    g.save();
    g.rotate(s * p.turn);
    g.globalAlpha = 0.8 * (1 - keep);
    g.drawImage(p.moire, -w / 2, -h / 2, w, h);
    g.restore();
  }
  g.globalAlpha = 1;
  if (p.ghost) {
    g.globalAlpha = 0.3;
    face(p, T - p.ghost);
    g.globalAlpha = 1;
  }
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = p.R * 0.02;
  g.shadowOffsetX = p.R * 0.012;
  g.shadowOffsetY = p.R * 0.022;
  face(p, T);
  g.restore();

  const L = light(p, s);
  g.save();
  if (L < 1) {
    g.fillStyle = `rgba(6,7,12,${(1 - L) * (1 - keep * 0.8)})`;
    g.fillRect(x, y, w, h);
  }
  g.globalCompositeOperation = 'lighter';
  if (L > 1) {
    g.fillStyle = `rgba(201,162,75,${(L - 1) * 0.35 * (1 - keep)})`;
    g.fillRect(x, y, w, h);
  }
  if (p.red > 0.01 || mood.heartUntil > s) {
    g.fillStyle = `rgba(${RED},${p.red * 0.4 + (mood.heartUntil > s ? mood.heart * 0.16 : 0)})`;
    g.fillRect(x, y, w, h);
  }
  if (p.flash > 0.01) {
    g.fillStyle = `rgba(241,227,184,${p.flash * 0.45 * (1 - keep)})`;
    g.fillRect(x, y, w, h);
  }
  g.restore();
}

function step(p, dt) {
  const c = p.clock;
  c.rate += (c.target - c.rate) * (1 - Math.exp(-dt / c.tau));
  c.t += dt * 1000 * c.rate;
  if (p.stutter) p.jitter = Math.floor(performance.now() / 650) % 2 ? 1000 : 0; // dying battery: tick, fall back
  const T = c.t + p.jitter;
  if (p.end && T >= p.end) {
    p.red = 1;
    p.flash = 0.6;
    audio?.ding(p.pan);
    p.end = T + p.total;
  }
  if (audible.has(p)) {
    const n = Math.min(3, crossings(p.last, T, BEAT[p.voice] * 1000));
    for (let i = 0; i < n; i++) audio?.tick(p.pan, p.voice, (p.tock = !p.tock), i * 0.015);
  }
  p.last = T;
  const fade = (v, tau) => v * Math.exp(-dt / tau);
  p.glow = fade(p.glow, 0.6);
  p.flash = fade(p.flash, 0.35);
  p.red = fade(p.red, 0.45);
}

let prev = performance.now();
function frame(nowMs) {
  const dt = Math.min(0.1, (nowMs - prev) / 1000), s = nowMs / 1000;
  prev = nowMs;
  mood.heart *= Math.exp(-dt / 0.22);
  mood.surge *= Math.exp(-dt / 4);
  for (const p of panels) {
    step(p, dt);
    drawPanel(p, s);
  }
  requestAnimationFrame(frame);
}

// ---- misbehaviour ----

const any = (test = () => true) => pick(panels.filter(test));
const analog = (p) => ANALOG.has(p.type) && p.type !== 'timer';
const sec = () => performance.now() / 1000;
function setRate(p, rate, tau, ms) {
  const c = p.clock;
  c.target = rate;
  c.tau = tau;
  clearTimeout(p.restore);
  p.restore = setTimeout(() => {
    c.target = c.base;
    c.tau = 0.8;
    p.trail = 0;
    p.stutter = false;
    p.jitter = 0;
  }, ms);
}
let busy = 0; // only one big sound at a time; ticks layer freely
function sound(fn) {
  if (!audio || sec() < busy) return;
  busy = sec() + fn();
}
function listen(p, ms) {
  audible.add(p);
  p.glow = 0.15;
  setTimeout(() => audible.delete(p), ms);
}

const EVENTS = [
  [7, () => setRate(any(), 0, 0.45, rand(2500, 7000))], // winds down and stops dead
  [5, () => setRate(any(), -rand(1, 4), 0.6, rand(4000, 10000))], // runs backwards
  [4, () => { const p = any(); setRate(p, pick([-1, 1]) * rand(400, 3000), 0.35, rand(1200, 3500)); p.trail = 0.82; }], // whirls
  [5, () => { const p = any(); p.clock.t += pick([-1, 1]) * rand(4e3, 3.6e6); p.flash = 1; }], // skips
  [3, () => { const p = any(analog); setRate(p, 0, 0.05, rand(4000, 9000)); p.stutter = true; listen(p, 9000); }],
  [4, () => { const p = any(); p.clock.base = pick(DRIFT) * rand(0.95, 1.05); p.clock.target = p.clock.base; }], // new drift
  [2, () => { // two clocks trade times
    const [a, b] = panels.filter((p) => !p.end).sort(() => Math.random() - 0.5);
    [a.clock, b.clock] = [b.clock, a.clock];
    a.flash = b.flash = 0.8;
  }],
  [2.5, () => { const p = any(analog); p.spin = { from: sec(), dur: rand(4, 9), dir: pick([-1, 1]) }; }], // dial turns over
  [3, () => { const p = any(); p.ghost = rand(400, 2500); setTimeout(() => (p.ghost = 0), rand(5000, 12000)); }], // double vision
  [1.5, () => (mood.surge = rand(0.25, 0.5))], // light waves swell
  [4, () => { listen(any(analog), rand(6000, 15000)); if (Math.random() < 0.4) listen(any(analog), rand(5000, 12000)); }],
  [2, () => sound(() => {
    const p = any(analog), hr = Math.floor(mod((p.clock.t - TZ) / 3.6e6, 12)) || 12;
    return audio.chime({ pan: p.pan, church: Math.random() < 0.6, hours: Math.random() < 0.5 ? (Math.random() < 0.12 ? 13 : hr) : 0, onStrike: () => (p.glow = 0.5) });
  })],
  [1.6, () => sound(() => { // heartbeat; one clock gives up its own time and ticks on the beat instead
    const p = any(analog), seconds = rand(10, 20);
    setRate(p, 0, 0.3, seconds * 1000);
    listen(p, seconds * 1000);
    mood.heartUntil = sec() + seconds + 1;
    return audio.heartbeat({ seconds, from: rand(56, 70), to: rand(78, 128), onBeat: () => { mood.heart = 1; p.clock.t += 1000; p.glow = 0.3; } });
  })],
  [1, () => sound(() => { const p = any(analog); return audio.cuckoo({ pan: p.pan, calls: Math.ceil(rand(0, 4)), }); })],
  [0.6, () => sound(() => {
    const p = any((q) => !analog(q));
    return audio.alarm({ pan: p.pan, onPulse: () => { p.red = 1; } });
  })],
  [0.5, () => { // for a moment every clock agrees, then they scatter
    const now = Date.now();
    for (const p of panels) {
      p.clock.t = now;
      p.clock.rate = p.clock.target = 1;
      if (p.end) p.end = now + p.total;
      p.flash = 0.7;
      p.last = now;
    }
    sound(() => audio.chime({ pan: 0, church: true, hours: 1 }));
    setTimeout(() => panels.forEach((p) => { p.clock.t += pick(SHIFT) * 1000; p.clock.base = p.clock.target = pick(DRIFT); }), rand(5000, 8000));
  }],
  [1, () => { mood.dark = sec() + rand(3, 6); mood.lit = any(analog); listen(mood.lit, 6000); }], // lights fail, one clock keeps ticking
];
const WEIGHT = EVENTS.reduce((a, [w]) => a + w, 0);
function misbehave() {
  let r = Math.random() * WEIGHT;
  const [, fn] = EVENTS.find(([w]) => (r -= w) < 0);
  fn();
  setTimeout(misbehave, rand(...CFG.calm));
}

// Hide the cursor unless it moves
let idleTimer;
addEventListener('mousemove', () => {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2000);
});
document.body.classList.add('idle');

let resizeTimer;
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(build, 200);
});

await document.fonts.load(`600 40px ${FONT}`);
build();
requestAnimationFrame(frame);
setTimeout(() => listen(panels[0], 12000), 600); // open on the big clock ticking
setTimeout(misbehave, 3000);

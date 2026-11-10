// Pure music helpers shared by audio and visuals. No DOM, so node can test it.

export const mtof = (n) => 440 * 2 ** ((n - 69) / 12);

// Position of a pitch class on the circle of fifths (C=0, G=1, D=2, ...).
export const fifths = (note) => ((note % 12) * 7) % 12;

// One color per step on the circle of fifths, so consonant notes get neighboring hues.
const PALETTE = [
  '#ff4f9a', '#ff7357', '#ffaa3c', '#ffe066', '#6dffae', '#38f5c4',
  '#2fd0ff', '#3a86ff', '#5b5bff', '#9b4dff', '#d24bff', '#ff4fd8',
].map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255));

export const noteColor = (note) => PALETTE[fifths(note)];

export function parseMidi([status, d1, d2 = 0]) {
  const type = status & 0xf0;
  if (type === 0x90 && d2 > 0) return { type: 'on', note: d1, vel: d2 };
  if (type === 0x80 || type === 0x90) return { type: 'off', note: d1 };
  if (type === 0xb0 && d1 === 64) return { type: 'sustain', on: d2 >= 64 };
  if (type === 0xb0 && d1 === 1) return { type: 'mod', value: d2 / 127 };
  if (type === 0xe0) return { type: 'bend', value: ((d2 << 7) | d1) / 8192 - 1 };
  return null;
}

// Krumhansl-Kessler major profile. Minor playing lands on its relative major,
// which has the same notes, and that's all the pad needs.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];

// hist: 12 weights by pitch class. Returns the tonic pitch class, or null if too little was played.
export function detectKey(hist, minWeight = 6) {
  const sum = hist.reduce((a, b) => a + b, 0);
  if (sum < minWeight) return null;
  const corr = (xs, ys) => {
    const mx = xs.reduce((a, b) => a + b) / 12, my = ys.reduce((a, b) => a + b) / 12;
    let n = 0, dx = 0, dy = 0;
    for (let i = 0; i < 12; i++) {
      n += (xs[i] - mx) * (ys[i] - my);
      dx += (xs[i] - mx) ** 2;
      dy += (ys[i] - my) ** 2;
    }
    return n / Math.sqrt(dx * dy || 1);
  };
  let best = 0, bestR = -Infinity;
  for (let k = 0; k < 12; k++) {
    const r = corr(hist, MAJOR.map((_, i) => MAJOR[(i - k + 12) % 12]));
    if (r > bestR) [best, bestR] = [k, r];
  }
  return best;
}

// Ambient progression, written in D. Open sus/add9 voicings so almost anything fits on top.
export const PAD_KEY = 2;
export const PROGRESSION = [
  [38, 45, 52, 57, 66], // D add9
  [43, 50, 57, 59, 66], // G maj9
  [35, 42, 50, 57, 61], // Bm9
  [40, 47, 54, 57, 62], // Em11
  [45, 52, 57, 59, 64], // A sus2
  [36, 43, 50, 57, 64], // C lydian colour, borrowed
];

// Move a chord from the pad's home key to `tonic`, by the smallest interval (-6..+5).
export const transpose = (chord, tonic) => {
  const shift = ((tonic - PAD_KEY + 18) % 12) - 6;
  return chord.map((n) => n + shift);
};

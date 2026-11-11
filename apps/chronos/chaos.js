// Pure time and layout logic. No DOM, so it runs under node --test.

export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
export const mod = (x, m) => ((x % m) + m) % m;
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// How many multiples of `period` lie between a and b, in either direction.
// A clock running backwards still ticks.
export const crossings = (a, b, period) => Math.abs(Math.floor(b / period) - Math.floor(a / period));

// A stepping second hand: jumps to each new second with a small overshoot, then rests.
const TICK = 0.14; // seconds the jump takes
export function tickPos(s) {
  const i = Math.floor(s), f = s - i;
  if (f >= TICK) return i;
  const x = f / TICK - 1, c = 2.4; // back-out ease
  return i + (c + 1) * x ** 3 + c * x ** 2; // x = -1 gives i - 1, x = 0 gives i
}

const pad = (n, w = 2) => String(Math.floor(n)).padStart(w, '0');

// Wall-clock text for local milliseconds-since-epoch
export function fmtClock(localMs, h24 = true) {
  const s = mod(localMs / 1000, 86400);
  let h = Math.floor(s / 3600);
  if (!h24) h = h % 12 || 12;
  return `${pad(h)}:${pad((s / 60) % 60)}:${pad(s % 60)}`;
}

// Countdown text: M:SS.t under an hour, H:MM:SS above
export function fmtCountdown(ms) {
  const s = Math.max(0, ms) / 1000;
  if (s >= 3600) return `${Math.floor(s / 3600)}:${pad((s / 60) % 60)}:${pad(s % 60)}`;
  return `${pad(s / 60)}:${pad(s % 60)}.${Math.floor((s * 10) % 10)}`;
}

// The wall: one big square plate a little above centre, the frame around it
// split into smaller plates, always cutting the biggest one along its long side.
export function layout(W, H, n, rnd = Math.random) {
  const s = Math.round(Math.min(W, H) * 0.7);
  const hx = Math.round((W - s) / 2), hy = Math.round((H - s) * 0.35);
  const cells = [
    { x: 0, y: 0, w: hx, h: H },
    { x: hx + s, y: 0, w: W - hx - s, h: H },
    { x: hx, y: 0, w: s, h: hy },
    { x: hx, y: hy + s, w: s, h: H - hy - s },
  ].filter((c) => c.w > 0 && c.h > 0);
  while (cells.length < n - 1) {
    cells.sort((a, b) => b.w * b.h - a.w * a.h);
    const c = cells.shift(), r = 0.38 + rnd() * 0.24;
    if (c.w > c.h) {
      const w = Math.round(c.w * r);
      cells.push({ ...c, w }, { ...c, x: c.x + w, w: c.w - w });
    } else {
      const h = Math.round(c.h * r);
      cells.push({ ...c, h }, { ...c, y: c.y + h, h: c.h - h });
    }
  }
  return [{ x: hx, y: hy, w: s, h: s }, ...cells];
}

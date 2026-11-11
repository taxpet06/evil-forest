import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossings, tickPos, fmtClock, fmtCountdown, layout } from './chaos.js';

test('ticks are counted forwards, backwards and at speed', () => {
  assert.equal(crossings(900, 1100, 1000), 1);
  assert.equal(crossings(1100, 900, 1000), 1); // running backwards
  assert.equal(crossings(1100, 1900, 1000), 0);
  assert.equal(crossings(0, 5500, 1000), 5); // spinning
  assert.equal(crossings(-100, 100, 1000), 1); // across zero
});

test('stepping second hand rests on whole seconds and overshoots on the jump', () => {
  assert.equal(tickPos(7.5), 7);
  assert.ok(Math.abs(tickPos(7) - 6) < 1e-9); // jump starts from the previous second
  assert.ok(tickPos(7.1) > 7); // overshoot
  assert.ok(Math.abs(tickPos(7.1399) - 7) < 0.01);
});

test('formats clocks and countdowns', () => {
  const t = ((13 * 60 + 5) * 60 + 9) * 1000;
  assert.equal(fmtClock(t), '13:05:09');
  assert.equal(fmtClock(t, false), '01:05:09');
  assert.equal(fmtClock(-1000), '23:59:59');
  assert.equal(fmtCountdown(65_400), '01:05.4');
  assert.equal(fmtCountdown(-5), '00:00.0');
  assert.equal(fmtCountdown(3_723_000), '1:02:03');
});

test('layout tiles the screen exactly, biggest plate first', () => {
  for (const [W, H] of [[1920, 1080], [1280, 800], [800, 1280], [3840, 2160]]) {
    const cells = layout(W, H, 15);
    assert.equal(cells.length, 15);
    assert.equal(cells.reduce((a, c) => a + c.w * c.h, 0), W * H);
    const area = (c) => c.w * c.h;
    assert.ok(cells.slice(1).every((c) => area(c) <= area(cells[0])));
    assert.ok(cells.every((c) => c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H));
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMidi, detectKey, transpose, fifths, PROGRESSION } from './music.js';

test('parses MIDI messages from any channel', () => {
  assert.deepEqual(parseMidi([0x93, 60, 100]), { type: 'on', note: 60, vel: 100 });
  assert.deepEqual(parseMidi([0x90, 60, 0]), { type: 'off', note: 60 }); // running-status note off
  assert.deepEqual(parseMidi([0x80, 60, 64]), { type: 'off', note: 60 });
  assert.deepEqual(parseMidi([0xb0, 64, 127]), { type: 'sustain', on: true });
  assert.equal(parseMidi([0xe0, 0, 64]).value, 0); // bend centre
  assert.equal(parseMidi([0xf8]), null); // clock
});

test('detects the key from played notes', () => {
  const hist = (pcs) => { const h = Array(12).fill(0); pcs.forEach((p) => h[p] += 1); return h; };
  assert.equal(detectKey(hist([0, 4, 7, 9, 11])), null); // not enough played yet
  assert.equal(detectKey(hist([0, 2, 4, 5, 7, 9, 11, 0, 4, 7])), 0); // C major
  assert.equal(detectKey(hist([4, 6, 8, 9, 11, 1, 3, 4, 8, 11])), 4); // E major
  assert.equal(detectKey(hist([3, 5, 7, 8, 10, 0, 2, 3, 7, 10])), 3); // Eb major
});

test('transposes the pad by the smallest step', () => {
  assert.deepEqual(transpose([38, 45], 2), [38, 45]);
  assert.deepEqual(transpose([38, 45], 0), [36, 43]); // down 2 to C
  assert.deepEqual(transpose([38, 45], 7), [43, 50]); // up 5 to G
  assert.deepEqual(transpose([38, 45], 8), [32, 39]); // down 6 to Ab
});

test('circle of fifths order', () => {
  assert.deepEqual([60, 67, 62, 69].map(fifths), [0, 1, 2, 3]);
  assert.ok(PROGRESSION.every((c) => c.length === 5));
});

import { createAudio } from './audio.js';
import { createVisuals } from './visuals.js';
import { parseMidi } from './music.js';

const statusEl = document.getElementById('status');
let hideTimer;
function status(text, sticky = false) {
  statusEl.textContent = text;
  statusEl.classList.remove('hidden');
  clearTimeout(hideTimer);
  if (!sticky) hideTimer = setTimeout(() => statusEl.classList.add('hidden'), 5000);
}

let vis;
try {
  vis = createVisuals(document.getElementById('sky'));
} catch (err) {
  status(`Visuals are off: ${err.message} Sound still works.`, true);
}
const audio = createAudio((chord) => vis?.padChord(chord));

function handle(e) {
  if (!e) return;
  if (e.type === 'on') { audio.noteOn(e.note, e.vel); vis?.noteOn(e.note, e.vel); }
  if (e.type === 'off') { audio.noteOff(e.note); vis?.noteOff(e.note); }
  if (e.type === 'sustain') { audio.setSustain(e.on); vis?.setSustain(e.on); }
  if (e.type === 'mod') { audio.setMod(e.value); vis?.setMod(e.value); }
  if (e.type === 'bend') vis?.setBend(e.value);
}

const NO_DEVICE = 'No MIDI keyboard found. Plug one in, or play with the A to K keys (Z and X change octave).';

navigator.requestMIDIAccess().then((access) => {
  const bind = () => {
    const names = [];
    for (const input of access.inputs.values()) {
      if (/through/i.test(input.name)) continue; // Linux loopback port, not an instrument
      input.onmidimessage = (m) => handle(parseMidi(m.data));
      names.push(input.name);
    }
    if (names.length) status(`${names.join(' and ')} connected`);
    else status(NO_DEVICE, true);
  };
  bind();
  access.onstatechange = bind;
}).catch(() => status('MIDI is unavailable on this system. Play with the A to K keys instead.', true));

// Computer keyboard fallback: one octave on the home row, black keys above
const KEYS = 'awsedftgyhujk';
let octave = 60;
const down = new Set();
const keyNotes = {};
addEventListener('keydown', (e) => {
  if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 'z') octave = Math.max(24, octave - 12);
  if (k === 'x') octave = Math.min(96, octave + 12);
  const i = KEYS.indexOf(k);
  if (i < 0 || down.has(k)) return;
  down.add(k);
  keyNotes[k] = octave + i;
  handle({ type: 'on', note: keyNotes[k], vel: 70 + Math.floor(Math.random() * 40) });
});
addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (!down.delete(k)) return;
  handle({ type: 'off', note: keyNotes[k] });
});
addEventListener('blur', () => { down.forEach((k) => handle({ type: 'off', note: keyNotes[k] })); down.clear(); });

// Hide the cursor while performing
let idleTimer;
addEventListener('mousemove', () => {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2000);
});
document.body.classList.add('idle');

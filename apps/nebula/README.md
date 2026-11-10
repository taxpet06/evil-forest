# Nebula

A MIDI instrument for performing on a projector. Play any MIDI keyboard and you get a celesta-like voice over a slow ambient string pad. Each note drops colored light into a swirling nebula.

## Run

```sh
npm install
npm start          # opens fullscreen; F11 toggles, Esc leaves fullscreen
npm test
```

Works the same on Windows and Linux. MIDI devices are picked up automatically, including ones plugged in while it's running. With no keyboard connected, play with `A`–`K` on the computer keyboard (`W E T Y U` are the black keys, `Z`/`X` change octave). Set `NEBULA_WINDOWED=1` to start in a window.

## Build an app

```sh
npm run dist:linux   # dist/Nebula-x.y.z.AppImage
npm run dist:win     # dist/Nebula x.y.z.exe (portable); run this on Windows
```

## How it plays

- **Ambient pad:** detuned saw strings that breathe through a slow filter, with a high shimmer and an 8-second hall. Chords change every 15s and follow the key you're playing in.
- **Celesta:** an FM sine with a soft hammer knock and a short metallic ping, then a long sustain. Velocity controls loudness and brightness. Sustain pedal (CC64) is supported.
- **Mod wheel** opens up the pad's filter and makes the visuals swirl harder. **Pitch bend** stirs the whole sky.
- **Visuals:** a GPU fluid simulation. A note's color comes from its place on the circle of fifths, so consonant chords mix into neighboring hues. The same position sets the note's angle around the center, and its octave sets the distance. Held notes orbit and leave trails. Three or more notes struck together bloom outward from the center. The background gas takes its color from the pad's current chord.

Tuning knobs: `MIX` at the top of `audio.js`, `CFG` at the top of `visuals.js`.

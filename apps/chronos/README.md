# Chronos

A wall of astronomical-clock dial plates that all disagree. Lapis enamel, gold leaf, velvet black in between. Every clock looks trustworthy on its own; together they don't add up.

## Run

```sh
npm install
npm start          # opens fullscreen; F11 toggles, Esc leaves fullscreen
npm test
```

Works the same on Windows and Linux. Set `CHRONOS_WINDOWED=1` to start in a window.

## Build an app

```sh
npm run dist:linux   # dist/Chronos-x.y.z.AppImage
npm run dist:win     # dist/Chronos x.y.z.exe (portable); run this on Windows
```

## What happens

- **The wall:** a big astronomical clock in the middle (turning 24-hour ring, off-centre zodiac, sun and moon hands), surrounded by dials, regulators, a timer dial, digital plaques and countdowns. One dial is mirrored and upside down. Most clocks run a few percent fast or slow, or a few seconds early or late. One may run backwards.
- **Misbehaviour, every few seconds:** a clock winds down and stops, runs backwards, whirls with motion trails, skips hours, stutters like a dying battery, turns its whole dial over, sees double, or trades times with another clock. Sometimes every clock agrees for a few seconds, then they scatter. Sometimes the lights fail and one clock keeps ticking.
- **Light:** waves roll across the wall and ripple out from the centre, and each plate breathes on its own.
- **Sound, now and then:** a clock's own ticking, panned to where it hangs, at its own (wrong) speed. Westminster quarters on church bells or mantel gong rods, sometimes with the hour (sometimes thirteen). A cuckoo, a twin-bell alarm, and a heartbeat that speeds up while one clock ticks on the beat. Everything is synthesised, nothing is sampled.

Flashes stay at 2 per second or slower, but the piece is meant to disorient. Take care with photosensitive viewers.

Tuning knobs: `MIX` at the top of `audio.js`, `CFG` at the top of `app.js`. Cinzel font under the SIL Open Font License (`OFL.txt`).

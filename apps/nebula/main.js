import { app, BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: !process.env.NEBULA_WINDOWED,
    backgroundColor: '#05030b',
    title: 'Nebula',
    webPreferences: { autoplayPolicy: 'no-user-gesture-required', backgroundThrottling: false },
  });
  win.removeMenu();
  // Web MIDI is the only permission the page asks for
  win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'midi' || perm === 'midiSysex'));
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.key === 'Escape') win.setFullScreen(false);
  });
  win.loadFile(fileURLToPath(new URL('index.html', import.meta.url)));
});

app.on('window-all-closed', () => app.quit());

import { createLiveUpdate } from '@capawesome/electron-live-update';
import { BrowserWindow, app } from 'electron';
import { join } from 'node:path';

if (process.env.EXAMPLE_USER_DATA) {
  app.setPath('userData', process.env.EXAMPLE_USER_DATA);
}

const liveUpdate = createLiveUpdate({
  appId: process.env.EXAMPLE_APP_ID ?? 'ffffffff-ffff-ffff-ffff-ffffffffffff',
  autoBlockRolledBackBundles: true,
  autoUpdateStrategy:
    process.env.EXAMPLE_AUTO_UPDATE === 'background' ? 'background' : 'none',
  defaultBundlePath: join(__dirname, '..', 'renderer'),
  publicKey: process.env.EXAMPLE_PUBLIC_KEY,
  readyTimeout: Number(process.env.EXAMPLE_READY_TIMEOUT ?? 10000),
  serverDomain: process.env.EXAMPLE_SERVER_DOMAIN ?? 'localhost:4100',
});
const simpleMode = process.env.EXAMPLE_SERVING_MODE === 'simple';
if (!simpleMode) {
  liveUpdate.serve();
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: { preload: join(__dirname, 'preload.js') },
  });
  liveUpdate.attach(window);
  try {
    if (simpleMode) {
      const bundlePath = await liveUpdate.getCurrentBundlePath();
      await window.loadFile(join(bundlePath ?? '', 'index.html'));
    } else {
      await window.loadURL(liveUpdate.getServeUrl());
    }
  } catch (error) {
    // The initial load is aborted (ERR_ABORTED) when an SDK-initiated
    // reload (e.g. a rollback) navigates the window while the load is
    // still pending. The interrupting navigation supersedes this one.
    console.warn('[example] Initial load was superseded:', error);
  }
});

app.on('window-all-closed', () => app.quit());

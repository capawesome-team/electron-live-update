import { LiveUpdate } from '@capawesome/electron-live-update/renderer';

const marker = import.meta.env.VITE_BUNDLE_MARKER ?? 'built-in';

function setText(id: string, text: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = text;
  }
}

function setError(error: unknown): void {
  setText('error', error instanceof Error ? error.message : String(error));
}

async function refresh(): Promise<void> {
  const [currentBundle, nextBundle, channel, deviceId, blockedBundles] =
    await Promise.all([
      LiveUpdate.getCurrentBundle(),
      LiveUpdate.getNextBundle(),
      LiveUpdate.getChannel(),
      LiveUpdate.getDeviceId(),
      LiveUpdate.getBlockedBundles(),
    ]);
  setText('current-bundle', currentBundle.bundleId ?? 'default');
  setText('next-bundle', nextBundle.bundleId ?? 'default');
  setText('channel', channel.channel ?? 'default');
  setText('device-id', deviceId.deviceId);
  setText('blocked-bundles', blockedBundles.bundleIds.join(', ') || 'none');
}

async function start(): Promise<void> {
  setText('marker', marker);
  // localStorage survives bundle switches thanks to the stable origin.
  const counter = Number(localStorage.getItem('counter') ?? '0') + 1;
  localStorage.setItem('counter', String(counter));
  setText('storage-counter', String(counter));

  LiveUpdate.addListener('downloadBundleProgress', event => {
    setText(
      'progress',
      `${Math.round(event.progress * 100)}% of ${event.totalBytes} bytes`,
    );
  });
  LiveUpdate.addListener('nextBundleSet', event => {
    setText('next-bundle', event.bundleId ?? 'default');
  });

  document.getElementById('sync')?.addEventListener('click', async () => {
    try {
      await LiveUpdate.sync();
      await refresh();
    } catch (error) {
      setError(error);
    }
  });
  document.getElementById('reload')?.addEventListener('click', () => {
    LiveUpdate.reload().catch(setError);
  });
  document.getElementById('reset')?.addEventListener('click', async () => {
    try {
      await LiveUpdate.reset();
      await refresh();
    } catch (error) {
      setError(error);
    }
  });

  await refresh();
  // Signal readiness: this bundle booted successfully, no rollback needed.
  const result = await LiveUpdate.ready();
  setText('ready-state', `ready (rollback: ${result.rollback})`);
}

start().catch(setError);

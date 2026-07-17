/**
 * The kill-during-boot rollback drill, run against the PACKAGED app.
 *
 * Scenario:
 * 1. The app syncs and boots the good bundle 2.0.0, which signals
 *    readiness (2.0.0 becomes the last successful bundle).
 * 2. The broken bundle 3.0.0-broken is synced and activated on the
 *    next launch. It never calls ready(). The process is force-killed
 *    during boot, before any timer can fire.
 * 3. On relaunch, the engine must detect the uncleared pending-boot
 *    marker, revert to 2.0.0 (NOT the built-in bundle) and block
 *    3.0.0-broken. A further sync that still offers the broken bundle
 *    must skip it.
 *
 * Assertions are made against the engine state file on disk, which is
 * the kill-safety contract.
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  artifactsDirectory,
  createUserDataDirectory,
  exampleDirectory,
  getExamplePublicKey,
  readState,
  repositoryRoot,
  startMockServer,
  waitForState,
} from './helpers.mjs';

const MOCK_PORT = 4141;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    shell: process.platform === 'win32',
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

async function packageApp() {
  console.log('[drill] Staging the app for packaging...');
  await rm(artifactsDirectory, { recursive: true, force: true });
  const stageDirectory = join(artifactsDirectory, 'app');
  await mkdir(stageDirectory, { recursive: true });
  // Pack the SDK exactly like a release and install it from the
  // tarball, so the packaged app consumes the real published layout.
  run('npm', ['pack', '--pack-destination', artifactsDirectory], {
    cwd: repositoryRoot,
  });
  const tarball = (await readdir(artifactsDirectory)).find(name =>
    name.endsWith('.tgz'),
  );
  if (!tarball) {
    throw new Error('npm pack did not produce a tarball.');
  }
  await writeFile(
    join(stageDirectory, 'package.json'),
    JSON.stringify(
      {
        name: 'live-update-e2e-app',
        version: '1.0.0',
        main: 'dist/main/main.js',
        dependencies: {
          '@capawesome/electron-live-update': `file:${join(artifactsDirectory, tarball)}`,
        },
      },
      null,
      2,
    ),
  );
  await cp(
    join(exampleDirectory, 'dist', 'main'),
    join(stageDirectory, 'dist', 'main'),
    { recursive: true },
  );
  await cp(
    join(exampleDirectory, 'dist', 'renderer'),
    join(stageDirectory, 'dist', 'renderer'),
    { recursive: true },
  );
  run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
    cwd: stageDirectory,
  });
  // Package the app the same way @electron/packager does: copy the
  // Electron distribution and replace the default app with an asar
  // archive of the staged app.
  console.log('[drill] Packaging the app...');
  const asar = await import('@electron/asar');
  const electronDistDirectory = join(
    repositoryRoot,
    'node_modules',
    'electron',
    'dist',
  );
  const packagedDirectory = join(artifactsDirectory, 'packaged');
  // verbatimSymlinks preserves the macOS framework symlink structure.
  await cp(electronDistDirectory, packagedDirectory, {
    recursive: true,
    verbatimSymlinks: true,
  });
  const resourcesDirectory =
    process.platform === 'darwin'
      ? join(packagedDirectory, 'Electron.app', 'Contents', 'Resources')
      : join(packagedDirectory, 'resources');
  await rm(join(resourcesDirectory, 'default_app.asar'), { force: true });
  await asar.createPackage(
    stageDirectory,
    join(resourcesDirectory, 'app.asar'),
  );
  if (process.platform === 'darwin') {
    // Re-sign with the ad-hoc identity: modifying the bundle
    // invalidates the signature, and unsigned apps do not launch on
    // Apple Silicon.
    run('codesign', [
      '--force',
      '--deep',
      '--sign',
      '-',
      join(packagedDirectory, 'Electron.app'),
    ]);
    return join(
      packagedDirectory,
      'Electron.app',
      'Contents',
      'MacOS',
      'Electron',
    );
  }
  if (process.platform === 'win32') {
    return join(packagedDirectory, 'electron.exe');
  }
  return join(packagedDirectory, 'electron');
}

function launchApp(binaryPath, userDataDirectory, serverDomain, publicKey) {
  // `--no-sandbox` is required on Linux CI: the Electron distribution is
  // copied into place by the drill, so its `chrome-sandbox` helper is not
  // owned by root with the setuid bit, and the runner (Ubuntu) also
  // restricts unprivileged user namespaces. Without this flag Electron
  // aborts on launch and never writes any engine state. Harmless on macOS
  // and Windows, which do not use the SUID sandbox.
  const child = spawn(binaryPath, ['--no-sandbox'], {
    env: {
      ...process.env,
      EXAMPLE_AUTO_UPDATE: 'background',
      EXAMPLE_PUBLIC_KEY: publicKey,
      // Generous watchdog ceiling: a cold Electron boot on a slow CI
      // runner can take longer than 10 s to call ready(). If the
      // watchdog fires during a legitimate boot it rolls back AND
      // blocks the bundle (autoBlockRolledBackBundles), after which
      // the drill's expected states are unreachable. The drill tests
      // rollback via kills, never by waiting for this timer.
      EXAMPLE_READY_TIMEOUT: '60000',
      EXAMPLE_SERVER_DOMAIN: serverDomain,
      EXAMPLE_USER_DATA: userDataDirectory,
    },
    // Keep stderr attached so a launch failure (e.g. the Chromium
    // sandbox aborting on CI) surfaces in the logs instead of leaving
    // waitForState to time out with no explanation.
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return child;
}

function killHard(child) {
  child.kill('SIGKILL');
}

async function main() {
  const binaryPath = await packageApp();
  console.log(`[drill] Packaged binary: ${binaryPath}`);
  await writeFile(join(artifactsDirectory, 'binary-path.txt'), binaryPath);
  const userDataDirectory = await createUserDataDirectory();
  const mockServer = await startMockServer(MOCK_PORT, '2.0.0');
  const publicKey = await getExamplePublicKey();
  try {
    // Run 1: built-in bundle boots, background sync fetches 2.0.0.
    console.log('[drill] Run 1: sync the good bundle 2.0.0...');
    let app = launchApp(
      binaryPath,
      userDataDirectory,
      mockServer.serverDomain,
      publicKey,
    );
    await waitForState(
      userDataDirectory,
      'nextBundleId == 2.0.0',
      state => state.nextBundleId === '2.0.0',
    );
    killHard(app);

    // Run 2: 2.0.0 is promoted, the renderer calls ready() and the
    // broken bundle (now offered by the server) is synced as next.
    console.log('[drill] Run 2: prove 2.0.0 and sync the broken bundle...');
    await mockServer.setLatest('3.0.0-broken');
    app = launchApp(
      binaryPath,
      userDataDirectory,
      mockServer.serverDomain,
      publicKey,
    );
    await waitForState(
      userDataDirectory,
      '2.0.0 proven and 3.0.0-broken pending',
      state =>
        state.currentBundleId === '2.0.0' &&
        state.lastSuccessfulBundleId === '2.0.0' &&
        state.pendingBoot === null &&
        state.nextBundleId === '3.0.0-broken',
    );
    killHard(app);

    // Run 3: the broken bundle is promoted and its pending-boot marker
    // is written. The bundle never calls ready(). Kill during boot.
    console.log(
      '[drill] Run 3: boot the broken bundle and kill during boot...',
    );
    app = launchApp(
      binaryPath,
      userDataDirectory,
      mockServer.serverDomain,
      publicKey,
    );
    await waitForState(
      userDataDirectory,
      '3.0.0-broken active with pending-boot marker',
      state =>
        state.currentBundleId === '3.0.0-broken' &&
        state.pendingBoot?.bundleId === '3.0.0-broken',
    );
    killHard(app);
    const stateAfterKill = await readState(userDataDirectory);
    assert.equal(
      stateAfterKill.pendingBoot?.bundleId,
      '3.0.0-broken',
      'marker must survive the kill',
    );

    // Run 4: the engine must detect the uncleared marker, revert to
    // the last successful bundle and block the broken one.
    console.log('[drill] Run 4: relaunch and verify the rollback...');
    app = launchApp(
      binaryPath,
      userDataDirectory,
      mockServer.serverDomain,
      publicKey,
    );
    await waitForState(
      userDataDirectory,
      'rolled back to 2.0.0 with 3.0.0-broken blocked',
      state =>
        state.currentBundleId === '2.0.0' &&
        state.pendingBoot === null &&
        state.blockedBundleIds.includes('3.0.0-broken'),
    );
    // The renderer of 2.0.0 must come up and call ready() again.
    await waitForState(
      userDataDirectory,
      'ready() called after the rollback',
      state => state.previousBundleId === '2.0.0',
    );
    // The mock server still offers the broken bundle; the background
    // sync of this run must have skipped it because it is blocked.
    await new Promise(resolve => setTimeout(resolve, 3000));
    const finalState = await readState(userDataDirectory);
    assert.notEqual(
      finalState.nextBundleId,
      '3.0.0-broken',
      'blocked bundle must not be set as next again',
    );
    assert.equal(finalState.currentBundleId, '2.0.0');
    killHard(app);

    console.log(
      '[drill] PASSED: kill-during-boot rollback verified against the packaged app.',
    );
  } finally {
    mockServer.stop();
  }
}

await main();

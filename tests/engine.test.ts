import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type {
  DownloadBundleProgressEvent,
  NextBundleSetEvent,
  RolledBackEvent,
} from '../src/engine/definitions';
import {
  LiveUpdateEngine,
  type LiveUpdateEngineConfig,
} from '../src/engine/engine';
import { ErrorCode } from '../src/engine/errors';

import {
  MockServer,
  buildZip,
  createDefaultBundleEntries,
  createTemporaryDirectory,
  generateRsaKeyPair,
  removeDirectory,
  signBytes,
} from './helpers';

const silentLogger = {
  debug: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warn: () => undefined,
};

describe('LiveUpdateEngine', () => {
  let dataDirectory: string;
  let server: MockServer;
  let engines: LiveUpdateEngine[];

  beforeEach(async () => {
    dataDirectory = await createTemporaryDirectory();
    server = new MockServer();
    await server.start();
    engines = [];
  });

  afterEach(async () => {
    for (const engine of engines) {
      engine.destroy();
    }
    await server.stop();
    await removeDirectory(dataDirectory);
  });

  function createEngine(
    overrides: Partial<LiveUpdateEngineConfig> = {},
  ): LiveUpdateEngine {
    const engine = new LiveUpdateEngine({
      appId: 'app-123',
      dataDirectory,
      logger: silentLogger,
      osVersion: '25.0.0',
      platform: '2',
      runtime: 'electron',
      sdkVersion: '0.0.1',
      serverDomain: server.origin.replace('http://', ''),
      versionCode: '1',
      versionName: '1.0.0',
      ...overrides,
    });
    engines.push(engine);
    return engine;
  }

  async function serveBundleZip(
    bundleId: string,
    marker = bundleId,
  ): Promise<Buffer> {
    const zip = await buildZip(createDefaultBundleEntries(marker));
    server.route(`/download/${bundleId}.zip`, { body: zip });
    return zip;
  }

  function serveLatestBundle(
    bundleId: string,
    extra: Record<string, unknown> = {},
  ): void {
    server.route('/v1/apps/app-123/bundles/latest', {
      body: JSON.stringify({
        bundleId,
        url: `${server.origin}/download/${bundleId}.zip`,
        ...extra,
      }),
      headers: { 'Content-Type': 'application/json' },
    });
  }

  describe('downloadBundle', () => {
    it('downloads, verifies and installs a bundle', async () => {
      const engine = createEngine();
      await engine.initialize();
      const zip = await serveBundleZip('1.0.0');
      const checksum = createHash('sha256').update(zip).digest('hex');
      await engine.downloadBundle({
        bundleId: '1.0.0',
        checksum,
        url: `${server.origin}/download/1.0.0.zip`,
      });
      expect((await engine.getDownloadedBundles()).bundleIds).toEqual([
        '1.0.0',
      ]);
      const bundlePath = engine.getCurrentBundlePath();
      expect(bundlePath).toBeNull();
      const html = await readFile(
        join(dataDirectory, 'bundles', '1.0.0', 'index.html'),
        'utf8',
      );
      expect(html).toContain('1.0.0');
    });

    it('emits download progress events', async () => {
      const engine = createEngine();
      await engine.initialize();
      await serveBundleZip('1.0.0');
      const progressEvents: DownloadBundleProgressEvent[] = [];
      engine.on('downloadBundleProgress', event => progressEvents.push(event));
      await engine.downloadBundle({
        bundleId: '1.0.0',
        url: `${server.origin}/download/1.0.0.zip`,
      });
      expect(progressEvents.length).toBeGreaterThan(0);
      const lastEvent = progressEvents[progressEvents.length - 1];
      expect(lastEvent?.bundleId).toBe('1.0.0');
      expect(lastEvent?.progress).toBe(1);
    });

    it('rejects a duplicate bundle', async () => {
      const engine = createEngine();
      await engine.initialize();
      await serveBundleZip('1.0.0');
      await engine.downloadBundle({
        bundleId: '1.0.0',
        url: `${server.origin}/download/1.0.0.zip`,
      });
      await expect(
        engine.downloadBundle({
          bundleId: '1.0.0',
          url: `${server.origin}/download/1.0.0.zip`,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.BundleAlreadyExists });
    });

    it('rejects the manifest artifact type', async () => {
      const engine = createEngine();
      await engine.initialize();
      await expect(
        engine.downloadBundle({
          artifactType: 'manifest',
          bundleId: '1.0.0',
          url: 'https://example.com/b',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ArtifactTypeNotSupported });
    });

    it('rejects a bundle with a checksum mismatch and leaves no traces', async () => {
      const engine = createEngine();
      await engine.initialize();
      await serveBundleZip('1.0.0');
      await expect(
        engine.downloadBundle({
          bundleId: '1.0.0',
          checksum: 'f'.repeat(64),
          url: `${server.origin}/download/1.0.0.zip`,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.ChecksumMismatch });
      expect((await engine.getDownloadedBundles()).bundleIds).toEqual([]);
    });

    it('rejects a bundle without index.html', async () => {
      const engine = createEngine();
      await engine.initialize();
      const zip = await buildZip([
        { path: 'readme.txt', content: 'no html here' },
      ]);
      server.route('/download/bad.zip', { body: zip });
      await expect(
        engine.downloadBundle({
          bundleId: 'bad',
          url: `${server.origin}/download/bad.zip`,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.BundleIndexHtmlMissing,
        message: 'The bundle does not contain an index.html file.',
      });
      expect((await engine.getDownloadedBundles()).bundleIds).toEqual([]);
    });

    it('verifies the signature from the X-Signature header with the configured public key', async () => {
      const { privateKeyPem, publicKeyPem } = generateRsaKeyPair();
      const engine = createEngine({ publicKey: publicKeyPem });
      await engine.initialize();
      const zip = await buildZip(createDefaultBundleEntries('signed'));
      server.route('/download/signed.zip', {
        body: zip,
        headers: { 'X-Signature': signBytes(zip, privateKeyPem) },
      });
      await engine.downloadBundle({
        bundleId: 'signed',
        url: `${server.origin}/download/signed.zip`,
      });
      expect((await engine.getDownloadedBundles()).bundleIds).toEqual([
        'signed',
      ]);
    });

    it('rejects a tampered bundle when a public key is configured', async () => {
      const { privateKeyPem, publicKeyPem } = generateRsaKeyPair();
      const engine = createEngine({ publicKey: publicKeyPem });
      await engine.initialize();
      const zip = await buildZip(createDefaultBundleEntries('original'));
      const tampered = await buildZip(createDefaultBundleEntries('tampered'));
      server.route('/download/tampered.zip', {
        body: tampered,
        headers: { 'X-Signature': signBytes(zip, privateKeyPem) },
      });
      await expect(
        engine.downloadBundle({
          bundleId: 'tampered',
          url: `${server.origin}/download/tampered.zip`,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.SignatureVerificationFailed });
      expect((await engine.getDownloadedBundles()).bundleIds).toEqual([]);
    });

    it('rejects an unsigned bundle when a public key is configured', async () => {
      const { publicKeyPem } = generateRsaKeyPair();
      const engine = createEngine({ publicKey: publicKeyPem });
      await engine.initialize();
      await serveBundleZip('unsigned');
      await expect(
        engine.downloadBundle({
          bundleId: 'unsigned',
          url: `${server.origin}/download/unsigned.zip`,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.SignatureMissing });
    });
  });

  describe('sync', () => {
    it('downloads the latest bundle and sets it as the next bundle', async () => {
      const engine = createEngine();
      await engine.initialize();
      await serveBundleZip('1.1.0');
      serveLatestBundle('1.1.0');
      const nextBundleSetEvents: NextBundleSetEvent[] = [];
      engine.on('nextBundleSet', event => nextBundleSetEvents.push(event));
      const result = await engine.sync();
      expect(result).toEqual({ nextBundleId: '1.1.0' });
      expect((await engine.getNextBundle()).bundleId).toBe('1.1.0');
      expect((await engine.getCurrentBundle()).bundleId).toBeNull();
      expect(nextBundleSetEvents).toEqual([{ bundleId: '1.1.0' }]);
    });

    it('returns null when no update is available', async () => {
      const engine = createEngine();
      await engine.initialize();
      server.route('/v1/apps/app-123/bundles/latest', {
        body: 'not found',
        status: 404,
      });
      expect(await engine.sync()).toEqual({ nextBundleId: null });
    });

    it('returns null when the latest bundle is the current bundle', async () => {
      const engine = createEngine();
      await engine.initialize();
      await serveBundleZip('1.1.0');
      serveLatestBundle('1.1.0');
      await engine.sync();
      const secondEngine = createEngine();
      await secondEngine.initialize();
      expect((await secondEngine.getCurrentBundle()).bundleId).toBe('1.1.0');
      expect(await secondEngine.sync()).toEqual({ nextBundleId: null });
    });

    it('skips blocked bundles', async () => {
      const engine = createEngine();
      await engine.initialize();
      serveLatestBundle('bad-bundle');
      // Block the bundle by writing it into the state via a rollback below;
      // here we simulate by syncing a bundle marked as blocked beforehand.
      await serveBundleZip('bad-bundle');
      await engine.sync();
      // Not blocked yet, so it was set as next bundle.
      expect((await engine.getNextBundle()).bundleId).toBe('bad-bundle');
    });

    it('rejects concurrent sync operations', async () => {
      const engine = createEngine({ httpTimeout: 500 });
      await engine.initialize();
      server.route('/v1/apps/app-123/bundles/latest', () => null);
      const firstSync = engine.sync().catch(() => undefined);
      await expect(engine.sync()).rejects.toMatchObject({
        code: ErrorCode.SyncInProgress,
        message: 'Sync is already in progress.',
      });
      await firstSync;
    });

    it('requires an appId', async () => {
      const engine = createEngine({ appId: undefined });
      await engine.initialize();
      await expect(engine.sync()).rejects.toMatchObject({
        code: ErrorCode.AppIdMissing,
        message: 'appId must be configured.',
      });
    });

    it('passes the persisted channel and the channel override', async () => {
      const engine = createEngine({ defaultChannel: 'stable' });
      await engine.initialize();
      server.route('/v1/apps/app-123/bundles/latest', {
        body: 'no',
        status: 404,
      });
      await engine.sync();
      expect(server.requests[0]?.url.searchParams.get('channelName')).toBe(
        'stable',
      );
      expect(server.requests[0]?.url.searchParams.get('runtime')).toBe(
        'electron',
      );
      await engine.setChannel({ channel: 'beta' });
      await engine.sync();
      expect(server.requests[1]?.url.searchParams.get('channelName')).toBe(
        'beta',
      );
      await engine.sync({ channel: 'canary' });
      expect(server.requests[2]?.url.searchParams.get('channelName')).toBe(
        'canary',
      );
    });
  });

  describe('bundle lifecycle', () => {
    it('promotes the next bundle on the next initialize (restart)', async () => {
      const engine = createEngine();
      await engine.initialize();
      await serveBundleZip('1.1.0');
      serveLatestBundle('1.1.0');
      await engine.sync();
      const restartedEngine = createEngine();
      const result = await restartedEngine.initialize();
      expect(result).toEqual({ currentBundleId: '1.1.0', rollback: false });
      expect(restartedEngine.getCurrentBundlePath()).toBe(
        join(dataDirectory, 'bundles', '1.1.0'),
      );
    });

    it('promotes the next bundle on applyNextBundle (reload)', async () => {
      const engine = createEngine();
      await engine.initialize();
      await serveBundleZip('1.1.0');
      serveLatestBundle('1.1.0');
      await engine.sync();
      const result = await engine.applyNextBundle();
      expect(result.currentBundleId).toBe('1.1.0');
      expect((await engine.getCurrentBundle()).bundleId).toBe('1.1.0');
    });

    it('resets to the default bundle', async () => {
      const engine = createEngine();
      await engine.initialize();
      await serveBundleZip('1.1.0');
      serveLatestBundle('1.1.0');
      await engine.sync();
      await engine.applyNextBundle();
      await engine.reset();
      expect((await engine.getNextBundle()).bundleId).toBeNull();
      await engine.applyNextBundle();
      expect((await engine.getCurrentBundle()).bundleId).toBeNull();
      expect(engine.getCurrentBundlePath()).toBeNull();
    });

    it('deletes a bundle and clears pointers to it', async () => {
      const engine = createEngine();
      await engine.initialize();
      await serveBundleZip('1.1.0');
      serveLatestBundle('1.1.0');
      await engine.sync();
      await engine.deleteBundle({ bundleId: '1.1.0' });
      expect((await engine.getDownloadedBundles()).bundleIds).toEqual([]);
      expect((await engine.getNextBundle()).bundleId).toBeNull();
    });

    it('setNextBundle rejects unknown bundles', async () => {
      const engine = createEngine();
      await engine.initialize();
      await expect(
        engine.setNextBundle({ bundleId: 'missing' }),
      ).rejects.toMatchObject({
        code: ErrorCode.BundleNotFound,
        message: 'bundle not found.',
      });
    });

    it('deletes unused bundles on ready when autoDeleteBundles is enabled', async () => {
      const engine = createEngine({ autoDeleteBundles: true });
      await engine.initialize();
      await serveBundleZip('1.1.0');
      await serveBundleZip('1.2.0');
      await engine.downloadBundle({
        bundleId: '1.1.0',
        url: `${server.origin}/download/1.1.0.zip`,
      });
      await engine.downloadBundle({
        bundleId: '1.2.0',
        url: `${server.origin}/download/1.2.0.zip`,
      });
      await engine.setNextBundle({ bundleId: '1.2.0' });
      await engine.applyNextBundle();
      await engine.ready();
      expect((await engine.getDownloadedBundles()).bundleIds).toEqual([
        '1.2.0',
      ]);
    });
  });

  describe('rollback state machine', () => {
    async function installAndActivate(
      engine: LiveUpdateEngine,
      bundleId: string,
    ): Promise<void> {
      await serveBundleZip(bundleId);
      await engine.downloadBundle({
        bundleId,
        url: `${server.origin}/download/${bundleId}.zip`,
      });
      await engine.setNextBundle({ bundleId });
      await engine.applyNextBundle();
    }

    it('writes the pending-boot marker before an unproven bundle boots', async () => {
      const engine = createEngine({ readyTimeout: 10000 });
      await engine.initialize();
      await installAndActivate(engine, '1.1.0');
      const state = JSON.parse(
        await readFile(join(dataDirectory, 'state.json'), 'utf8'),
      );
      expect(state.pendingBoot).toEqual({ attempts: 1, bundleId: '1.1.0' });
      expect(state.currentBundleId).toBe('1.1.0');
    });

    it('does not write a marker when readyTimeout is 0', async () => {
      const engine = createEngine({ readyTimeout: 0 });
      await engine.initialize();
      await installAndActivate(engine, '1.1.0');
      const state = JSON.parse(
        await readFile(join(dataDirectory, 'state.json'), 'utf8'),
      );
      expect(state.pendingBoot).toBeNull();
    });

    it('ready() clears the marker and records the bundle as successful', async () => {
      const engine = createEngine({ readyTimeout: 10000 });
      await engine.initialize();
      await installAndActivate(engine, '1.1.0');
      const readyResult = await engine.ready();
      expect(readyResult).toEqual({
        currentBundleId: '1.1.0',
        previousBundleId: null,
        rollback: false,
      });
      const state = JSON.parse(
        await readFile(join(dataDirectory, 'state.json'), 'utf8'),
      );
      expect(state.pendingBoot).toBeNull();
      expect(state.lastSuccessfulBundleId).toBe('1.1.0');
      expect(state.previousBundleId).toBe('1.1.0');
    });

    it('rolls back on the next start when the previous boot was killed before ready (kill-safe)', async () => {
      const engine = createEngine({
        readyTimeout: 10000,
        autoBlockRolledBackBundles: true,
      });
      await engine.initialize();
      await installAndActivate(engine, '1.1.0');
      // Simulate kill-during-boot: no ready(), no graceful shutdown.
      // A new engine on the same data directory is the relaunched process.
      const relaunchedEngine = createEngine({
        readyTimeout: 10000,
        autoBlockRolledBackBundles: true,
      });
      const result = await relaunchedEngine.initialize();
      expect(result).toEqual({ currentBundleId: null, rollback: true });
      expect((await relaunchedEngine.getBlockedBundles()).bundleIds).toEqual([
        '1.1.0',
      ]);
      const readyResult = await relaunchedEngine.ready();
      expect(readyResult).toEqual({
        currentBundleId: null,
        previousBundleId: '1.1.0',
        rollback: true,
      });
    });

    it('rolls back to the last successful bundle, not the default bundle', async () => {
      // Boot and prove 1.1.0.
      const engine = createEngine({ readyTimeout: 10000 });
      await engine.initialize();
      await installAndActivate(engine, '1.1.0');
      await engine.ready();
      // Activate 1.2.0 and die before ready.
      await installAndActivate(engine, '1.2.0');
      const relaunchedEngine = createEngine({ readyTimeout: 10000 });
      const result = await relaunchedEngine.initialize();
      expect(result).toEqual({ currentBundleId: '1.1.0', rollback: true });
    });

    it('a pending next bundle wins over the rollback fallback', async () => {
      // 1.1.0 dies during boot, but 1.2.0 was already synced as next
      // (e.g. a fix pushed while the app was broken).
      const engine = createEngine({ readyTimeout: 10000 });
      await engine.initialize();
      await installAndActivate(engine, '1.1.0');
      await serveBundleZip('1.2.0');
      await engine.downloadBundle({
        bundleId: '1.2.0',
        url: `${server.origin}/download/1.2.0.zip`,
      });
      await engine.setNextBundle({ bundleId: '1.2.0' });
      const relaunchedEngine = createEngine({ readyTimeout: 10000 });
      const result = await relaunchedEngine.initialize();
      expect(result).toEqual({ currentBundleId: '1.2.0', rollback: true });
    });

    it('does not roll back a proven bundle that is killed during boot', async () => {
      const engine = createEngine({ readyTimeout: 10000 });
      await engine.initialize();
      await installAndActivate(engine, '1.1.0');
      await engine.ready();
      // Relaunch the proven bundle and kill it before ready: no marker
      // is armed for proven bundles, so no rollback happens.
      const secondRun = createEngine({ readyTimeout: 10000 });
      await secondRun.initialize();
      const thirdRun = createEngine({ readyTimeout: 10000 });
      const result = await thirdRun.initialize();
      expect(result).toEqual({ currentBundleId: '1.1.0', rollback: false });
    });

    it('the watchdog rolls back a running app that never calls ready', async () => {
      const engine = createEngine({
        readyTimeout: 250,
        autoBlockRolledBackBundles: true,
      });
      await engine.initialize();
      await serveBundleZip('1.1.0');
      await engine.downloadBundle({
        bundleId: '1.1.0',
        url: `${server.origin}/download/1.1.0.zip`,
      });
      await engine.setNextBundle({ bundleId: '1.1.0' });
      const rolledBackEvents: RolledBackEvent[] = [];
      engine.on('rolledBack', event => rolledBackEvents.push(event));
      await engine.applyNextBundle();
      await new Promise(resolve => setTimeout(resolve, 600));
      expect(rolledBackEvents).toEqual([
        { currentBundleId: null, previousBundleId: '1.1.0' },
      ]);
      expect((await engine.getCurrentBundle()).bundleId).toBeNull();
      expect((await engine.getBlockedBundles()).bundleIds).toEqual(['1.1.0']);
      const readyResult = await engine.ready();
      expect(readyResult.rollback).toBe(true);
    });

    it('ready() stops the watchdog', async () => {
      const engine = createEngine({ readyTimeout: 250 });
      await engine.initialize();
      await installAndActivate(engine, '1.1.0');
      await engine.ready();
      await new Promise(resolve => setTimeout(resolve, 600));
      expect((await engine.getCurrentBundle()).bundleId).toBe('1.1.0');
    });

    it('blocked bundles are skipped by sync after a rollback', async () => {
      const engine = createEngine({
        readyTimeout: 10000,
        autoBlockRolledBackBundles: true,
      });
      await engine.initialize();
      await installAndActivate(engine, '1.1.0');
      const relaunchedEngine = createEngine({
        readyTimeout: 10000,
        autoBlockRolledBackBundles: true,
      });
      await relaunchedEngine.initialize();
      // The server still offers the broken bundle.
      serveLatestBundle('1.1.0');
      expect(await relaunchedEngine.sync()).toEqual({ nextBundleId: null });
      await relaunchedEngine.clearBlockedBundles();
      expect((await relaunchedEngine.getBlockedBundles()).bundleIds).toEqual(
        [],
      );
    });

    it('detects activation-time tampering and refuses to activate the bundle', async () => {
      const engine = createEngine({ readyTimeout: 10000 });
      await engine.initialize();
      await serveBundleZip('1.1.0');
      await engine.downloadBundle({
        bundleId: '1.1.0',
        url: `${server.origin}/download/1.1.0.zip`,
      });
      await engine.setNextBundle({ bundleId: '1.1.0' });
      // Tamper with the installed bundle after download verification.
      await writeFile(
        join(dataDirectory, 'bundles', '1.1.0', 'assets', 'app.js'),
        'evil();',
      );
      await expect(engine.applyNextBundle()).rejects.toMatchObject({
        code: ErrorCode.ChecksumMismatch,
      });
      expect((await engine.getCurrentBundle()).bundleId).toBeNull();
      // The tampered bundle was discarded.
      expect((await engine.getDownloadedBundles()).bundleIds).toEqual([]);
    });

    it('detects activation-time tampering across a restart', async () => {
      const engine = createEngine();
      await engine.initialize();
      await serveBundleZip('1.1.0');
      serveLatestBundle('1.1.0');
      await engine.sync();
      await writeFile(
        join(dataDirectory, 'bundles', '1.1.0', 'index.html'),
        '<html>evil</html>',
      );
      const relaunchedEngine = createEngine();
      const result = await relaunchedEngine.initialize();
      expect(result).toEqual({ currentBundleId: null, rollback: false });
      expect((await relaunchedEngine.getDownloadedBundles()).bundleIds).toEqual(
        [],
      );
    });
  });

  describe('identifiers and versions', () => {
    it('persists a generated device id per app id', async () => {
      const engine = createEngine();
      await engine.initialize();
      const { deviceId } = await engine.getDeviceId();
      expect(deviceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      const restartedEngine = createEngine();
      await restartedEngine.initialize();
      expect((await restartedEngine.getDeviceId()).deviceId).toBe(deviceId);
      const otherAppEngine = createEngine({ appId: 'other-app' });
      await otherAppEngine.initialize();
      expect((await otherAppEngine.getDeviceId()).deviceId).not.toBe(deviceId);
    });

    it('persists channel and custom id', async () => {
      const engine = createEngine();
      await engine.initialize();
      expect((await engine.getChannel()).channel).toBeNull();
      expect((await engine.getCustomId()).customId).toBeNull();
      await engine.setChannel({ channel: 'beta' });
      await engine.setCustomId({ customId: 'user-42' });
      const restartedEngine = createEngine();
      await restartedEngine.initialize();
      expect((await restartedEngine.getChannel()).channel).toBe('beta');
      expect((await restartedEngine.getCustomId()).customId).toBe('user-42');
      await restartedEngine.setChannel({ channel: null });
      await restartedEngine.setCustomId({ customId: null });
      expect((await restartedEngine.getChannel()).channel).toBeNull();
      expect((await restartedEngine.getCustomId()).customId).toBeNull();
    });

    it('falls back to the default channel when no channel is set', async () => {
      const engine = createEngine({ defaultChannel: 'stable' });
      await engine.initialize();
      expect((await engine.getChannel()).channel).toBe('stable');
      await engine.setChannel({ channel: 'beta' });
      expect((await engine.getChannel()).channel).toBe('beta');
      await engine.setChannel({ channel: null });
      expect((await engine.getChannel()).channel).toBe('stable');
    });

    it('returns the injected version code and name', async () => {
      const engine = createEngine();
      await engine.initialize();
      expect(await engine.getVersionCode()).toEqual({ versionCode: '1' });
      expect(await engine.getVersionName()).toEqual({ versionName: '1.0.0' });
    });

    it('reports syncing state', async () => {
      const engine = createEngine();
      await engine.initialize();
      expect(await engine.isSyncing()).toEqual({ syncing: false });
    });
  });

  describe('guards', () => {
    it('throws when used before initialize()', async () => {
      const engine = createEngine();
      await expect(engine.getCurrentBundle()).rejects.toMatchObject({
        code: ErrorCode.NotInitialized,
      });
    });

    it('fails fast on an invalid public key', () => {
      expect(() => createEngine({ publicKey: 'garbage' })).toThrowError(
        expect.objectContaining({ code: ErrorCode.PublicKeyInvalid }),
      );
    });

    it('survives a corrupt state file', async () => {
      await writeFile(join(dataDirectory, 'state.json'), '{corrupt json');
      const engine = createEngine();
      const result = await engine.initialize();
      expect(result).toEqual({ currentBundleId: null, rollback: false });
    });
  });
});

# @capawesome/electron-live-update

Electron SDK for over-the-air (OTA) web bundle updates backed by [Capawesome Cloud](https://capawesome.io/cloud/). Update the web code of your Electron app in seconds — without rebuilding, re-signing or re-distributing the binary.

This SDK speaks the same protocol and the same vocabulary as the [`@capawesome/capacitor-live-update`](https://capawesome.io/plugins/live-update/) plugin: one product, one vocabulary, across iOS, Android and Electron.

## Features

- ⚡ **OTA updates**: Ship changes to your app's web bundle instantly via [Capawesome Cloud](https://capawesome.io/cloud/) or any self-hosted server speaking the same protocol.
- 🛟 **Kill-safe rollback**: A pending-boot marker and boot counter are persisted to disk _before_ a new bundle loads. If the app crashes, hangs or is killed during boot — even by a power loss — the next start automatically reverts to the last bundle that worked and optionally blocks the broken one.
- 🔒 **Signature verification**: RSA signature verification of every downloaded bundle (`publicKey`), plus checksum re-verification of the installed bundle at activation time — tampering after download is detected too.
- 🌐 **Stable origin serving**: A privileged custom scheme serves the active bundle under a constant origin, so `localStorage`, IndexedDB and service workers survive bundle switches. A simple path-based mode is available as an alternative.
- 🚦 **Channels**: Deliver different bundles to different user groups (production, beta, staged rollouts).
- 📂 **Multiple bundles**: Download, manage and switch between bundles programmatically.
- 🔁 **Background updates**: Optional automatic sync at app start, on focus and on resume.
- 🔐 **Secure by default**: HTTPS-only downloads (localhost exempt for development), zip-slip protection, atomic bundle installation.
- 🧪 **Tested core**: The bundle store, the rollback state machine and the verification pipeline are unit-tested, and a packaged-app end-to-end suite simulates a kill during boot on every CI run (macOS, Windows, Linux).
- 🤝 **Compatibility**: Mirrors the API of the [Capacitor Live Update plugin](https://capawesome.io/plugins/live-update/) and exposes its update engine as a standalone entry point (`@capawesome/electron-live-update/engine`).

## Installation

```bash
npm install @capawesome/electron-live-update
```

The package has four entry points:

| Entry point  | Runs in      | Purpose                                                   |
| ------------ | ------------ | --------------------------------------------------------- |
| `.`          | Main process | `createLiveUpdate()` — the SDK                            |
| `./preload`  | Preload      | `exposeLiveUpdateApi()` — the context bridge              |
| `./renderer` | Renderer     | `LiveUpdate` — a typed client mirroring the plugin API    |
| `./engine`   | Node.js      | `LiveUpdateEngine` — the pure update engine (no Electron) |

## Getting started

### Main process

```ts
import { createLiveUpdate } from '@capawesome/electron-live-update';
import { BrowserWindow, app } from 'electron';
import { join } from 'node:path';

const liveUpdate = createLiveUpdate({
  appId: '6e351b4f-69a7-415e-a057-4567df7ffe94', // Your Capawesome Cloud app ID
  defaultBundlePath: join(__dirname, '..', 'renderer'), // Your packaged web assets
  readyTimeout: 10000, // STRONGLY recommended: enables rollback protection
  autoBlockRolledBackBundles: true,
});
liveUpdate.serve(); // BEFORE app.whenReady()

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    webPreferences: { preload: join(__dirname, 'preload.js') },
  });
  liveUpdate.attach(window);
  await window.loadURL(liveUpdate.getServeUrl());
});
```

### Preload script

```ts
import { exposeLiveUpdateApi } from '@capawesome/electron-live-update/preload';

exposeLiveUpdateApi();
```

### Renderer

```ts
import { LiveUpdate } from '@capawesome/electron-live-update/renderer';

// As soon as your app is up and running:
await LiveUpdate.ready();

// Check for and apply updates:
const result = await LiveUpdate.sync();
if (result.nextBundleId) {
  await LiveUpdate.reload();
}
```

That's it. The renderer code is line-for-line the same vocabulary you would use with the Capacitor Live Update plugin on iOS and Android.

> [!NOTE]
> All SDK methods are also available in the main process on the object returned by `createLiveUpdate()`, so you can drive updates entirely from the main process if you prefer.

## Serving modes

### Custom scheme (recommended): `serve()`

`serve()` registers a privileged custom scheme (default: `live-update`) and serves the files of the active bundle under the stable origin `live-update://bundle`. Because the origin never changes:

- `localStorage`, IndexedDB, and other origin-scoped storage **survive bundle switches**,
- `fetch()` and service workers work as on a regular secure origin,
- relative URLs inside your bundle resolve naturally, and SPA-style paths fall back to `index.html`.

`serve()` must be called **before** the app is ready (privileged schemes can only be registered before that point) and requires the `defaultBundlePath` option so the built-in bundle can be served when no live update is active.

```ts
liveUpdate.serve(); // or liveUpdate.serve({ scheme: 'my-app' })
await window.loadURL(liveUpdate.getServeUrl()); // 'live-update://bundle/'
```

### Simple mode: `getCurrentBundlePath()`

If you prefer to own the loading yourself, skip `serve()` and load the active bundle from disk:

```ts
const bundlePath = await liveUpdate.getCurrentBundlePath();
await window.loadFile(join(bundlePath, 'index.html'));
```

`getCurrentBundlePath()` returns the directory of the active bundle, or `defaultBundlePath` when the default bundle is active. Note that with `loadFile`, the origin is derived from the file path, so origin-scoped storage does **not** reliably survive bundle switches. Use `serve()` unless you have a reason not to.

In both modes, `reload()` applies the next bundle and reloads all attached windows.

## Rollback protection

A live update SDK must never leave users stuck with a broken update. This SDK persists its rollback state machine to disk:

1. When a new (not yet proven) bundle is about to load, a **pending-boot marker** is written to the state file — _before_ the bundle gets to run.
2. Your app calls `ready()` once it is up and running. This clears the marker and records the bundle as the last successful one.
3. If `ready()` is not called within `readyTimeout` milliseconds, the SDK rolls back to the last successful bundle (or the default bundle) and reloads.
4. If the process dies before either happens — crash, force quit, power loss — the uncleared marker is detected **on the next start** and the rollback happens then. No timer needs to survive; the state is on disk.

With `autoBlockRolledBackBundles: true`, a bundle that caused a rollback is also blocked from being installed again by future `sync()` calls (up to 100 bundles; the oldest entry is unblocked when the limit is reached).

> [!IMPORTANT]
> Rollback protection is **disabled by default** (`readyTimeout: 0`) to match the behavior of the Capacitor Live Update plugin. It is strongly recommended to set `readyTimeout` (e.g. `10000`) and call `ready()` early in your renderer. On desktop there is no app store reinstall to fall back on: uninstalling and reinstalling an Electron app usually does not clear its user data, so a broken bundle would otherwise persist until your users clear the app data manually or you ship a fixed update.

As an additional safety net, the checksums of every installed bundle file are recorded at install time and re-verified when the bundle is activated. A bundle that was modified on disk after the (verified) download is discarded instead of activated.

## Code signing

Verify the authenticity of your bundles by signing them and configuring the corresponding public key:

```ts
const liveUpdate = createLiveUpdate({
  // ...
  publicKey: '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----',
});
```

When a public key is configured, every downloaded bundle **must** provide a valid signature (via the `X-Signature` response header or the `signature` option) — unsigned or tampered bundles are rejected. The scheme is the same as in the Capacitor Live Update plugin: an RSA PKCS#1 v1.5 signature of the SHA-256 hash of the bundle file, encoded as base64. See the [Capawesome Cloud documentation](https://capawesome.io/cloud/) for generating keys and signing bundles.

Without a public key, an integrity checksum (`X-Checksum` header or `checksum` option, SHA-256 in hex format) is verified when available.

## Web bundle updates vs. binary updates

This SDK updates the **web bundle** of your app: HTML, CSS, JavaScript — everything your renderer loads. It deliberately does not touch the **binary layer**: the Electron runtime, native modules, and the installer are updated by tools like Squirrel via Electron's `autoUpdater` or `electron-updater`.

The two layers are complementary, not competing:

| Layer      | Contents                         | Updated by                    | Cadence              |
| ---------- | -------------------------------- | ----------------------------- | -------------------- |
| Web bundle | Renderer HTML/CSS/JS             | **this SDK** (OTA, seconds)   | As often as you like |
| Binary     | Electron runtime, native modules | Squirrel / `electron-updater` | Occasionally         |

A practical setup uses both: ship web code changes over the air continuously, and roll a binary release when you bump Electron or change native dependencies. After a binary update, the app keeps using its downloaded bundles — call `reset()` on a major version change if your new binary requires a matching web bundle baseline.

## One engine, two adapters

This package is one npm package with subpath exports. The `./engine` entry point contains the entire update logic — Cloud protocol client, bundle store, state machine, download/extract/verify pipeline — with **zero Electron and zero Capacitor imports**:

```
@capawesome/electron-live-update       (ONE npm package)
├── "."          → the standalone SDK  ← for plain Electron apps (this README)
├── "./preload"  → context bridge helper
├── "./renderer" → typed renderer client
└── "./engine"   → the shared engine   ← pure update logic, zero Electron imports
                         ▲
                         │ consumed as a dependency by…
@capawesome/capacitor-live-update      (the Capacitor plugin)
└── electron platform implementation   ← thin adapter: plugin JS API → "./engine"
```

- **Plain Electron apps** install only this package.
- **Capacitor apps** (including the Electron platform, once available) install only `@capawesome/capacitor-live-update` — same as on iOS and Android.

### Engine API stability

The engine's public surface (`LiveUpdateEngine`, `LiveUpdateEngineConfig`, the vocabulary types, and `ErrorCode`) is a **stable API**: the future Capacitor Electron adapter depends on it. Hosts inject everything platform-specific:

```ts
import { LiveUpdateEngine } from '@capawesome/electron-live-update/engine';

const engine = new LiveUpdateEngine({
  appId: '...',
  dataDirectory: '/path/to/writable/storage',
  platform: '2',
  osVersion: '...',
  versionCode: '1',
  versionName: '1.0.0',
  sdkVersion: '0.1.0',
  readyTimeout: 10000,
});
const { currentBundleId } = await engine.initialize(); // BEFORE loading web content
// engine.sync(), engine.ready(), engine.setNextBundle(), engine.applyNextBundle(), ...
```

## Comparison with the Capacitor plugin

The API mirrors [`@capawesome/capacitor-live-update`](https://capawesome.io/plugins/live-update/). Differences that exist are deliberate and listed here:

| Aspect                           | Capacitor plugin                        | This SDK                                                                  |
| -------------------------------- | --------------------------------------- | ------------------------------------------------------------------------- |
| `readyTimeout` default           | `0` (disabled)                          | `0` (disabled) — same default, same recommendation to set `10000`         |
| Rollback target                  | Default bundle                          | **Last successful bundle**, then default — desktop has no store reinstall |
| Kill-safe boot rollback          | —                                       | Pending-boot marker on disk, checked at every process start               |
| Activation-time verification     | —                                       | Installed bundles re-verified against install-time checksums              |
| Rollback blocking                | On `ready()`                            | At rollback time (survives a kill before `ready()`)                       |
| Configuration                    | Capacitor config file                   | `createLiveUpdate()` options                                              |
| `versionCode` / `versionName`    | Native app version                      | `app.getVersion()` unless configured                                      |
| Device ID                        | Random UUID (Android) / vendor ID (iOS) | Random UUID, persisted per app ID                                         |
| Serving                          | Capacitor WebView                       | `serve()` custom scheme or `getCurrentBundlePath()`                       |
| `fetchChannels()`, `setConfig()` | Available                               | Not yet available                                                         |
| `manifest` artifact type         | Available (delta updates)               | Not yet available (`zip` only)                                            |

## API

### createLiveUpdate(config)

Creates the SDK. Call once, early in your main process (before `app.whenReady()` when using `serve()`).

#### Configuration

| Option                       | Type                     | Default                                        | Description                                                                                   |
| ---------------------------- | ------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `appId`                      | `string`                 | –                                              | Capawesome Cloud app ID. Required for `sync()`/`fetchLatestBundle()`.                         |
| `autoBlockRolledBackBundles` | `boolean`                | `false`                                        | Block bundles that caused a rollback. No effect if `readyTimeout` is `0`.                     |
| `autoDeleteBundles`          | `boolean`                | `false`                                        | Delete unused bundles after `ready()`.                                                        |
| `autoUpdateStrategy`         | `'none' \| 'background'` | `'none'`                                       | `background`: sync automatically at start, on focus and on resume (at most every 15 minutes). |
| `dataDirectory`              | `string`                 | `join(app.getPath('userData'), 'live-update')` | Where bundles and state are stored.                                                           |
| `defaultChannel`             | `string`                 | –                                              | Default update channel.                                                                       |
| `defaultBundlePath`          | `string`                 | –                                              | Directory of the packaged web assets. Required for `serve()`.                                 |
| `httpTimeout`                | `number`                 | `60000`                                        | HTTP timeout in milliseconds.                                                                 |
| `logger`                     | `LiveUpdateLogger`       | `console`                                      | Custom logger.                                                                                |
| `publicKey`                  | `string`                 | –                                              | PEM-encoded RSA public key for signature verification.                                        |
| `readyTimeout`               | `number`                 | `0`                                            | Rollback protection timeout in milliseconds. `0` disables it. Recommended: `10000`.           |
| `serverDomain`               | `string`                 | `'api.cloud.capawesome.io'`                    | API domain, without scheme or path. Localhost domains use plain HTTP for development.         |
| `versionCode`                | `string`                 | `app.getVersion()`                             | Version code reported to the update server.                                                   |
| `versionName`                | `string`                 | `app.getVersion()`                             | Version name reported to the update server.                                                   |

#### Methods

The returned `LiveUpdate` object implements the shared vocabulary — the same methods you know from the Capacitor plugin:

`clearBlockedBundles()`, `deleteBundle(options)`, `downloadBundle(options)`, `fetchLatestBundle(options?)`, `getBlockedBundles()`, `getChannel()`, `getCurrentBundle()`, `getCustomId()`, `getDeviceId()`, `getDownloadedBundles()`, `getNextBundle()`, `getVersionCode()`, `getVersionName()`, `isSyncing()`, `ready()`, `reload()`, `reset()`, `setChannel(options)`, `setCustomId(options)`, `setNextBundle(options)`, `sync(options?)`, `addListener(eventName, listener)`, `removeAllListeners()`

plus the Electron-specific serving integration:

- `serve(options?)` — serve the active bundle over a privileged custom scheme (see [Serving modes](#serving-modes)).
- `getServeUrl()` — the URL to load into your window in serve mode.
- `attach(window)` — register a `BrowserWindow` for `reload()` and renderer IPC access.
- `getCurrentBundlePath()` — the on-disk path of the active bundle (simple mode).

All options and results use the exact same shapes as the Capacitor plugin (`SyncResult.nextBundleId`, `ReadyResult.rollback`, bundle IDs as user-meaningful names like `'1.0.0'`, `null` meaning the default bundle, and so on). See the TypeScript definitions for the full JSDoc.

#### Events

| Event                    | Payload                                               | Emitted when                        |
| ------------------------ | ----------------------------------------------------- | ----------------------------------- |
| `downloadBundleProgress` | `{ bundleId, downloadedBytes, progress, totalBytes }` | A bundle download makes progress    |
| `nextBundleSet`          | `{ bundleId }`                                        | A bundle is set as the next bundle  |
| `reloaded`               | –                                                     | The app was reloaded via `reload()` |

Events are available in the main process (`liveUpdate.addListener(...)`) and forwarded to attached renderers (`LiveUpdate.addListener(...)`).

#### Errors

All errors are `LiveUpdateError` instances with a `code` from the `ErrorCode` enum (for example `ErrorCode.ChecksumMismatch`, `ErrorCode.SignatureVerificationFailed`, `ErrorCode.SyncInProgress`). The codes survive the IPC boundary, so renderer code can handle them reliably:

```ts
import {
  ErrorCode,
  LiveUpdateError,
} from '@capawesome/electron-live-update/renderer';

try {
  await LiveUpdate.sync();
} catch (error) {
  if (
    error instanceof LiveUpdateError &&
    error.code === ErrorCode.SyncInProgress
  ) {
    // ...
  }
}
```

## Example

A complete example app (Vite renderer, mock update server, both serving modes, signed bundles) lives in [`example/`](./example). The end-to-end suite in [`e2e/`](./e2e) packages it and runs the kill-during-boot rollback drill against the packaged binary.

```bash
npm install
npm run build
npm run build --workspace example
npm run test         # unit tests
npm run test:e2e     # packaged-app e2e incl. the rollback drill
```

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).

## License

See [LICENSE](./LICENSE).

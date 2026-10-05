# Changelog

## [0.1.0](https://github.com/capawesome-team/electron-live-update/compare/v0.0.1...v0.1.0) (2026-10-05)


### ⚠ BREAKING CHANGES

* a failed boot now reverts to the default bundle instead of the last bundle that called ready(); lastSuccessfulBundleId is no longer persisted.

### Features

* add channel discovery, config overrides and harden rollback ([a640716](https://github.com/capawesome-team/electron-live-update/commit/a6407161255fd6b5a003c7f75254bc7e44f4ab1f))
* add channel discovery, config overrides and harden rollback ([77a426d](https://github.com/capawesome-team/electron-live-update/commit/77a426d0660ea2680351c6dbab8a535c394bb461))
* add manifest delta updates, channel discovery, and rolledBack event ([92ba15f](https://github.com/capawesome-team/electron-live-update/commit/92ba15fcf3c800e08447178266cafdd8cb5de4a6))
* initial implementation ([59b37f3](https://github.com/capawesome-team/electron-live-update/commit/59b37f3991e6d3ad8ec24f8d8d62917d0431f38f))
* roll back to the default bundle like the Capacitor plugin ([4483a4d](https://github.com/capawesome-team/electron-live-update/commit/4483a4d48a35add29ba78d5d66229a3ff19aa9ea))
* send the electron runtime to Capawesome Cloud ([eb3486e](https://github.com/capawesome-team/electron-live-update/commit/eb3486ed47b2c4ebd7bc26248cf176523529d3f4))


### Bug Fixes

* address review feedback (portable tests, single href param, manifest checksum verification) ([78acf3e](https://github.com/capawesome-team/electron-live-update/commit/78acf3e508f833b6d3dae65b3d25c9b573654185))
* brand-namespace default data directory and scheme ([2ba564f](https://github.com/capawesome-team/electron-live-update/commit/2ba564f92a8b66ce286f9ad36f6f3aa06738a9ed))
* **e2e:** download the Electron binary when missing ([505c437](https://github.com/capawesome-team/electron-live-update/commit/505c43733a9a027ef12f8e73eb200b5604059f79))
* **e2e:** launch Electron with --no-sandbox in tests ([3cb5ab3](https://github.com/capawesome-team/electron-live-update/commit/3cb5ab35d1843dc0a8affb47d1aea985e24c61c9))
* make rollback reloads win navigation races and harden e2e timing ([d222bf6](https://github.com/capawesome-team/electron-live-update/commit/d222bf6a398826be05a8677ef9bd41603f21bfd7))
* retry file operations on Windows lock errors and unpoison the state write queue ([b14925d](https://github.com/capawesome-team/electron-live-update/commit/b14925d82681d191ca95f3034bf6fdcb47251e5c))
* verify reused delta files and reject empty integrity headers ([2ea1071](https://github.com/capawesome-team/electron-live-update/commit/2ea1071ae44603b90d286f6165c64091a1fe825e))

## @capawesome/electron-live-update

/**
 * E2E orchestrator: runs the packaged-app kill-during-boot rollback
 * drill first, then the Playwright UI suite (which reuses the
 * packaged binary for the asar smoke test).
 *
 * Prerequisites: `npm run build` and `npm run build --workspace example`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { artifactsDirectory, repositoryRoot } from './helpers.mjs';

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// The electron npm package no longer downloads its binary via an install
// script, so a fresh `npm ci` leaves node_modules/electron/dist missing.
// Fetch it explicitly before the drill copies the distribution.
const electronPackageDirectory = join(
  repositoryRoot,
  'node_modules',
  'electron',
);
if (!existsSync(join(electronPackageDirectory, 'dist'))) {
  run(process.execPath, [join(electronPackageDirectory, 'install.js')]);
}

run(process.execPath, [join(repositoryRoot, 'e2e', 'drill.mjs')]);

const binaryPath = (
  await readFile(join(artifactsDirectory, 'binary-path.txt'), 'utf8')
).trim();
run(
  'npx',
  [
    'playwright',
    'test',
    '--config',
    join(repositoryRoot, 'e2e', 'playwright.config.ts'),
  ],
  {
    E2E_PACKAGED_BINARY: binaryPath,
  },
);

console.log('[e2e] All end-to-end tests passed.');

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// Locate the repository root by walking up from the working directory.
// (Not import.meta based, so this module also loads under the
// Playwright transpiler.)
function findRepositoryRoot() {
  let directory = process.cwd();
  for (;;) {
    const packageJsonPath = join(directory, 'package.json');
    if (existsSync(packageJsonPath)) {
      try {
        if (
          JSON.parse(readFileSync(packageJsonPath, 'utf8')).name ===
          '@capawesome/electron-live-update'
        ) {
          return directory;
        }
      } catch {
        // Keep walking up.
      }
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error('Could not locate the repository root.');
    }
    directory = parent;
  }
}

export const repositoryRoot = findRepositoryRoot();
export const exampleDirectory = join(repositoryRoot, 'example');
export const artifactsDirectory = join(repositoryRoot, 'e2e', '.artifacts');

export async function createUserDataDirectory() {
  return mkdtemp(join(tmpdir(), 'live-update-e2e-'));
}

/**
 * Start the mock Capawesome Cloud server as a child process and wait
 * until it is listening.
 */
export async function startMockServer(port, latest) {
  const child = spawn(
    process.execPath,
    [join(exampleDirectory, 'scripts', 'mock-server.mjs')],
    {
      env: {
        ...process.env,
        LATEST: latest ?? '',
        MOCK_SERVER_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  );
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Mock server did not start.')),
      10000,
    );
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('listening')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on('exit', code =>
      reject(new Error(`Mock server exited with code ${code}.`)),
    );
  });
  return {
    origin: `http://localhost:${port}`,
    serverDomain: `localhost:${port}`,
    setLatest: async latestBundleId => {
      const response = await fetch(`http://localhost:${port}/__control`, {
        body: JSON.stringify({ latest: latestBundleId }),
        method: 'POST',
      });
      if (!response.ok) {
        throw new Error('Failed to switch the mock server bundle.');
      }
    },
    stop: () => {
      child.kill('SIGKILL');
    },
  };
}

export async function readState(userDataDirectory) {
  try {
    return JSON.parse(
      await readFile(
        join(userDataDirectory, 'capawesome-live-update', 'state.json'),
        'utf8',
      ),
    );
  } catch {
    return null;
  }
}

/**
 * Poll the engine state file until the condition holds.
 */
export async function waitForState(
  userDataDirectory,
  description,
  condition,
  timeoutMs = 60000,
) {
  const start = Date.now();
  for (;;) {
    const state = await readState(userDataDirectory);
    if (state && condition(state)) {
      return state;
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for state: ${description}\nLast state: ${JSON.stringify(state, null, 2)}`,
      );
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

export async function getExamplePublicKey() {
  return readFile(join(exampleDirectory, 'dist', 'keys', 'public.pem'), 'utf8');
}

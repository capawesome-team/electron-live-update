import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- plain ESM helper module
import {
  createUserDataDirectory,
  exampleDirectory,
  getExamplePublicKey,
  startMockServer,
} from './helpers.mjs';

interface MockServer {
  serverDomain: string;
  setLatest(latest: string | null): Promise<void>;
  stop(): void;
}

let mockServer: MockServer;
let portCounter = 4400;

async function launchExample(
  options: {
    latest?: string | null;
    servingMode?: 'serve' | 'simple';
    userDataDirectory?: string;
  } = {},
): Promise<{
  app: ElectronApplication;
  page: Page;
  userDataDirectory: string;
}> {
  const userDataDirectory =
    options.userDataDirectory ?? (await createUserDataDirectory());
  const app = await electron.launch({
    args: [exampleDirectory as string],
    env: {
      ...(process.env as Record<string, string>),
      EXAMPLE_PUBLIC_KEY: (await getExamplePublicKey()) as string,
      EXAMPLE_READY_TIMEOUT: '10000',
      EXAMPLE_SERVER_DOMAIN: mockServer.serverDomain,
      EXAMPLE_SERVING_MODE: options.servingMode ?? 'serve',
      EXAMPLE_USER_DATA: userDataDirectory,
    },
  });
  const page = await app.firstWindow();
  return { app, page, userDataDirectory };
}

test.beforeEach(async () => {
  portCounter += 1;
  mockServer = (await startMockServer(
    portCounter,
    null,
  )) as unknown as MockServer;
});

test.afterEach(() => {
  mockServer.stop();
});

test('boots the built-in bundle and signals readiness', async () => {
  const { app, page } = await launchExample();
  await expect(page.getByTestId('marker')).toHaveText('built-in');
  await expect(page.getByTestId('current-bundle')).toHaveText('default');
  await expect(page.getByTestId('ready-state')).toContainText(
    'rollback: false',
  );
  await app.close();
});

test('syncs, reloads into the new bundle and keeps localStorage (stable origin)', async () => {
  await mockServer.setLatest('2.0.0');
  const { app, page } = await launchExample();
  await expect(page.getByTestId('storage-counter')).toHaveText('1');
  await page.getByTestId('sync').click();
  await expect(page.getByTestId('next-bundle')).toHaveText('2.0.0');
  await page.getByTestId('reload').click();
  await expect(page.getByTestId('marker')).toHaveText('2.0.0');
  await expect(page.getByTestId('current-bundle')).toHaveText('2.0.0');
  // localStorage survived the bundle switch because the origin is stable.
  await expect(page.getByTestId('storage-counter')).toHaveText('2');
  await expect(page.getByTestId('ready-state')).toContainText(
    'rollback: false',
  );
  await app.close();
});

test('rejects a tampered bundle (signature verification)', async () => {
  await mockServer.setLatest('2.0.0-evil');
  const { app, page } = await launchExample();
  await page.getByTestId('sync').click();
  await expect(page.getByTestId('error')).toHaveText(
    'Signature verification failed.',
  );
  await expect(page.getByTestId('next-bundle')).toHaveText('default');
  await app.close();
});

test('syncs a manifest (delta) bundle over the built-in bundle', async () => {
  await mockServer.setLatest('4.0.0-manifest');
  const { app, page } = await launchExample();
  await page.getByTestId('sync').click();
  await expect(page.getByTestId('next-bundle')).toHaveText('4.0.0-manifest');
  await page.getByTestId('reload').click();
  await expect(page.getByTestId('current-bundle')).toHaveText('4.0.0-manifest');
  await expect(page.getByTestId('marker')).toHaveText('2.0.0');
  await expect(page.getByTestId('ready-state')).toContainText(
    'rollback: false',
  );
  await app.close();
});

test('simple mode: syncs and reloads via getCurrentBundlePath()', async () => {
  await mockServer.setLatest('2.0.0');
  const { app, page } = await launchExample({ servingMode: 'simple' });
  await expect(page.getByTestId('marker')).toHaveText('built-in');
  await page.getByTestId('sync').click();
  await expect(page.getByTestId('next-bundle')).toHaveText('2.0.0');
  await page.getByTestId('reload').click();
  await expect(page.getByTestId('marker')).toHaveText('2.0.0');
  await app.close();
});

test('the packaged app boots the built-in bundle from the asar archive', async () => {
  test.skip(!process.env.E2E_PACKAGED_BINARY, 'packaged binary not built');
  const userDataDirectory = await createUserDataDirectory();
  const app = await electron.launch({
    executablePath: process.env.E2E_PACKAGED_BINARY as string,
    args: [],
    env: {
      ...(process.env as Record<string, string>),
      EXAMPLE_SERVER_DOMAIN: mockServer.serverDomain,
      EXAMPLE_USER_DATA: userDataDirectory,
    },
  });
  const page = await app.firstWindow();
  await expect(page.getByTestId('marker')).toHaveText('built-in');
  await expect(page.getByTestId('ready-state')).toContainText(
    'rollback: false',
  );
  await app.close();
});

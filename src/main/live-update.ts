import {
  app,
  ipcMain,
  net,
  powerMonitor,
  protocol,
  type BrowserWindow,
  type WebContents,
} from 'electron';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  DeleteBundleOptions,
  DownloadBundleOptions,
  DownloadBundleProgressListener,
  FetchChannelsOptions,
  FetchChannelsResult,
  FetchLatestBundleOptions,
  FetchLatestBundleResult,
  GetBlockedBundlesResult,
  GetChannelResult,
  GetCurrentBundleResult,
  GetCustomIdResult,
  GetDeviceIdResult,
  GetDownloadedBundlesResult,
  GetNextBundleResult,
  GetVersionCodeResult,
  GetVersionNameResult,
  IsSyncingResult,
  ListenerHandle,
  NextBundleSetListener,
  ReadyResult,
  ReloadedListener,
  RolledBackListener,
  SetChannelOptions,
  SetCustomIdOptions,
  SetNextBundleOptions,
  SyncOptions,
  SyncResult,
} from '../engine/definitions';
import { LiveUpdateEngine, type LiveUpdateLogger } from '../engine/engine';
import { ErrorCode, LiveUpdateError } from '../engine/errors';
import {
  IPC_METHODS,
  getEventChannel,
  getMethodChannel,
  type IpcEvent,
  type IpcMethod,
  type IpcResult,
} from '../shared/ipc';

import type { LiveUpdate, LiveUpdateConfig, ServeOptions } from './definitions';
import { resolveServedFile } from './serving';

const DEFAULT_SCHEME = 'capawesome-live-update';
const SERVE_HOST = 'bundle';
const AUTO_UPDATE_MIN_INTERVAL = 15 * 60 * 1000;
const ELECTRON_PLATFORM = '2';
const ELECTRON_RUNTIME = 'electron';

const defaultLogger: LiveUpdateLogger = {
  debug: message => console.debug(`[LiveUpdate] ${message}`),
  error: message => console.error(`[LiveUpdate] ${message}`),
  info: message => console.info(`[LiveUpdate] ${message}`),
  warn: message => console.warn(`[LiveUpdate] ${message}`),
};

let ipcRegistered = false;

class LiveUpdateImpl implements LiveUpdate {
  private readonly attachedWindows = new Set<BrowserWindow>();
  private readonly defaultBundlePath: string | undefined;
  private readonly emitter = new EventEmitter();
  private readonly engine: LiveUpdateEngine;
  private readonly initialization: Promise<void>;
  private lastAutoUpdateCheck = 0;
  private readonly logger: LiveUpdateLogger;
  private scheme: string | null = null;

  constructor(config: LiveUpdateConfig) {
    this.defaultBundlePath = config.defaultBundlePath;
    this.logger = config.logger ?? defaultLogger;
    this.engine = new LiveUpdateEngine({
      appId: config.appId,
      autoBlockRolledBackBundles: config.autoBlockRolledBackBundles,
      autoDeleteBundles: config.autoDeleteBundles,
      dataDirectory:
        config.dataDirectory ??
        join(app.getPath('userData'), 'capawesome-live-update'),
      defaultBundlePath: config.defaultBundlePath,
      defaultChannel: config.defaultChannel,
      httpTimeout: config.httpTimeout,
      logger: this.logger,
      osVersion: process.getSystemVersion(),
      platform: ELECTRON_PLATFORM,
      publicKey: config.publicKey,
      readyTimeout: config.readyTimeout,
      runtime: ELECTRON_RUNTIME,
      sdkVersion: __SDK_VERSION__,
      serverDomain: config.serverDomain,
      versionCode: config.versionCode ?? app.getVersion(),
      versionName: config.versionName ?? app.getVersion(),
    });
    this.engine.on('downloadBundleProgress', event =>
      this.emitEvent('downloadBundleProgress', event),
    );
    this.engine.on('nextBundleSet', event =>
      this.emitEvent('nextBundleSet', event),
    );
    this.engine.on('rolledBack', event => {
      this.logger.warn(
        `Rolled back from bundle '${event.previousBundleId}' to ${
          event.currentBundleId === null
            ? 'the default bundle'
            : `bundle '${event.currentBundleId}'`
        }.`,
      );
      this.emitEvent('rolledBack', event);
      void this.reloadAttachedWindows().catch(error =>
        this.logger.error(
          `Failed to reload after rollback: ${this.describeError(error)}`,
        ),
      );
    });
    this.registerIpcHandlers();
    this.initialization = this.engine.initialize().then(result => {
      if (result.rollback) {
        this.logger.warn(
          'The previous boot did not complete. The app was rolled back.',
        );
      }
    });
    if ((config.autoUpdateStrategy ?? 'none') === 'background') {
      this.setUpBackgroundAutoUpdate();
    }
  }

  public serve(options?: ServeOptions): void {
    if (this.scheme !== null) {
      throw new LiveUpdateError(
        ErrorCode.Unknown,
        'serve() has already been called.',
      );
    }
    if (!this.defaultBundlePath) {
      throw new LiveUpdateError(
        ErrorCode.Unknown,
        'serve() requires the defaultBundlePath option so that the default bundle can be served.',
      );
    }
    if (app.isReady()) {
      throw new LiveUpdateError(
        ErrorCode.Unknown,
        'serve() must be called before the app is ready, because privileged schemes can only be registered before that point.',
      );
    }
    const scheme = options?.scheme ?? DEFAULT_SCHEME;
    this.scheme = scheme;
    protocol.registerSchemesAsPrivileged([
      {
        scheme,
        privileges: {
          codeCache: true,
          secure: true,
          standard: true,
          stream: true,
          supportFetchAPI: true,
        },
      },
    ]);
    void app.whenReady().then(() => {
      protocol.handle(scheme, request => this.handleServeRequest(request));
    });
  }

  public getServeUrl(): string {
    if (this.scheme === null) {
      throw new LiveUpdateError(
        ErrorCode.Unknown,
        'getServeUrl() is only available after serve() has been called.',
      );
    }
    return `${this.scheme}://${SERVE_HOST}/`;
  }

  public attach(window: BrowserWindow): void {
    this.attachedWindows.add(window);
    window.on('closed', () => {
      this.attachedWindows.delete(window);
    });
  }

  public async getCurrentBundlePath(): Promise<string | null> {
    await this.initialization;
    return this.engine.getCurrentBundlePath() ?? this.defaultBundlePath ?? null;
  }

  public async reload(): Promise<void> {
    await this.initialization;
    await this.engine.applyNextBundle();
    await this.reloadAttachedWindows();
    this.emitEvent('reloaded', undefined);
  }

  public async ready(): Promise<ReadyResult> {
    await this.initialization;
    return this.engine.ready();
  }

  public async sync(options?: SyncOptions): Promise<SyncResult> {
    await this.initialization;
    return this.engine.sync(options);
  }

  public async fetchChannels(
    options?: FetchChannelsOptions,
  ): Promise<FetchChannelsResult> {
    await this.initialization;
    return this.engine.fetchChannels(options);
  }

  public async fetchLatestBundle(
    options?: FetchLatestBundleOptions,
  ): Promise<FetchLatestBundleResult> {
    await this.initialization;
    return this.engine.fetchLatestBundle(options);
  }

  public async downloadBundle(options: DownloadBundleOptions): Promise<void> {
    await this.initialization;
    return this.engine.downloadBundle(options);
  }

  public async deleteBundle(options: DeleteBundleOptions): Promise<void> {
    await this.initialization;
    return this.engine.deleteBundle(options);
  }

  public async setNextBundle(options: SetNextBundleOptions): Promise<void> {
    await this.initialization;
    return this.engine.setNextBundle(options);
  }

  public async reset(): Promise<void> {
    await this.initialization;
    return this.engine.reset();
  }

  public async getCurrentBundle(): Promise<GetCurrentBundleResult> {
    await this.initialization;
    return this.engine.getCurrentBundle();
  }

  public async getNextBundle(): Promise<GetNextBundleResult> {
    await this.initialization;
    return this.engine.getNextBundle();
  }

  public async getDownloadedBundles(): Promise<GetDownloadedBundlesResult> {
    await this.initialization;
    return this.engine.getDownloadedBundles();
  }

  public async getBlockedBundles(): Promise<GetBlockedBundlesResult> {
    await this.initialization;
    return this.engine.getBlockedBundles();
  }

  public async clearBlockedBundles(): Promise<void> {
    await this.initialization;
    return this.engine.clearBlockedBundles();
  }

  public async getChannel(): Promise<GetChannelResult> {
    await this.initialization;
    return this.engine.getChannel();
  }

  public async setChannel(options: SetChannelOptions): Promise<void> {
    await this.initialization;
    return this.engine.setChannel(options);
  }

  public async getCustomId(): Promise<GetCustomIdResult> {
    await this.initialization;
    return this.engine.getCustomId();
  }

  public async setCustomId(options: SetCustomIdOptions): Promise<void> {
    await this.initialization;
    return this.engine.setCustomId(options);
  }

  public async getDeviceId(): Promise<GetDeviceIdResult> {
    await this.initialization;
    return this.engine.getDeviceId();
  }

  public async getVersionCode(): Promise<GetVersionCodeResult> {
    await this.initialization;
    return this.engine.getVersionCode();
  }

  public async getVersionName(): Promise<GetVersionNameResult> {
    await this.initialization;
    return this.engine.getVersionName();
  }

  public async isSyncing(): Promise<IsSyncingResult> {
    await this.initialization;
    return this.engine.isSyncing();
  }

  public addListener(
    eventName: 'downloadBundleProgress',
    listener: DownloadBundleProgressListener,
  ): ListenerHandle;
  public addListener(
    eventName: 'nextBundleSet',
    listener: NextBundleSetListener,
  ): ListenerHandle;
  public addListener(
    eventName: 'reloaded',
    listener: ReloadedListener,
  ): ListenerHandle;
  public addListener(
    eventName: 'rolledBack',
    listener: RolledBackListener,
  ): ListenerHandle;
  public addListener(
    eventName: IpcEvent,
    listener: (...args: never[]) => void,
  ): ListenerHandle {
    const wrapped = (event: unknown): void => {
      (listener as (event: unknown) => void)(event);
    };
    this.emitter.on(eventName, wrapped);
    return {
      remove: () => {
        this.emitter.off(eventName, wrapped);
      },
    };
  }

  public removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  private emitEvent(eventName: IpcEvent, payload: unknown): void {
    this.emitter.emit(eventName, payload);
    for (const window of this.attachedWindows) {
      if (!window.isDestroyed()) {
        window.webContents.send(getEventChannel(eventName), payload);
      }
    }
  }

  private async handleServeRequest(request: Request): Promise<Response> {
    await this.initialization;
    const rootDirectory =
      this.engine.getCurrentBundlePath() ?? this.defaultBundlePath;
    if (!rootDirectory) {
      return new Response('Not found', { status: 404 });
    }
    const pathname = new URL(request.url).pathname;
    const filePath = await resolveServedFile(rootDirectory, pathname);
    if (!filePath) {
      return new Response('Not found', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  }

  private async reloadAttachedWindows(): Promise<void> {
    for (const window of this.attachedWindows) {
      if (window.isDestroyed()) {
        continue;
      }
      if (this.scheme !== null) {
        await window.webContents.loadURL(this.getServeUrl());
      } else {
        const bundlePath = await this.getCurrentBundlePath();
        if (!bundlePath) {
          throw new LiveUpdateError(
            ErrorCode.Unknown,
            'Cannot reload: no bundle is active and no defaultBundlePath is configured.',
          );
        }
        await window.webContents.loadFile(join(bundlePath, 'index.html'));
      }
    }
  }

  private setUpBackgroundAutoUpdate(): void {
    const check = (): void => {
      const now = Date.now();
      if (now - this.lastAutoUpdateCheck < AUTO_UPDATE_MIN_INTERVAL) {
        return;
      }
      this.lastAutoUpdateCheck = now;
      void this.sync()
        .then(result => {
          if (result.nextBundleId !== null) {
            this.logger.info(
              `Bundle '${result.nextBundleId}' will be applied on the next app restart or reload().`,
            );
          }
        })
        .catch(error => {
          this.logger.warn(
            `Background sync failed: ${this.describeError(error)}`,
          );
        });
    };
    void app.whenReady().then(() => {
      check();
      app.on('browser-window-focus', check);
      powerMonitor.on('resume', check);
    });
  }

  private registerIpcHandlers(): void {
    if (ipcRegistered) {
      throw new LiveUpdateError(
        ErrorCode.Unknown,
        'createLiveUpdate() may only be called once per process: the IPC channels are already registered.',
      );
    }
    ipcRegistered = true;
    for (const method of IPC_METHODS) {
      ipcMain.handle(
        getMethodChannel(method),
        async (event, options: unknown): Promise<IpcResult> => {
          this.assertTrustedSender(event.sender);
          try {
            return {
              ok: true,
              value: await this.invokeMethod(method, options),
            };
          } catch (error) {
            return {
              error: {
                code:
                  error instanceof LiveUpdateError
                    ? error.code
                    : ErrorCode.Unknown,
                message:
                  error instanceof Error
                    ? error.message
                    : 'An unknown error has occurred.',
              },
              ok: false,
            };
          }
        },
      );
    }
  }

  private assertTrustedSender(sender: WebContents): void {
    for (const window of this.attachedWindows) {
      if (!window.isDestroyed() && window.webContents.id === sender.id) {
        return;
      }
    }
    throw new LiveUpdateError(
      ErrorCode.Unknown,
      'Live update IPC calls are only allowed from attached windows. Call attach(window) in the main process.',
    );
  }

  private invokeMethod(method: IpcMethod, options: unknown): Promise<unknown> {
    switch (method) {
      case 'clearBlockedBundles':
        return this.clearBlockedBundles();
      case 'deleteBundle':
        return this.deleteBundle(options as DeleteBundleOptions);
      case 'downloadBundle':
        return this.downloadBundle(options as DownloadBundleOptions);
      case 'fetchChannels':
        return this.fetchChannels(options as FetchChannelsOptions | undefined);
      case 'fetchLatestBundle':
        return this.fetchLatestBundle(
          options as FetchLatestBundleOptions | undefined,
        );
      case 'getBlockedBundles':
        return this.getBlockedBundles();
      case 'getChannel':
        return this.getChannel();
      case 'getCurrentBundle':
        return this.getCurrentBundle();
      case 'getCustomId':
        return this.getCustomId();
      case 'getDeviceId':
        return this.getDeviceId();
      case 'getDownloadedBundles':
        return this.getDownloadedBundles();
      case 'getNextBundle':
        return this.getNextBundle();
      case 'getVersionCode':
        return this.getVersionCode();
      case 'getVersionName':
        return this.getVersionName();
      case 'isSyncing':
        return this.isSyncing();
      case 'ready':
        return this.ready();
      case 'reload':
        return this.reload();
      case 'reset':
        return this.reset();
      case 'setChannel':
        return this.setChannel(options as SetChannelOptions);
      case 'setCustomId':
        return this.setCustomId(options as SetCustomIdOptions);
      case 'setNextBundle':
        return this.setNextBundle(options as SetNextBundleOptions);
      case 'sync':
        return this.sync(options as SyncOptions | undefined);
    }
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Create the live update SDK for the main process.
 *
 * Call this once, early in your main process (before `app.whenReady()`
 * when using `serve()`).
 *
 * @since 0.1.0
 */
export function createLiveUpdate(config: LiveUpdateConfig = {}): LiveUpdate {
  return new LiveUpdateImpl(config);
}

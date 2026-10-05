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
  LiveUpdateApi,
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
import { ErrorCode, LiveUpdateError } from '../engine/errors';
import {
  IPC_GLOBAL_KEY,
  type IpcEvent,
  type IpcMethod,
  type LiveUpdateBridge,
} from '../shared/ipc';

export * from '../engine/definitions';
export { ErrorCode, LiveUpdateError } from '../engine/errors';

function getBridge(): LiveUpdateBridge {
  const bridge = (globalThis as Record<string, unknown>)[IPC_GLOBAL_KEY] as
    LiveUpdateBridge | undefined;
  if (!bridge) {
    throw new LiveUpdateError(
      ErrorCode.Unknown,
      'The live update bridge is not available. Call exposeLiveUpdateApi() from "@capawesome/electron-live-update/preload" in your preload script and attach(window) in the main process.',
    );
  }
  return bridge;
}

async function invoke<T>(method: IpcMethod, options?: unknown): Promise<T> {
  const result = await getBridge().invoke(method, options);
  if (!result.ok) {
    const code = Object.values(ErrorCode).includes(
      result.error.code as ErrorCode,
    )
      ? (result.error.code as ErrorCode)
      : ErrorCode.Unknown;
    throw new LiveUpdateError(code, result.error.message);
  }
  return result.value as T;
}

class LiveUpdateClient implements LiveUpdateApi {
  private readonly subscriptions = new Set<() => void>();

  public clearBlockedBundles(): Promise<void> {
    return invoke('clearBlockedBundles');
  }

  public deleteBundle(options: DeleteBundleOptions): Promise<void> {
    return invoke('deleteBundle', options);
  }

  public downloadBundle(options: DownloadBundleOptions): Promise<void> {
    return invoke('downloadBundle', options);
  }

  public fetchChannels(
    options?: FetchChannelsOptions,
  ): Promise<FetchChannelsResult> {
    return invoke('fetchChannels', options);
  }

  public fetchLatestBundle(
    options?: FetchLatestBundleOptions,
  ): Promise<FetchLatestBundleResult> {
    return invoke('fetchLatestBundle', options);
  }

  public getBlockedBundles(): Promise<GetBlockedBundlesResult> {
    return invoke('getBlockedBundles');
  }

  public getChannel(): Promise<GetChannelResult> {
    return invoke('getChannel');
  }

  public getCurrentBundle(): Promise<GetCurrentBundleResult> {
    return invoke('getCurrentBundle');
  }

  public getCustomId(): Promise<GetCustomIdResult> {
    return invoke('getCustomId');
  }

  public getDeviceId(): Promise<GetDeviceIdResult> {
    return invoke('getDeviceId');
  }

  public getDownloadedBundles(): Promise<GetDownloadedBundlesResult> {
    return invoke('getDownloadedBundles');
  }

  public getNextBundle(): Promise<GetNextBundleResult> {
    return invoke('getNextBundle');
  }

  public getVersionCode(): Promise<GetVersionCodeResult> {
    return invoke('getVersionCode');
  }

  public getVersionName(): Promise<GetVersionNameResult> {
    return invoke('getVersionName');
  }

  public isSyncing(): Promise<IsSyncingResult> {
    return invoke('isSyncing');
  }

  public ready(): Promise<ReadyResult> {
    return invoke('ready');
  }

  public reload(): Promise<void> {
    return invoke('reload');
  }

  public reset(): Promise<void> {
    return invoke('reset');
  }

  public setChannel(options: SetChannelOptions): Promise<void> {
    return invoke('setChannel', options);
  }

  public setCustomId(options: SetCustomIdOptions): Promise<void> {
    return invoke('setCustomId', options);
  }

  public setNextBundle(options: SetNextBundleOptions): Promise<void> {
    return invoke('setNextBundle', options);
  }

  public sync(options?: SyncOptions): Promise<SyncResult> {
    return invoke('sync', options);
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
    const unsubscribe = getBridge().addEventListener(eventName, payload => {
      (listener as (payload: unknown) => void)(payload);
    });
    const remove = (): void => {
      unsubscribe();
      this.subscriptions.delete(remove);
    };
    this.subscriptions.add(remove);
    return { remove };
  }

  public removeAllListeners(): void {
    for (const remove of [...this.subscriptions]) {
      remove();
    }
  }
}

/**
 * The typed live update client for the renderer.
 *
 * Requires `exposeLiveUpdateApi()` in the preload script and
 * `attach(window)` in the main process.
 *
 * @since 0.1.0
 */
export const LiveUpdate: LiveUpdateApi = new LiveUpdateClient();

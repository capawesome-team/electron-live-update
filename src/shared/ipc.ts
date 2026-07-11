/**
 * IPC contract shared between the main process SDK, the preload
 * script and the renderer client.
 */

export const IPC_GLOBAL_KEY = 'CapawesomeLiveUpdate';

const IPC_NAMESPACE = 'capawesome-live-update';

/**
 * The methods that are exposed to the renderer. Anything not on this
 * list is not reachable via IPC.
 */
export const IPC_METHODS = [
  'clearBlockedBundles',
  'deleteBundle',
  'downloadBundle',
  'fetchLatestBundle',
  'getBlockedBundles',
  'getChannel',
  'getCurrentBundle',
  'getCustomId',
  'getDeviceId',
  'getDownloadedBundles',
  'getNextBundle',
  'getVersionCode',
  'getVersionName',
  'isSyncing',
  'ready',
  'reload',
  'reset',
  'setChannel',
  'setCustomId',
  'setNextBundle',
  'sync',
] as const;

export type IpcMethod = (typeof IPC_METHODS)[number];

/**
 * The events that are forwarded to attached renderers.
 */
export const IPC_EVENTS = [
  'downloadBundleProgress',
  'nextBundleSet',
  'reloaded',
] as const;

export type IpcEvent = (typeof IPC_EVENTS)[number];

export function getMethodChannel(method: IpcMethod): string {
  return `${IPC_NAMESPACE}:method:${method}`;
}

export function getEventChannel(event: IpcEvent): string {
  return `${IPC_NAMESPACE}:event:${event}`;
}

/**
 * Result envelope for IPC method calls. Errors are transported as
 * data so that the `LiveUpdateError` code survives the IPC boundary.
 */
export type IpcResult =
  | { ok: true; value: unknown }
  | { error: { code: string; message: string }; ok: false };

/**
 * The shape of the bridge object that the preload script exposes on
 * `window` for the renderer client.
 */
export interface LiveUpdateBridge {
  addEventListener(
    event: IpcEvent,
    listener: (payload: unknown) => void,
  ): () => void;
  invoke(method: IpcMethod, options?: unknown): Promise<IpcResult>;
}

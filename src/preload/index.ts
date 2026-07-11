import { contextBridge, ipcRenderer } from 'electron';

import {
  IPC_EVENTS,
  IPC_GLOBAL_KEY,
  IPC_METHODS,
  getEventChannel,
  getMethodChannel,
  type LiveUpdateBridge,
} from '../shared/ipc';

/**
 * Expose the live update bridge to the renderer.
 *
 * Call this from your preload script. The bridge is namespaced,
 * limited to the live update method set, and safe to expose with
 * context isolation enabled. Use the `@capawesome/electron-live-update/renderer`
 * client to consume it with a typed API.
 *
 * @since 0.1.0
 */
export function exposeLiveUpdateApi(): void {
  const methods = new Set<string>(IPC_METHODS);
  const events = new Set<string>(IPC_EVENTS);
  const bridge: LiveUpdateBridge = {
    addEventListener: (event, listener) => {
      if (!events.has(event)) {
        throw new Error(`Unknown live update event: ${String(event)}`);
      }
      const channel = getEventChannel(event);
      const wrapped = (_event: unknown, payload: unknown): void => {
        listener(payload);
      };
      ipcRenderer.on(channel, wrapped);
      return () => {
        ipcRenderer.off(channel, wrapped);
      };
    },
    invoke: (method, options) => {
      if (!methods.has(method)) {
        return Promise.reject(
          new Error(`Unknown live update method: ${String(method)}`),
        );
      }
      return ipcRenderer.invoke(getMethodChannel(method), options);
    },
  };
  contextBridge.exposeInMainWorld(IPC_GLOBAL_KEY, bridge);
}

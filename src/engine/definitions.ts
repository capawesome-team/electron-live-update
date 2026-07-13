/**
 * The artifact type of a bundle.
 *
 * @since 0.1.0
 */
export type ArtifactType = 'manifest' | 'zip';

/**
 * A channel that bundles can be delivered on.
 *
 * @since 0.1.0
 */
export interface Channel {
  /**
   * The unique identifier of the channel.
   *
   * @since 0.1.0
   */
  id: string;
  /**
   * The name of the channel.
   *
   * @since 0.1.0
   */
  name: string;
}

/**
 * @since 0.1.0
 */
export interface DeleteBundleOptions {
  /**
   * The unique identifier of the bundle to delete.
   *
   * @since 0.1.0
   * @example '1.0.0'
   */
  bundleId: string;
}

/**
 * @since 0.1.0
 */
export interface DownloadBundleOptions {
  /**
   * The artifact type of the bundle.
   *
   * Use `manifest` for delta updates: only files that changed compared
   * to the current bundle are downloaded, the rest are copied locally.
   *
   * @since 0.1.0
   * @default 'zip'
   * @example 'zip'
   */
  artifactType?: ArtifactType;
  /**
   * The unique identifier of the bundle.
   *
   * **Attention**: The value `public` is reserved and cannot be used as a bundle identifier.
   *
   * @since 0.1.0
   * @example '1.0.0'
   */
  bundleId: string;
  /**
   * The checksum of the self-hosted bundle as a SHA-256 hash
   * in hex format to verify the integrity of the bundle.
   *
   * @since 0.1.0
   */
  checksum?: string;
  /**
   * The signature of the self-hosted bundle as a signed SHA-256 hash
   * in base64 format to verify the integrity of the bundle.
   *
   * @since 0.1.0
   */
  signature?: string;
  /**
   * The URL of the bundle to download.
   *
   * The URL must point to a ZIP file containing at least an `index.html` file.
   *
   * To **verify the integrity** of the file, the server should return
   * a `X-Checksum` header with the SHA-256 hash in hex format.
   *
   * To **verify the signature** of the file, the server should return
   * a `X-Signature` header with the signed SHA-256 hash in base64 format.
   *
   * Bundles must be downloaded via HTTPS. Plain HTTP is only allowed
   * for localhost during development.
   *
   * @since 0.1.0
   * @example 'https://example.com/bundle.zip'
   */
  url: string;
}

/**
 * @since 0.1.0
 */
export interface FetchChannelsOptions {
  /**
   * The maximum number of channels to return.
   *
   * @since 0.1.0
   * @default 50
   */
  limit?: number;
  /**
   * The number of channels to skip.
   *
   * @since 0.1.0
   * @default 0
   */
  offset?: number;
  /**
   * The query to filter channels by name.
   *
   * @since 0.1.0
   */
  query?: string;
}

/**
 * @since 0.1.0
 */
export interface FetchChannelsResult {
  /**
   * The list of channels.
   *
   * @since 0.1.0
   */
  channels: Channel[];
}

/**
 * @since 0.1.0
 */
export interface FetchLatestBundleOptions {
  /**
   * The preferred channel name from which the latest bundle should be fetched.
   *
   * This is the SDK preference and may be overridden by a forced channel assignment
   * configured in the Capawesome Cloud Console.
   *
   * @since 0.1.0
   */
  channel?: string;
}

/**
 * @since 0.1.0
 */
export interface FetchLatestBundleResult {
  /**
   * The artifact type of the bundle.
   *
   * @since 0.1.0
   */
  artifactType?: ArtifactType;
  /**
   * The unique identifier of the latest bundle.
   *
   * On Capawesome Cloud, this is the ID of the app build artifact.
   *
   * If `null`, no bundle is available.
   *
   * @since 0.1.0
   */
  bundleId: string | null;
  /**
   * The name of the channel that the bundle is actually from.
   *
   * This is the resolved channel after applying any forced channel assignment
   * and may differ from the channel set by the Live Update SDK.
   *
   * @since 0.1.0
   */
  channel?: string;
  /**
   * The checksum of the latest bundle if the bundle is self-hosted.
   *
   * If the bundle is hosted on Capawesome Cloud, the checksum will be
   * returned as response header when downloading the bundle.
   *
   * @since 0.1.0
   */
  checksum?: string;
  /**
   * Custom properties that are associated with the latest bundle.
   *
   * @since 0.1.0
   * @example { "key": "value" }
   */
  customProperties?: { [key: string]: string };
  /**
   * The URL of the latest bundle to download.
   * Pass this URL to the `downloadBundle(...)` method to download the bundle.
   *
   * @since 0.1.0
   */
  downloadUrl?: string;
  /**
   * The signature of the latest bundle if the bundle is self-hosted.
   *
   * If the bundle is hosted on Capawesome Cloud, the signature will be
   * returned as response header when downloading the bundle.
   *
   * @since 0.1.0
   */
  signature?: string;
}

/**
 * @since 0.1.0
 */
export interface GetBlockedBundlesResult {
  /**
   * An array of unique identifiers of all blocked bundles.
   *
   * @since 0.1.0
   */
  bundleIds: string[];
}

/**
 * @since 0.1.0
 */
export interface GetChannelResult {
  /**
   * The channel name.
   *
   * If `null`, the app is using the default channel.
   *
   * @since 0.1.0
   * @example 'production'
   */
  channel: string | null;
}

/**
 * @since 0.1.0
 */
export interface GetCurrentBundleResult {
  /**
   * The unique identifier of the current bundle.
   *
   * If `null`, the default bundle is being used.
   *
   * @since 0.1.0
   */
  bundleId: string | null;
}

/**
 * @since 0.1.0
 */
export interface GetCustomIdResult {
  /**
   * The custom identifier of the device.
   *
   * If `null`, no custom identifier is set.
   *
   * @since 0.1.0
   * @example '50d2a548-80b7-4dad-adc7-97c0e79d8a89'
   */
  customId: string | null;
}

/**
 * @since 0.1.0
 */
export interface GetDeviceIdResult {
  /**
   * The unique identifier of the device.
   *
   * The identifier is a random UUID that is generated on first use
   * and persisted on the device.
   *
   * @since 0.1.0
   * @example '50d2a548-80b7-4dad-adc7-97c0e79d8a89'
   */
  deviceId: string;
}

/**
 * @since 0.1.0
 */
export interface GetDownloadedBundlesResult {
  /**
   * An array of unique identifiers of all downloaded bundles.
   *
   * @since 0.1.0
   */
  bundleIds: string[];
}

/**
 * @since 0.1.0
 */
export interface GetNextBundleResult {
  /**
   * The unique identifier of the next bundle.
   *
   * If `null`, the default bundle is being used.
   *
   * @since 0.1.0
   */
  bundleId: string | null;
}

/**
 * @since 0.1.0
 */
export interface GetVersionCodeResult {
  /**
   * The version code of the app.
   *
   * @since 0.1.0
   * @example "1"
   */
  versionCode: string;
}

/**
 * @since 0.1.0
 */
export interface GetVersionNameResult {
  /**
   * The version name of the app.
   *
   * @since 0.1.0
   * @example "1.0.0"
   */
  versionName: string;
}

/**
 * @since 0.1.0
 */
export interface IsSyncingResult {
  /**
   * Whether a sync operation is currently in progress.
   *
   * @since 0.1.0
   */
  syncing: boolean;
}

/**
 * @since 0.1.0
 */
export interface ReadyResult {
  /**
   * The identifier of the current bundle used.
   *
   * If `null`, the default bundle is being used.
   *
   * @since 0.1.0
   */
  currentBundleId: string | null;
  /**
   * The identifier of the previous bundle used.
   *
   * If `null`, the default bundle was used.
   *
   * @since 0.1.0
   */
  previousBundleId: string | null;
  /**
   * Whether or not the app was reset to a previous bundle.
   *
   * @since 0.1.0
   */
  rollback: boolean;
}

/**
 * @since 0.1.0
 */
export interface SetChannelOptions {
  /**
   * The channel name.
   *
   * Set `null` to remove the channel.
   *
   * @since 0.1.0
   */
  channel: string | null;
}

/**
 * @since 0.1.0
 */
export interface SetCustomIdOptions {
  /**
   * The custom identifier of the device.
   *
   * Set `null` to remove the custom identifier.
   *
   * @since 0.1.0
   */
  customId: string | null;
}

/**
 * @since 0.1.0
 */
export interface SetNextBundleOptions {
  /**
   * The unique identifier of the bundle to use.
   *
   * Set `null` to use the default bundle (same as calling `reset()`).
   *
   * @since 0.1.0
   * @example '1.0.0'
   */
  bundleId: string | null;
}

/**
 * @since 0.1.0
 */
export interface SyncOptions {
  /**
   * The preferred channel name from which the latest bundle should be fetched.
   *
   * This is the SDK preference and may be overridden by a forced channel assignment
   * configured in the Capawesome Cloud Console.
   *
   * @since 0.1.0
   */
  channel?: string;
}

/**
 * @since 0.1.0
 */
export interface SyncResult {
  /**
   * The identifier of the next bundle to use.
   *
   * If `null`, the app is up-to-date and no new bundle is available.
   *
   * @since 0.1.0
   */
  nextBundleId: string | null;
}

/**
 * Event that is emitted when the download progress of a bundle changes.
 *
 * @since 0.1.0
 */
export interface DownloadBundleProgressEvent {
  /**
   * The unique identifier of the bundle that is being downloaded.
   *
   * @since 0.1.0
   */
  bundleId: string;
  /**
   * The number of bytes that have been downloaded.
   *
   * @since 0.1.0
   */
  downloadedBytes: number;
  /**
   * The progress of the download in percent as a value between `0` and `1`.
   *
   * @since 0.1.0
   * @example 0.5
   */
  progress: number;
  /**
   * The total number of bytes to download.
   *
   * @since 0.1.0
   */
  totalBytes: number;
}

/**
 * Event that is emitted when a bundle is set as the next bundle.
 *
 * @since 0.1.0
 */
export interface NextBundleSetEvent {
  /**
   * The unique identifier of the bundle that is set as the next bundle.
   *
   * If `null`, the default bundle will be used.
   *
   * @since 0.1.0
   * @example '1.0.0'
   */
  bundleId: string | null;
}

/**
 * Event that is emitted when the engine reverted to a previous bundle
 * because the app did not signal readiness in time.
 *
 * @since 0.1.0
 */
export interface RolledBackEvent {
  /**
   * The unique identifier of the bundle that is used after the rollback.
   *
   * If `null`, the default bundle is being used.
   *
   * @since 0.1.0
   */
  currentBundleId: string | null;
  /**
   * The unique identifier of the bundle that caused the rollback.
   *
   * @since 0.1.0
   */
  previousBundleId: string;
}

/**
 * A handle to a registered event listener.
 *
 * @since 0.1.0
 */
export interface ListenerHandle {
  /**
   * Remove the listener.
   *
   * @since 0.1.0
   */
  remove(): void;
}

/**
 * Listener for the download progress of a bundle.
 *
 * @since 0.1.0
 */
export type DownloadBundleProgressListener = (
  event: DownloadBundleProgressEvent,
) => void;

/**
 * Listener for when a bundle is set as the next bundle.
 *
 * @since 0.1.0
 */
export type NextBundleSetListener = (event: NextBundleSetEvent) => void;

/**
 * Listener for when the app is reloaded.
 *
 * @since 0.1.0
 */
export type ReloadedListener = () => void;

/**
 * Listener for when the engine reverted to a previous bundle.
 *
 * @since 0.1.0
 */
export type RolledBackListener = (event: RolledBackEvent) => void;

/**
 * The shared live update API surface.
 *
 * This is the vocabulary shared by the main process SDK and the
 * renderer client. It mirrors the `@capawesome/capacitor-live-update`
 * plugin API so that one product speaks one vocabulary across
 * iOS, Android and Electron.
 *
 * @since 0.1.0
 */
export interface LiveUpdateApi {
  /**
   * Clear all blocked bundles from the blocked list.
   *
   * This removes all bundle identifiers that were automatically blocked
   * due to rollbacks when `autoBlockRolledBackBundles` is enabled.
   *
   * @since 0.1.0
   */
  clearBlockedBundles(): Promise<void>;
  /**
   * Delete a bundle from the app.
   *
   * @since 0.1.0
   */
  deleteBundle(options: DeleteBundleOptions): Promise<void>;
  /**
   * Download a bundle.
   *
   * @since 0.1.0
   */
  downloadBundle(options: DownloadBundleOptions): Promise<void>;
  /**
   * Fetch the available channels using the [Capawesome Cloud](https://capawesome.io/cloud/).
   *
   * **Attention**: This method only works for apps with public channels
   * enabled (Channel Discovery). Private channels can still be selected
   * with `setChannel(...)`.
   *
   * @since 0.1.0
   */
  fetchChannels(options?: FetchChannelsOptions): Promise<FetchChannelsResult>;
  /**
   * Fetch the latest bundle using the [Capawesome Cloud](https://capawesome.io/cloud/).
   *
   * @since 0.1.0
   */
  fetchLatestBundle(
    options?: FetchLatestBundleOptions,
  ): Promise<FetchLatestBundleResult>;
  /**
   * Get all blocked bundle identifiers.
   *
   * Returns the list of bundle identifiers that were automatically blocked
   * due to rollbacks when `autoBlockRolledBackBundles` is enabled.
   *
   * @since 0.1.0
   */
  getBlockedBundles(): Promise<GetBlockedBundlesResult>;
  /**
   * Get the channel that is used for the update.
   *
   * @since 0.1.0
   */
  getChannel(): Promise<GetChannelResult>;
  /**
   * Get the bundle identifier of the current bundle.
   * The current bundle is the bundle that is currently used by the app.
   *
   * @since 0.1.0
   */
  getCurrentBundle(): Promise<GetCurrentBundleResult>;
  /**
   * Get the custom identifier of the device.
   *
   * @since 0.1.0
   */
  getCustomId(): Promise<GetCustomIdResult>;
  /**
   * Get the unique device identifier.
   *
   * @since 0.1.0
   */
  getDeviceId(): Promise<GetDeviceIdResult>;
  /**
   * Get all identifiers of bundles that have been downloaded.
   *
   * @since 0.1.0
   */
  getDownloadedBundles(): Promise<GetDownloadedBundlesResult>;
  /**
   * Get the bundle identifier of the next bundle.
   * The next bundle is the bundle that will be used after calling `reload()`
   * or restarting the app.
   *
   * @since 0.1.0
   */
  getNextBundle(): Promise<GetNextBundleResult>;
  /**
   * Get the version code of the app.
   *
   * @since 0.1.0
   */
  getVersionCode(): Promise<GetVersionCodeResult>;
  /**
   * Get the version name of the app.
   *
   * @since 0.1.0
   */
  getVersionName(): Promise<GetVersionNameResult>;
  /**
   * Check whether a sync operation is currently in progress.
   *
   * @since 0.1.0
   */
  isSyncing(): Promise<IsSyncingResult>;
  /**
   * Notify the SDK that the app is ready to use and no rollback is needed.
   *
   * **Attention**: This method should be called as soon as the app is ready to use
   * to prevent the app from being reset to a previous bundle.
   *
   * @since 0.1.0
   */
  ready(): Promise<ReadyResult>;
  /**
   * Reload the app to apply the new bundle.
   *
   * @since 0.1.0
   */
  reload(): Promise<void>;
  /**
   * Reset the app to the default bundle.
   *
   * Call `reload()` or restart the app to apply the changes.
   *
   * @since 0.1.0
   */
  reset(): Promise<void>;
  /**
   * Set the channel to use for the update.
   *
   * @since 0.1.0
   */
  setChannel(options: SetChannelOptions): Promise<void>;
  /**
   * Set the custom identifier of the device.
   *
   * @since 0.1.0
   */
  setCustomId(options: SetCustomIdOptions): Promise<void>;
  /**
   * Set the next bundle to use for the app.
   *
   * Call `reload()` or restart the app to apply the changes.
   *
   * @since 0.1.0
   */
  setNextBundle(options: SetNextBundleOptions): Promise<void>;
  /**
   * Automatically download and set the latest bundle for the app using the
   * [Capawesome Cloud](https://capawesome.io/cloud/).
   *
   * Call `reload()` or restart the app to apply the changes.
   *
   * @since 0.1.0
   */
  sync(options?: SyncOptions): Promise<SyncResult>;
  /**
   * Listen for the download progress of a bundle.
   *
   * @since 0.1.0
   */
  addListener(
    eventName: 'downloadBundleProgress',
    listener: DownloadBundleProgressListener,
  ): ListenerHandle;
  /**
   * Listen for when a bundle is set as the next bundle.
   *
   * This event is emitted whenever a bundle is set to be used on the next
   * app restart, either through automatic updates or manual calls to `setNextBundle()`.
   *
   * @since 0.1.0
   */
  addListener(
    eventName: 'nextBundleSet',
    listener: NextBundleSetListener,
  ): ListenerHandle;
  /**
   * Listen for when the app is reloaded.
   *
   * This event is emitted after the `reload()` method is called
   * and the app has been reloaded.
   *
   * @since 0.1.0
   */
  addListener(
    eventName: 'reloaded',
    listener: ReloadedListener,
  ): ListenerHandle;
  /**
   * Listen for when the engine reverted to a previous bundle because the
   * app did not signal readiness in time.
   *
   * @since 0.1.0
   */
  addListener(
    eventName: 'rolledBack',
    listener: RolledBackListener,
  ): ListenerHandle;
  /**
   * Remove all listeners of this instance.
   *
   * @since 0.1.0
   */
  removeAllListeners(): void;
}

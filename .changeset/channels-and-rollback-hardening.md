---
'@capawesome/electron-live-update': minor
---

feat: add `fetchChannels()` (Channel Discovery), the `rolledBack` event, and `setConfig()`, `getConfig()` and `resetConfig()` on the engine; reset to the default bundle and clear the runtime configuration when the app version code changes; apply `httpTimeout` to downloads as an idle timeout; reject `fetchLatestBundle()` and `sync()` on network errors; never roll back a bundle that already signaled readiness

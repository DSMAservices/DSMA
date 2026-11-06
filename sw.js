// Minimal service worker: makes the site installable. It never stores pages or portal data, so signed-in content is always live.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

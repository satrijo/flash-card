/*
 * Service worker Kata — shell app offline.
 * Strategi:
 *   - Precache shell (HTML rute + aset build) via install: cache-first.
 *   - Navigasi: network-first, fallback cache → app tetap buka saat offline.
 *   - Aset statis (_build/assets, icons, font): stale-while-revalidate.
 * Data belajar TIDAK disentuh SW — itu wilayah IndexedDB/Dexie.
 */

const VERSION = "kata-v3";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        cache.addAll([
          "/",
          "/manifest.webmanifest",
          "/seed-deck.json",
          "/icons/icon-192.png",
          "/icons/icon-512.png",
        ]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/_build/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/seed-deck.json" ||
    url.pathname.endsWith(".css") ||
    url.pathname.endsWith(".js") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".json")
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API deck tidak pernah di-cache SW — sync manager yang mengelola data.
  if (url.pathname.startsWith("/api/")) return;

  // Cross-origin (Google Fonts, CDN): cache-first.
  if (url.origin !== self.location.origin) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) return hit;
        try {
          const res = await fetch(request);
          if (res.ok) cache.put(request, res.clone());
          return res;
        } catch {
          return new Response("", { status: 504 });
        }
      }),
    );
    return;
  }

  // Navigasi halaman: network-first dengan fallback cache.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          caches.open(SHELL_CACHE).then((cache) => cache.put("/", res.clone()));
          return res;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL_CACHE);
          return (
            (await cache.match(request)) ??
            (await cache.match("/")) ??
            new Response(
              "<!DOCTYPE html><html><head><meta charset='utf-8'><title>Kata</title></head><body>Offline</body></html>",
              { status: 503, headers: { "Content-Type": "text/html" } },
            )
          );
        }),
    );
    return;
  }

  // Aset statis: cache-first / stale-while-revalidate dengan safe fallback.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(request);
        if (hit) {
          // Revalidate di background jika online
          fetch(request)
            .then((res) => {
              if (res.ok) cache.put(request, res.clone());
            })
            .catch(() => {});
          return hit;
        }
        try {
          const res = await fetch(request);
          if (res.ok) cache.put(request, res.clone());
          return res;
        } catch {
          // Fallback ke shell cache jika ada (misal seed-deck.json)
          const shellCache = await caches.open(SHELL_CACHE);
          const shellHit = await shellCache.match(request);
          if (shellHit) return shellHit;
          return new Response("", { status: 404, statusText: "Offline Asset Not Found" });
        }
      }),
    );
  }
});

// Service worker: permite instalar la app como PWA, abrir sin señal y recibir notificaciones activas.
// Estrategia "red primero" con respaldo en caché para que siempre esté al día.
const CACHE = "chat-video-20261125";

const PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/favicon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
  "./css/style.css",
  "./css/extra.css",
  "./css/fun.css",
  "./css/photo.css",
  "./css/features.css",
  "./css/composer.css",
  "./css/themes.css",
  "./js/app.js",
  "./js/notify.js"
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn("Pre-cacheo inicial parcial (continuará en red)", err);
      });
    })
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith("chat-") && k !== CACHE) {
        await caches.delete(k);
      }
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          const home = await caches.match(new URL("./", self.registration.scope));
          if (home) return home;
        }
        return Response.error();
      })
  );
});

// Recepción de notificaciones push en segundo plano
self.addEventListener("push", (e) => {
  let data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch {
    data = { title: "Nuevo mensaje", body: e.data ? e.data.text() : "Tienes un mensaje nuevo" };
  }
  const title = data.title || "Chat Papá & Hija 💬";
  const options = {
    body: data.body || "Tienes un mensaje nuevo",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    vibrate: [200, 100, 200],
    tag: "chat-message",
    renotify: true,
    data: { url: data.url || "./" },
    actions: [
      { action: "open", title: "Abrir chat" }
    ]
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Click en una notificación: enfocar ventana abierta o abrir chat
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const targetUrl = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope) && "focus" in c) {
        return c.focus();
      }
    }
    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl);
    }
  })());
});

// Soporte para mensajes directos entre cliente y service worker
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

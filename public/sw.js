// Service Worker for Özel Ders Randevu PWA
// Only caches safe static assets - NO API, Supabase, or user data caching

const CACHE_NAME = "odr-static-v3";
const STATIC_ASSETS = [
  "/",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-192-maskable.png",
  "/icon-512-maskable.png",
  "/apple-touch-icon.png",
  "/apple-touch-icon-v2.png",
  "/manifest.json",
];

const CACHE_PATTERNS = [
  /^\/_next\/static\//,
  /^\/_next\/image\//,
  /^\/fonts\//,
  /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff|woff2|css|js)$/,
];

const EXCLUDE_PATTERNS = [
  /^\/api\//,
  /^\/auth\//,
  /^\/panel\//,
  /^\/ogrenci\//,
  /^\/giris/,
  /^\/kayit/,
  /supabase/,
  /\.json$/,
];

function shouldCache(url) {
  const pathname = new URL(url).pathname;

  if (EXCLUDE_PATTERNS.some((pattern) => pattern.test(pathname))) {
    return false;
  }

  if (STATIC_ASSETS.includes(pathname)) {
    return true;
  }

  return CACHE_PATTERNS.some((pattern) => pattern.test(pathname));
}

async function installHandler() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(STATIC_ASSETS);
  return self.skipWaiting();
}

async function activateHandler() {
  const cacheNames = await caches.keys();
  await Promise.all(
    cacheNames
      .filter((name) => name !== CACHE_NAME)
      .map((name) => caches.delete(name))
  );
  return self.clients.claim();
}

async function fetchHandler(event) {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return fetch(request);
  }

  if (!shouldCache(request.url)) {
    return fetch(request);
  }

  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    event.waitUntil(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(request, networkResponse));
          }
        })
        .catch(() => {})
    );
    return cachedResponse;
  }

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    if (cachedResponse) {
      return cachedResponse;
    }
    throw new Error("Network error and no cache");
  }
}

function parsePushData(event) {
  if (!event.data) return null;
  try {
    return event.data.json();
  } catch {
    return { title: "Bildirim", body: event.data.text() };
  }
}

function getNotificationUrl(data) {
  if (!data) return "/";
  
  const type = data.type;
  const appointmentId = data.appointment_id;
  const homeworkId = data.homework_id;
  
  if (type === "booking_created" || type === "booking_confirmed" || 
      type === "booking_rejected" || type === "booking_cancelled_by_teacher" ||
      type === "booking_cancelled_by_student" || type === "booking_completed") {
    if (appointmentId) {
      return `/panel/ogretmen/randevular?appt=${appointmentId}`;
    }
    return "/panel/ogretmen/randevular";
  }
  
  if (type === "homework_assigned" || type === "homework_updated") {
    if (homeworkId) {
      return `/ogrenci/homework?hw=${homeworkId}`;
    }
    return "/ogrenci/homework";
  }
  
  return "/";
}

async function showNotification(event) {
  const data = parsePushData(event);
  if (!data) return;

  const title = data.title || "Özel Ders Randevu";
  const body = data.body || "Yeni bir bildiriminiz var.";
  const icon = "/icon-192.png";
  const badge = "/icon-192.png";
  const tag = data.tag || "odr-notification";
  const renotify = data.renotify || false;
  const requireInteraction = data.requireInteraction || false;
  const notificationUrl = getNotificationUrl(data);

  const options = {
    body,
    icon,
    badge,
    tag,
    renotify,
    requireInteraction,
    data: {
      url: notificationUrl,
      ...data
    },
    actions: [
      { action: "open", title: "Aç" },
      { action: "close", title: "Kapat" }
    ],
    vibrate: [100, 50, 100],
    timestamp: Date.now()
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
}

async function handleNotificationClick(event) {
  event.notification.close();
  
  const notificationData = event.notification.data || {};
  const url = notificationData.url || "/";
  
  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true
      });
      
      // Check if app is already open
      for (const client of allClients) {
        const clientUrl = new URL(client.url);
        if (clientUrl.pathname === new URL(url, self.location.origin).pathname && "focus" in client) {
          return client.focus();
        }
      }
      
      // Open new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })()
  );
}

async function handleNotificationClose(event) {
  // Optional: track notification dismiss
  console.log("[SW] Notification closed:", event.notification.tag);
}

self.addEventListener("install", (event) => {
  event.waitUntil(installHandler());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(activateHandler());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetchHandler(event));
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  showNotification(event);
});

self.addEventListener("notificationclick", (event) => {
  handleNotificationClick(event);
});

self.addEventListener("notificationclose", (event) => {
  handleNotificationClose(event);
});
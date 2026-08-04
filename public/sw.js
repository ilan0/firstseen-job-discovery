/* FirstSeen deliberately caches only public static recovery assets. */
const CACHE_VERSION = "firstseen-static-v1";
const STATIC_ASSETS = ["/icons/icon-192.png", "/icons/icon-512.png"];
const OFFLINE_HTML = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#084b38"><title>Offline · FirstSeen</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f4ee;color:#17231f;font:16px system-ui,sans-serif;padding:24px;box-sizing:border-box}.card{max-width:430px;background:#fff;border:1px solid #d8d8cf;border-radius:28px;padding:32px;text-align:center}.mark{display:grid;place-items:center;width:56px;height:56px;margin:auto;border-radius:16px;background:#084b38;color:#fff;font-size:28px;font-weight:900}h1{font-size:30px;margin:20px 0 12px}p{color:#5e6964;line-height:1.6;margin:0}button{margin-top:24px;min-height:44px;border:0;border-radius:12px;background:#0a654a;color:#fff;padding:0 20px;font-weight:800}</style><main class="card"><div class="mark" aria-hidden="true">F</div><h1>You’re offline</h1><p>FirstSeen never caches your private jobs, referrals, resumes, or applications. Reconnect and retry for the latest verified state.</p><button onclick="location.reload()">Try again</button></main></html>`;

function safeAppPath(value) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return "/";
  const destination = new URL(value, self.location.origin);
  return destination.origin === self.location.origin
    ? `${destination.pathname}${destination.search}${destination.hash}`
    : "/";
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(STATIC_ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))),
      ),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response(OFFLINE_HTML, {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        }),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data?.json() ?? {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" ? data.title : "New FirstSeen match";
  const body = typeof data.body === "string" ? data.body : "Open FirstSeen to review it.";
  const path = safeAppPath(data.path);
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        tag: typeof data.tag === "string" ? data.tag : "firstseen-match",
        renotify: true,
        data: { path, notificationId: data.notificationId ?? null },
      }),
      Number.isInteger(data.unreadCount) && self.navigator.setAppBadge
        ? self.navigator.setAppBadge(Math.max(0, data.unreadCount))
        : Promise.resolve(),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safeAppPath(event.notification.data?.path);
  event.waitUntil(
    (async () => {
      const notificationId = event.notification.data?.notificationId;
      if (typeof notificationId === "string") {
        try {
          const response = await fetch("/api/notifications/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notificationId }),
          });
          const result = await response.json();
          if (response.ok && Number.isInteger(result.unreadCount) && self.navigator.setAppBadge)
            await self.navigator.setAppBadge(Math.max(0, result.unreadCount));
        } catch {
          // Read tracking must never block the exact job deep link.
        }
      }
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const destination = new URL(path, self.location.origin).href;
      for (const client of clients) {
        if ("focus" in client) {
          await client.navigate(destination);
          return client.focus();
        }
      }
      return self.clients.openWindow(destination);
    })(),
  );
});

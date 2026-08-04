"use client";

import { RefreshCw, WifiOff } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

function subscribeToConnectivity(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function ServiceWorkerRegistration({ enabled }: { enabled: boolean }) {
  const online = useSyncExternalStore(
    subscribeToConnectivity,
    () => navigator.onLine,
    () => true,
  );
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const reloadForAcceptedUpdate = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!enabled) {
      void Promise.all([
        navigator.serviceWorker.getRegistrations().then((registrations) =>
          Promise.all(
            registrations
              .filter((item) => {
                const worker = item.active ?? item.waiting ?? item.installing;
                return worker ? new URL(worker.scriptURL).pathname === "/sw.js" : false;
              })
              .map((item) => item.unregister()),
          ),
        ),
        "caches" in window
          ? caches
              .keys()
              .then((names) =>
                Promise.all(
                  names
                    .filter((name) => name.startsWith("firstseen-static-"))
                    .map((name) => caches.delete(name)),
                ),
              )
          : Promise.resolve([]),
      ]);
      return;
    }
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((registration) => {
        if (registration.waiting) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller)
              setWaiting(worker);
          });
        });
      })
      .catch(() => undefined);
    const reload = () => {
      if (reloadForAcceptedUpdate.current) window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", reload);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", reload);
  }, [enabled]);

  if (!enabled) return null;

  if (!online)
    return (
      <div
        className="fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 flex items-center gap-2 rounded-xl bg-[var(--green-dark)] px-4 py-3 text-xs font-black text-white shadow-xl"
        role="status"
      >
        <WifiOff aria-hidden="true" size={15} /> Offline · changes are paused
      </div>
    );
  if (waiting)
    return (
      <button
        className="fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-50 flex min-h-11 items-center gap-2 rounded-xl bg-[var(--lime)] px-4 text-xs font-black text-[var(--ink)] shadow-xl"
        onClick={() => {
          reloadForAcceptedUpdate.current = true;
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}
        type="button"
      >
        <RefreshCw aria-hidden="true" size={15} /> Update FirstSeen
      </button>
    );
  return null;
}

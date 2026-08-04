"use client";

import { Bell, BellOff, CheckCircle2, Smartphone } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";

function subscribeToPushSupport() {
  return () => undefined;
}

function browserPermission(): NotificationPermission | "unsupported" {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
    ? Notification.permission
    : "unsupported";
}

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

export function PushSettings({
  publicKey,
  detailedByDefault,
}: {
  publicKey: string | null;
  detailedByDefault: boolean;
}) {
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const detectedPermission = useSyncExternalStore(
    subscribeToPushSupport,
    browserPermission,
    () => "default" as const,
  );
  const [permissionOverride, setPermissionOverride] = useState<NotificationPermission | null>(null);
  const permission = permissionOverride ?? detectedPermission;
  const [detailed, setDetailed] = useState(detailedByDefault);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (detectedPermission === "unsupported") return;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(setSubscription);
  }, [detectedPermission]);

  async function enable() {
    if (!publicKey) {
      setMessage("Web Push has not been configured on this deployment yet.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await Notification.requestPermission();
      setPermissionOverride(result);
      if (result !== "granted") {
        setMessage("Notifications were not enabled. You can continue using Slack.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const current =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey),
        }));
      const response = await fetch("/api/push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(current.toJSON()),
      });
      if (!response.ok) throw new Error("Subscription registration failed.");
      setSubscription(current);
      setMessage("This device will receive fresh-match alerts.");
    } catch {
      setMessage(
        "This device could not be subscribed. Check browser notification settings and retry.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!subscription) return;
    setBusy(true);
    const endpoint = subscription.endpoint;
    try {
      const response = await fetch("/api/push/subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      if (!response.ok) throw new Error("Subscription revocation failed.");
      await subscription.unsubscribe();
      setSubscription(null);
      setMessage("Push alerts are off for this device.");
    } catch {
      setMessage("Push alerts could not be turned off. Reconnect and retry.");
    } finally {
      setBusy(false);
    }
  }

  async function changeDetail(next: boolean) {
    setDetailed(next);
    const response = await fetch("/api/push/subscriptions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ detailedLockScreen: next }),
    });
    if (!response.ok) {
      setDetailed(!next);
      setMessage("Lock-screen privacy preference could not be saved.");
    }
  }

  return (
    <section className="mt-6 rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black">
            <Smartphone aria-hidden="true" size={19} /> Device push alerts
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
            Receive verified fresh Hot and Strong matches even while FirstSeen is closed. On iPhone
            or iPad, install FirstSeen to the Home Screen first.
          </p>
        </div>
        {subscription ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e7f6ef] px-3 py-1.5 text-xs font-black text-[var(--green)]">
            <CheckCircle2 size={14} /> Enabled here
          </span>
        ) : null}
      </div>
      {permission === "unsupported" ? (
        <p className="mt-4 rounded-xl bg-[var(--paper)] p-3 text-sm font-bold">
          This browser does not expose standards-based Web Push.
        </p>
      ) : (
        <div className="mt-5">
          {subscription ? (
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line)] px-4 text-sm font-black text-[var(--danger)]"
              disabled={busy}
              onClick={disable}
              type="button"
            >
              <BellOff size={16} /> Turn off on this device
            </button>
          ) : (
            <button
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--green)] px-4 text-sm font-black text-white"
              disabled={busy || permission === "denied"}
              onClick={enable}
              type="button"
            >
              <Bell size={16} /> {busy ? "Enabling…" : "Enable on this device"}
            </button>
          )}
          {permission === "denied" ? (
            <p className="mt-3 text-xs font-bold text-[var(--danger)]">
              Notifications are blocked in browser settings. Unblock this site before retrying.
            </p>
          ) : null}
          <label className="mt-5 flex items-start gap-3 rounded-xl bg-[var(--paper)] p-4 text-sm">
            <input
              checked={detailed}
              className="mt-1"
              disabled={!subscription}
              onChange={(event) => void changeDetail(event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong className="block">Show job and company on the lock screen</strong>
              <span className="mt-1 block text-xs leading-5 text-[var(--muted)]">
                Off by default. Generic alerts protect your job-search privacy when other people can
                see your device.
              </span>
            </span>
          </label>
        </div>
      )}
      {message ? (
        <p className="mt-4 text-xs font-bold text-[var(--muted)]" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}

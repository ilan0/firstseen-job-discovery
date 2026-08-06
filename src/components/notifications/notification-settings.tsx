"use client";

import {
  Bell,
  BellOff,
  Building2,
  Check,
  ChevronRight,
  Clock3,
  Eye,
  EyeOff,
  LoaderCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  Smartphone,
  WifiOff,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { NotificationPreferenceInput } from "@/domain/notifications/preferences";
import { alertRoleFamilies } from "@/domain/notifications/preferences";

type Device = {
  id: string;
  deviceLabel: string | null;
  userAgentSafe: string | null;
  detailedLockScreen: boolean;
  lastUsedAt: string | null;
  failureCount: number;
  createdAt: string;
};

type Company = {
  organizationId: string;
  name: string;
  interested: boolean;
  scope: string;
  overrideMode: "always" | "mute" | null;
  hasActiveReferral: boolean;
};

export type NotificationSettingsData = {
  preference: NotificationPreferenceInput;
  devices: Device[];
  companies: Company[];
};

type Preview = {
  evaluatedJobs: number;
  estimatedAlerts: number;
  reasons: Record<string, number>;
  suppressed: Record<string, number>;
  approximate: boolean;
};

const roleLabels: Record<(typeof alertRoleFamilies)[number], string> = {
  general_swe: "General SWE",
  full_stack: "Full stack",
  backend: "Backend",
  frontend: "Frontend",
  ai_engineering: "AI engineering",
  embedded: "Embedded",
  internal_automation: "Internal automation",
  customer_facing: "Customer-facing",
  other: "Other software roles",
};

const presetCopy = {
  selective: {
    title: "Selective",
    text: "Only fresh Hot and Strong matches, plus priority companies.",
  },
  balanced: {
    title: "Balanced",
    text: "Fresh Hot and Strong matches, plus very fresh Possible matches in your preferred roles.",
  },
  all_viable: {
    title: "All viable",
    text: "Every eligible Hot, Strong, or Possible match posted within 24 hours.",
  },
} as const;

function onlineSnapshot() {
  return navigator.onLine;
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function pushSupportSnapshot() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
    return "unsupported" as const;
  return Notification.permission;
}

function noopSubscribe() {
  return () => undefined;
}

function applicationServerKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

function presetValues(
  preset: "selective" | "balanced" | "all_viable",
  current: NotificationPreferenceInput,
): NotificationPreferenceInput {
  if (preset === "selective")
    return {
      ...current,
      enabled: true,
      alertPreset: preset,
      immediateHot: true,
      immediateStrong: true,
      immediatePossible: false,
      hotStrongMaxAgeHours: 24,
      possibleMaxAgeHours: 6,
      roleFamilies: ["general_swe", "full_stack", "backend", "frontend", "ai_engineering"],
    };
  if (preset === "all_viable")
    return {
      ...current,
      enabled: true,
      alertPreset: preset,
      immediateHot: true,
      immediateStrong: true,
      immediatePossible: true,
      hotStrongMaxAgeHours: 24,
      possibleMaxAgeHours: 24,
      roleFamilies: ["general_swe", "full_stack", "backend", "frontend", "ai_engineering"],
    };
  return {
    ...current,
    enabled: true,
    alertPreset: preset,
    immediateHot: true,
    immediateStrong: true,
    immediatePossible: true,
    hotStrongMaxAgeHours: 24,
    possibleMaxAgeHours: 6,
    roleFamilies: ["general_swe", "full_stack", "backend", "frontend", "ai_engineering"],
  };
}

function hourLabel(hour: number) {
  if (hour === 0) return "12:00 AM";
  if (hour === 12) return "12:00 PM";
  return `${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? "PM" : "AM"}`;
}

async function jsonRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const body = (await response.json().catch(() => null)) as ({ error?: string } & T) | null;
  if (!response.ok) throw new Error(body?.error ?? "Request failed");
  return body as T;
}

export function NotificationSettings({
  publicKey,
  initialData,
}: {
  publicKey: string | null;
  initialData: NotificationSettingsData;
}) {
  const online = useSyncExternalStore(subscribeOnline, onlineSnapshot, () => true);
  const detectedPermission = useSyncExternalStore(
    noopSubscribe,
    pushSupportSnapshot,
    () => "default" as const,
  );
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    detectedPermission,
  );
  const [data, setData] = useState<NotificationSettingsData>(initialData);
  const [preference, setPreference] = useState<NotificationPreferenceInput>(initialData.preference);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [currentDetailed, setCurrentDetailed] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const refresh = useCallback(async () => {
    const next = await jsonRequest<NotificationSettingsData>("/api/notification-preferences");
    setData(next);
    setPreference(next.preference);
  }, []);

  useEffect(() => {
    if (detectedPermission === "unsupported") return;
    void navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then(async (current) => {
        setSubscription(current);
        if (!current) return;
        const registered = await jsonRequest<{
          subscriptionId: string;
          detailedLockScreen: boolean;
        }>("/api/push/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(current.toJSON()),
        });
        setCurrentDeviceId(registered.subscriptionId);
        setCurrentDetailed(registered.detailedLockScreen);
        await refresh();
      })
      .catch(() => setError("This device’s Push status could not be synchronized."));
  }, [detectedPermission, refresh]);

  const isIos = typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const standalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator &&
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone)));
  const filteredCompanies = useMemo(() => {
    const query = companySearch.trim().toLowerCase();
    return data.companies.filter((company) => company.name.toLowerCase().includes(query));
  }, [companySearch, data.companies]);

  async function enableDevice() {
    if (!publicKey) {
      setError("Push is not configured on this deployment yet.");
      return;
    }
    setBusy("enable");
    setError(null);
    setStatus(null);
    try {
      const grant = await Notification.requestPermission();
      setPermission(grant);
      if (grant !== "granted") throw new Error("Notifications were not allowed in this browser.");
      const registration = await navigator.serviceWorker.ready;
      const current =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey(publicKey),
        }));
      const registered = await jsonRequest<{
        subscriptionId: string;
        detailedLockScreen: boolean;
      }>("/api/push/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(current.toJSON()),
      });
      setSubscription(current);
      setCurrentDeviceId(registered.subscriptionId);
      setCurrentDetailed(registered.detailedLockScreen);
      setStatus("This device is ready. Alerts can arrive while FirstSeen is closed.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This device could not be enabled.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeDevice(deviceId: string, current = false) {
    setBusy(`revoke:${deviceId}`);
    setError(null);
    try {
      await jsonRequest("/api/push/subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionId: deviceId }),
      });
      if (current && subscription) {
        await subscription.unsubscribe();
        setSubscription(null);
        setCurrentDeviceId(null);
      }
      setStatus("Push was revoked for that device.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The device could not be revoked.");
    } finally {
      setBusy(null);
    }
  }

  async function changePrivacy(next: boolean) {
    if (!subscription) return;
    setBusy("privacy");
    setError(null);
    try {
      await jsonRequest("/api/push/subscriptions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint, detailedLockScreen: next }),
      });
      setCurrentDetailed(next);
      setStatus(
        next ? "Detailed lock-screen alerts enabled here." : "Generic private alerts enabled here.",
      );
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Privacy setting could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    if (!subscription) return;
    setBusy("test");
    setError(null);
    setStatus(null);
    try {
      await jsonRequest("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      setStatus("Test accepted. Check this device’s notifications.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The test notification failed.");
    } finally {
      setBusy(null);
    }
  }

  function custom(update: Partial<NotificationPreferenceInput>) {
    setPreference((current) => ({ ...current, ...update, alertPreset: "custom" }));
    setPreview(null);
  }

  async function savePolicy() {
    if (!preference) return;
    setBusy("save");
    setError(null);
    try {
      const saved = await jsonRequest<{ preference: NotificationPreferenceInput }>(
        "/api/notification-preferences",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preference),
        },
      );
      setPreference(saved.preference);
      setStatus("Notification policy saved.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Notification policy could not be saved.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function runPreview() {
    if (!preference) return;
    setPreviewBusy(true);
    setError(null);
    try {
      setPreview(
        await jsonRequest<Preview>("/api/notification-preferences/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(preference),
        }),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Policy preview is temporarily unavailable.",
      );
    } finally {
      setPreviewBusy(false);
    }
  }

  async function setCompanyOverride(organizationId: string, mode: "always" | "mute" | null) {
    setBusy(`company:${organizationId}`);
    setError(null);
    try {
      await jsonRequest(`/api/notification-preferences/companies/${organizationId}`, {
        method: mode ? "PUT" : "DELETE",
        headers: { "Content-Type": "application/json" },
        ...(mode ? { body: JSON.stringify({ mode }) } : {}),
      });
      setData((current) =>
        current
          ? {
              ...current,
              companies: current.companies.map((company) =>
                company.organizationId === organizationId
                  ? { ...company, overrideMode: mode }
                  : company,
              ),
            }
          : current,
      );
      setPreview(null);
      setStatus("Company alert rule saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Company rule could not be saved.");
    } finally {
      setBusy(null);
    }
  }

  const effectivePreset = preference.alertPreset === "off" ? "custom" : preference.alertPreset;
  const policySummary = !preference.enabled
    ? "Job alerts are off. Your FirstSeen queue continues updating normally."
    : preference.alertPreset === "balanced"
      ? presetCopy.balanced.text
      : preference.alertPreset === "selective"
        ? presetCopy.selective.text
        : preference.alertPreset === "all_viable"
          ? presetCopy.all_viable.text
          : "Your advanced band, freshness, role, company, and quiet-hour rules are active.";

  return (
    <div className="mt-6 space-y-6">
      {!online ? (
        <p
          className="flex items-center gap-2 rounded-xl border border-[var(--coral)] bg-[#fff3ef] p-3 text-sm font-bold"
          role="status"
        >
          <WifiOff size={17} /> You’re offline. Existing settings are shown, but changes cannot save
          yet.
        </p>
      ) : null}
      {error ? (
        <p
          className="rounded-xl border border-[var(--coral)] bg-[#fff3ef] p-3 text-sm font-bold text-[var(--danger)]"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {status ? (
        <p
          className="flex items-center gap-2 rounded-xl border border-[#b9dfcf] bg-[#e7f6ef] p-3 text-sm font-bold text-[var(--green)]"
          role="status"
        >
          <Check size={17} /> {status}
        </p>
      ) : null}

      <section className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black tracking-[0.14em] text-[var(--green)] uppercase">
              Phone alert status
            </p>
            <h2 className="mt-1 flex items-center gap-2 text-xl font-black">
              <Smartphone size={20} /> Push notifications
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--muted)]">
              FirstSeen can alert this phone immediately after a fresh, verified match
              qualifies—even while the app is closed.
            </p>
          </div>
          <StatusPill
            label={
              detectedPermission === "unsupported"
                ? "Unsupported"
                : permission === "denied"
                  ? "Permission blocked"
                  : subscription
                    ? "Active here"
                    : "Not active here"
            }
            good={Boolean(subscription)}
          />
        </div>

        {isIos && !standalone ? (
          <div className="mt-5 rounded-xl border border-[#ead58b] bg-[#fff9e4] p-4 text-sm leading-6">
            <strong>Install FirstSeen first:</strong> open Safari’s Share menu, choose{" "}
            <strong>Add to Home Screen</strong>, then launch FirstSeen from its new icon. Apple
            allows Push permission only from the installed Home Screen app.
          </div>
        ) : null}
        {permission === "denied" ? (
          <p className="mt-5 rounded-xl bg-[var(--paper)] p-4 text-sm font-bold text-[var(--danger)]">
            Notifications are blocked for FirstSeen. Re-enable them in this device’s browser or
            system settings, then return here.
          </p>
        ) : null}
        {detectedPermission === "unsupported" ? (
          <p className="mt-5 rounded-xl bg-[var(--paper)] p-4 text-sm font-bold">
            This browser does not support standards-based Web Push. Your queue still works normally
            in FirstSeen.
          </p>
        ) : (
          <div className="mt-5 flex flex-wrap gap-3">
            {subscription ? (
              <>
                <button
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--green)] px-4 text-sm font-black text-white disabled:opacity-60"
                  disabled={!online || Boolean(busy)}
                  onClick={() => void sendTest()}
                  type="button"
                >
                  {busy === "test" ? (
                    <LoaderCircle className="animate-spin" size={16} />
                  ) : (
                    <Send size={16} />
                  )}{" "}
                  Send test notification
                </button>
                {currentDeviceId ? (
                  <button
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line)] px-4 text-sm font-black text-[var(--danger)] disabled:opacity-60"
                    disabled={!online || Boolean(busy)}
                    onClick={() => void revokeDevice(currentDeviceId, true)}
                    type="button"
                  >
                    <BellOff size={16} /> Turn off on this device
                  </button>
                ) : null}
              </>
            ) : (
              <button
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--green)] px-4 text-sm font-black text-white disabled:opacity-60"
                disabled={
                  !online || Boolean(busy) || permission === "denied" || (isIos && !standalone)
                }
                onClick={() => void enableDevice()}
                type="button"
              >
                {busy === "enable" ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <Bell size={16} />
                )}{" "}
                Enable on this device
              </button>
            )}
          </div>
        )}

        <div className="mt-6 border-t border-[var(--line)] pt-5">
          <h3 className="text-sm font-black">Active devices</h3>
          {data.devices.length ? (
            <ul className="mt-3 space-y-2">
              {data.devices.map((device) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[var(--paper)] p-3"
                  key={device.id}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-black">
                      {device.deviceLabel ?? "Browser device"}
                      {device.id === currentDeviceId ? " · This device" : ""}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {device.detailedLockScreen ? "Detailed lock screen" : "Generic private alert"}{" "}
                      ·{" "}
                      {device.lastUsedAt
                        ? `Last success ${new Date(device.lastUsedAt).toLocaleDateString()}`
                        : "Awaiting first successful alert"}
                      {device.failureCount
                        ? ` · ${device.failureCount} recent failure${device.failureCount === 1 ? "" : "s"}`
                        : ""}
                    </p>
                  </div>
                  <button
                    aria-label={`Revoke ${device.deviceLabel ?? "device"}`}
                    className="min-h-10 rounded-lg border border-[var(--line)] px-3 text-xs font-black text-[var(--danger)] disabled:opacity-50"
                    disabled={!online || Boolean(busy)}
                    onClick={() => void revokeDevice(device.id, device.id === currentDeviceId)}
                    type="button"
                  >
                    {busy === `revoke:${device.id}` ? "Revoking…" : "Revoke"}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 rounded-xl bg-[var(--paper)] p-4 text-sm text-[var(--muted)]">
              No Push devices are active yet.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black tracking-[0.14em] text-[var(--green)] uppercase">
              Alert policy
            </p>
            <h2 className="mt-1 text-xl font-black">Choose what deserves interruption</h2>
          </div>
          <Toggle
            checked={preference.enabled}
            label="Job alerts"
            onChange={(enabled) => {
              setPreference({ ...preference, enabled });
              setPreview(null);
            }}
          />
        </div>
        <p className="mt-3 rounded-xl bg-[var(--paper)] p-4 text-sm leading-6 text-[var(--muted)]">
          {policySummary}
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {(
            Object.entries(presetCopy) as Array<
              [keyof typeof presetCopy, (typeof presetCopy)[keyof typeof presetCopy]]
            >
          ).map(([key, copy]) => {
            const selected = effectivePreset === key;
            return (
              <button
                aria-pressed={selected}
                className={`rounded-xl border p-4 text-left transition ${selected ? "border-[var(--green)] bg-[#e7f6ef] shadow-sm" : "border-[var(--line)] bg-white hover:border-[#a9aaa3]"}`}
                key={key}
                onClick={() => {
                  setPreference(presetValues(key, preference));
                  setPreview(null);
                }}
                type="button"
              >
                <span className="flex items-center justify-between gap-2 text-sm font-black">
                  {copy.title}
                  {selected ? <Check size={16} /> : null}
                </span>
                <span className="mt-2 block text-xs leading-5 text-[var(--muted)]">
                  {copy.text}
                </span>
              </button>
            );
          })}
        </div>

        <details
          className="mt-5 rounded-xl border border-[var(--line)] bg-white"
          open={preference.alertPreset === "custom"}
        >
          <summary className="flex min-h-12 items-center justify-between gap-3 px-4 text-sm font-black">
            Advanced rules{" "}
            <span className="rounded-full bg-[var(--paper)] px-2 py-1 text-[10px] uppercase">
              {preference.alertPreset === "custom" ? "Custom" : "Optional"}
            </span>
          </summary>
          <div className="space-y-6 border-t border-[var(--line)] p-4">
            <fieldset>
              <legend className="text-sm font-black">Match bands</legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <ToggleRow
                  checked={preference.immediateHot}
                  label="Hot"
                  onChange={(immediateHot) => custom({ immediateHot })}
                />
                <ToggleRow
                  checked={preference.immediateStrong}
                  label="Strong"
                  onChange={(immediateStrong) => custom({ immediateStrong })}
                />
                <ToggleRow
                  checked={preference.immediatePossible}
                  label="Possible"
                  onChange={(immediatePossible) => custom({ immediatePossible })}
                />
                <div
                  aria-disabled="true"
                  className="flex min-h-12 items-center justify-between rounded-xl bg-[var(--paper)] px-3 text-sm text-[var(--muted)]"
                >
                  <span>
                    <strong className="text-[var(--ink)]">Review</strong>
                    <span className="block text-xs">
                      Web feed only—uncertain jobs never interrupt you.
                    </span>
                  </span>
                  <ShieldCheck size={18} />
                </div>
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="Hot / Strong freshness"
                value={preference.hotStrongMaxAgeHours}
                values={[6, 12, 24]}
                onChange={(hotStrongMaxAgeHours) => custom({ hotStrongMaxAgeHours })}
              />
              <SelectField
                label="Possible freshness"
                value={preference.possibleMaxAgeHours}
                values={[1, 3, 6, 12, 24]}
                onChange={(possibleMaxAgeHours) => custom({ possibleMaxAgeHours })}
              />
            </div>
            <fieldset>
              <legend className="text-sm font-black">
                Role families eligible for Possible alerts
              </legend>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {alertRoleFamilies.map((role) => (
                  <label
                    className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-[var(--paper)] px-3 text-xs font-black"
                    key={role}
                  >
                    {roleLabels[role]}
                    <input
                      checked={preference.roleFamilies.includes(role)}
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...new Set([...preference.roleFamilies, role])]
                          : preference.roleFamilies.filter((item) => item !== role);
                        if (next.length) custom({ roleFamilies: next });
                      }}
                      type="checkbox"
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-2 sm:grid-cols-2">
              <ToggleRow
                checked={preference.interestedCompany}
                label="Promote Interested companies"
                onChange={(interestedCompany) => custom({ interestedCompany })}
              />
              <ToggleRow
                checked={preference.referralCompany}
                label="Promote referral companies"
                onChange={(referralCompany) => custom({ referralCompany })}
              />
            </div>
          </div>
        </details>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--green)] px-5 text-sm font-black text-white disabled:opacity-60"
            disabled={!online || busy === "save"}
            onClick={() => void savePolicy()}
            type="button"
          >
            {busy === "save" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Check size={16} />
            )}{" "}
            Save alert policy
          </button>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
        <p className="text-xs font-black tracking-[0.14em] text-[var(--green)] uppercase">
          Company overrides
        </p>
        <h2 className="mt-1 flex items-center gap-2 text-xl font-black">
          <Building2 size={20} /> Fine-tune My Companies
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Always alert still requires an eligible, verified, open, unacted job posted within 24
          hours. Mute wins over Interested and referral status.
        </p>
        <label className="mt-5 block text-sm font-black">
          Search companies
          <input
            className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 font-normal"
            onChange={(event) => setCompanySearch(event.target.value)}
            placeholder="Type a company name"
            value={companySearch}
          />
        </label>
        {filteredCompanies.length ? (
          <div className="mt-4 max-h-[32rem] space-y-2 overflow-y-auto pr-1">
            {filteredCompanies.map((company) => (
              <div
                className="rounded-xl border border-[var(--line)] p-3"
                key={company.organizationId}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-black">{company.name}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {company.interested ? <Chip>Interested</Chip> : null}
                      {company.hasActiveReferral ? <Chip>Referral</Chip> : null}
                    </div>
                  </div>
                  <select
                    aria-label={`Alert rule for ${company.name}`}
                    className="min-h-10 rounded-lg border border-[var(--line)] bg-white px-3 text-xs font-black"
                    disabled={!online || busy === `company:${company.organizationId}`}
                    onChange={(event) =>
                      void setCompanyOverride(
                        company.organizationId,
                        event.target.value === "global"
                          ? null
                          : (event.target.value as "always" | "mute"),
                      )
                    }
                    value={company.overrideMode ?? "global"}
                  >
                    <option value="global">Use global</option>
                    <option value="always">Always alert</option>
                    <option value="mute">Mute</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 rounded-xl bg-[var(--paper)] p-4 text-sm text-[var(--muted)]">
            {data.companies.length
              ? "No companies match that search."
              : "Your My Companies list is empty. Follow a company to add an override."}
          </p>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
          <p className="text-xs font-black tracking-[0.14em] text-[var(--green)] uppercase">
            Quiet hours
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-black">
            <Clock3 size={20} /> Protect your sleep
          </h2>
          <div className="mt-5">
            <ToggleRow
              checked={preference.quietHoursEnabled}
              label="Defer alerts overnight"
              onChange={(quietHoursEnabled) => custom({ quietHoursEnabled })}
            />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <HourSelect
              label="Start"
              value={preference.quietHoursStart}
              onChange={(quietHoursStart) => custom({ quietHoursStart })}
            />
            <HourSelect
              label="End"
              value={preference.quietHoursEnd}
              onChange={(quietHoursEnd) => custom({ quietHoursEnd })}
            />
          </div>
          <label className="mt-4 block text-sm font-black">
            Time zone
            <select
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3"
              onChange={(event) => custom({ timezone: event.target.value })}
              value={preference.timezone}
            >
              <option value="America/New_York">Eastern Time</option>
              <option value="America/Chicago">Central Time</option>
              <option value="America/Denver">Mountain Time</option>
              <option value="America/Los_Angeles">Pacific Time</option>
            </select>
          </label>
          <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
            At quiet-hours end, FirstSeen checks the job again. Closed, stale, muted, saved,
            dismissed, or applied jobs are canceled instead of waking you.
          </p>
          <button
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--green)] px-4 text-sm font-black text-white disabled:opacity-60"
            disabled={!online || busy === "save"}
            onClick={() => void savePolicy()}
            type="button"
          >
            {busy === "save" ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <Check size={16} />
            )}{" "}
            Save quiet hours
          </button>
        </div>

        <div className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
          <p className="text-xs font-black tracking-[0.14em] text-[var(--green)] uppercase">
            Lock-screen privacy
          </p>
          <h2 className="mt-1 flex items-center gap-2 text-xl font-black">
            {currentDetailed ? <Eye size={20} /> : <EyeOff size={20} />} This device
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
            Generic is the private default. Detailed shows fit band, job title, and company—never
            referral names, weaknesses, resume data, or application status.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button
              aria-pressed={!currentDetailed}
              className={`min-h-20 rounded-xl border p-3 text-left ${!currentDetailed ? "border-[var(--green)] bg-[#e7f6ef]" : "border-[var(--line)]"}`}
              disabled={!subscription || busy === "privacy"}
              onClick={() => void changePrivacy(false)}
              type="button"
            >
              <strong className="text-sm">Generic</strong>
              <span className="mt-1 block text-xs text-[var(--muted)]">“New FirstSeen match”</span>
            </button>
            <button
              aria-pressed={currentDetailed}
              className={`min-h-20 rounded-xl border p-3 text-left ${currentDetailed ? "border-[var(--green)] bg-[#e7f6ef]" : "border-[var(--line)]"}`}
              disabled={!subscription || busy === "privacy"}
              onClick={() => void changePrivacy(true)}
              type="button"
            >
              <strong className="text-sm">Detailed</strong>
              <span className="mt-1 block text-xs text-[var(--muted)]">Band, title, company</span>
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-[var(--line)] bg-[var(--surface)] p-5 sm:p-6">
        <p className="text-xs font-black tracking-[0.14em] text-[var(--green)] uppercase">
          Policy preview
        </p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black">Estimate the noise before saving</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Uses the same production evaluator against recommendations from the previous seven
              days. Nothing is sent.
            </p>
          </div>
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line)] px-4 text-sm font-black disabled:opacity-60"
            disabled={!online || previewBusy}
            onClick={() => void runPreview()}
            type="button"
          >
            {previewBusy ? (
              <LoaderCircle className="animate-spin" size={16} />
            ) : (
              <RefreshCw size={16} />
            )}{" "}
            Preview policy
          </button>
        </div>
        {preview ? (
          <div className="mt-5 rounded-xl bg-[var(--paper)] p-5" role="status">
            <p className="text-3xl font-black tracking-[-0.04em]">≈ {preview.estimatedAlerts}</p>
            <p className="mt-1 text-sm font-bold">
              alerts from {preview.evaluatedJobs} recently evaluated jobs
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(preview.reasons).map(([reason, count]) => (
                <span className="rounded-full bg-white px-3 py-1.5 text-xs font-black" key={reason}>
                  {reason.replaceAll("_", " ")} · {count}
                </span>
              ))}
            </div>
            {Object.keys(preview.suppressed).length ? (
              <p className="mt-4 text-xs leading-5 text-[var(--muted)]">
                Common suppressions:{" "}
                {Object.entries(preview.suppressed)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 4)
                  .map(([reason, count]) => `${reason.replaceAll("_", " ")} (${count})`)
                  .join(", ")}
                .
              </p>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Toggle({
  checked,
  label,
  onChange,
  showLabel = true,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
  showLabel?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-3 text-sm font-black">
      {showLabel ? <span>{label}</span> : null}
      <button
        aria-checked={checked}
        aria-label={label}
        className={`relative h-7 w-12 shrink-0 rounded-full transition ${checked ? "bg-[var(--green)]" : "bg-[#b5bbb7]"}`}
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          aria-hidden="true"
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "left-6" : "left-1"}`}
        />
      </button>
    </span>
  );
}

function ToggleRow({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-[var(--paper)] px-3">
      <span className="text-sm font-black">{label}</span>
      <Toggle checked={checked} label={`Toggle ${label}`} onChange={onChange} showLabel={false} />
    </div>
  );
}

function SelectField({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: number;
  values: number[];
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-sm font-black">
      {label}
      <select
        className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3"
        onChange={(event) => onChange(Number(event.target.value))}
        value={value}
      >
        {values.map((hours) => (
          <option key={hours} value={hours}>
            {hours} hour{hours === 1 ? "" : "s"}
          </option>
        ))}
      </select>
    </label>
  );
}

function HourSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-sm font-black">
      {label}
      <select
        className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3"
        onChange={(event) => onChange(Number(event.target.value))}
        value={value}
      >
        {Array.from({ length: 24 }, (_, hour) => (
          <option key={hour} value={hour}>
            {hourLabel(hour)}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusPill({ label, good }: { label: string; good: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${good ? "bg-[#e7f6ef] text-[var(--green)]" : "bg-[var(--paper)] text-[var(--muted)]"}`}
    >
      {good ? <Check size={14} /> : <ChevronRight size={14} />}
      {label}
    </span>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-[var(--paper)] px-2 py-1 text-[10px] font-black uppercase">
      {children}
    </span>
  );
}

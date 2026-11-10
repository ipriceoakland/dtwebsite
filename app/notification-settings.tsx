"use client";

import { useEffect, useState } from "react";

const workerPath = "/deltatime-push.js";

async function pushApi<T>(body?: object): Promise<T> {
  const response = await fetch("/api/notifications", body ? {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  } : { cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error ?? "Notification settings are unavailable.");
  return result as T;
}

export function NotificationSettings() {
  const [setup, setSetup] = useState<{ registration: ServiceWorkerRegistration; publicKey: string }>();
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Checking notification availability…");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const standalone = matchMedia("(display-mode: standalone)").matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone;
      const isAppleMobile = /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
        (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
      if (isAppleMobile && !standalone) {
        setMessage("In Safari, use Share → Add to Home Screen. Open Deltatime from its icon, then return to Profile.");
        return;
      }
      if (!window.isSecureContext || !("serviceWorker" in navigator) ||
          !("PushManager" in window) || !("Notification" in window)) {
        setMessage("Push notifications aren’t available in this browser.");
        return;
      }
      try {
        const { publicKey } = await pushApi<{ publicKey: string }>();
        const registration = await navigator.serviceWorker.register(workerPath);
        const ready = await navigator.serviceWorker.ready;
        if (ready.scope !== registration.scope) throw new Error("Couldn’t start the notification worker.");
        const current = await ready.pushManager.getSubscription();
        const active = current
          ? (await pushApi<{ enabled: boolean }>({ action: "status", endpoint: current.endpoint })).enabled
          : false;
        if (cancelled) return;
        setSetup({ registration: ready, publicKey });
        setSubscription(current);
        setEnabled(active);
        setMessage(active ? "Notifications are enabled on this device." : "Enable notifications on this device.");
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Couldn’t set up notifications.");
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  async function enable() {
    if (!setup) return;
    setBusy(true);
    try {
      // Ask from the button handler so Safari can associate the prompt with the tap.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Allow notifications in your browser or device settings, then try again.");
        return;
      }
      const current = subscription ?? await setup.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: setup.publicKey,
      });
      setSubscription(current);
      const { keys } = current.toJSON();
      await pushApi({ action: "enable", endpoint: current.endpoint, ...keys });
      setEnabled(true);
      setMessage("Notifications are enabled on this device.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn’t enable notifications.");
    } finally {
      setBusy(false);
    }
  }

  async function update(action: "test" | "disable") {
    if (!subscription) return;
    setBusy(true);
    try {
      await pushApi({ action, endpoint: subscription.endpoint });
      if (action === "disable") {
        setEnabled(false);
        await subscription.unsubscribe();
        setSubscription(null);
        setMessage("Notifications are off on this device.");
      } else {
        setMessage("Test sent. Check your notifications.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Couldn’t update notifications.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="notification-settings" aria-labelledby="notification-settings-title">
      <h3 id="notification-settings-title">Notifications</h3>
      <p className="modal-text" role="status">{message}</p>
      {setup && (
        <div className="notification-actions">
          {enabled ? (
            <button className="button button-primary" type="button" disabled={busy} onClick={() => void update("test")}>
              Send test notification
            </button>
          ) : (
            <button className="button button-primary" type="button" disabled={busy} onClick={() => void enable()}>
              Enable notifications
            </button>
          )}
          {subscription && (
            <button className="button" type="button" disabled={busy} onClick={() => void update("disable")}>
              Disable on this device
            </button>
          )}
        </div>
      )}
    </section>
  );
}

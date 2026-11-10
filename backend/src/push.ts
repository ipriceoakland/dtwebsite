import { generateRequestDetails } from "web-push";
import { getSessionUserId, type AuthEnv } from "./auth";

export type PushEnv = AuthEnv & {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function pushFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const message = error.message;
  // Library errors may contain a contact address or subscription URL.
  // Log fixed descriptions only.
  if (/vapid.*subject|subject value/i.test(message)) return "invalid VAPID contact";
  if (/vapid.*key|vapidDetails\.(?:publicKey|privateKey)/i.test(message)) return "invalid VAPID key";
  if (/p256dh|auth secret|public key is not valid for specified curve/i.test(message)) return "invalid subscription key";
  if (error.name === "TimeoutError" || error.name === "AbortError") return "request timed out or was aborted";
  if (/dns|resolve host/i.test(message)) return "push service DNS failure";
  if (/tls|ssl|certificate/i.test(message)) return "TLS or certificate failure";
  if (/disconnected|network|fetch failed|connection/i.test(message)) return "network failure";
  if (/internal error/i.test(message)) return "Worker runtime internal error";
  if (/header/i.test(message)) return "invalid request header";
  return error instanceof TypeError ? "TypeError" : "unexpected error";
}

// The browser supplies the URL. Only send requests to known push services.
function pushEndpoint(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const url = URL.parse(value);
  if (!url || url.protocol !== "https:" || url.username || url.password ||
      url.port || url.hash || url.pathname === "/") return null;
  const host = url.hostname;
  if (host.endsWith(".push.apple.com") ||
      (host === "fcm.googleapis.com" && url.pathname.startsWith("/fcm/send/")) ||
      (host === "updates.push.services.mozilla.com" && url.pathname.startsWith("/wpush/")) ||
      host.endsWith(".notify.windows.com")) return url.href;
  return null;
}

export async function handlePushRequest(request: Request, env: PushEnv) {
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }
  const appOrigin = URL.parse(env.GOOGLE_REDIRECT_URI ?? "")?.origin;
  if (request.method === "POST" && (!appOrigin || request.headers.get("Origin") !== appOrigin)) {
    return json({ error: "Open Deltatime at its sign-in address to manage notifications." }, 403);
  }

  const userId = await getSessionUserId(request, env.deltatime_dev);
  if (userId === null) return json({ error: "Sign in to manage notifications." }, 401);
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  if (request.method === "GET") {
    if (!publicKey || !privateKey || !subject) {
      return json({ error: "Web Push hasn’t been configured yet." }, 503);
    }
    return json({ publicKey });
  }

  if (!request.headers.get("Content-Type")?.startsWith("application/json")) {
    return json({ error: "Expected JSON." }, 415);
  }
  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return json({ error: "Invalid notification request." }, 400);
  }
  const { action, endpoint: rawEndpoint, p256dh, auth } = input as Record<string, unknown>;
  const endpoint = pushEndpoint(rawEndpoint);
  if (!endpoint) return json({ error: "This browser’s push service isn’t supported yet." }, 400);
  const db = env.deltatime_dev;

  if (action === "status") {
    const saved = await db.prepare("SELECT 1 FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
      .bind(endpoint, userId).first();
    return json({ enabled: Boolean(saved) });
  }
  if (action === "disable") {
    await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
      .bind(endpoint, userId).run();
    return json({ ok: true });
  }
  if (!publicKey || !privateKey || !subject) {
    return json({ error: "Web Push hasn’t been configured yet." }, 503);
  }

  if (action === "enable") {
    if (typeof p256dh !== "string" || !/^[A-Za-z0-9_-]{87}$/.test(p256dh) ||
        typeof auth !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(auth)) {
      return json({ error: "Invalid browser subscription keys." }, 400);
    }
    const saved = await db.prepare(`
      INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth
      WHERE push_subscriptions.user_id = excluded.user_id
      RETURNING endpoint
    `).bind(endpoint, userId, p256dh, auth).first();
    return saved ? json({ ok: true }) : json({
      error: "This browser is linked to another account. Disable notifications on this device, then enable them again.",
    }, 409);
  }

  if (action !== "test") return json({ error: "Unknown notification action." }, 400);
  const subscription = await db.prepare(
    "SELECT p256dh, auth FROM push_subscriptions WHERE endpoint = ? AND user_id = ?",
  ).bind(endpoint, userId).first<{ p256dh: string; auth: string }>();
  if (!subscription) return json({ error: "Enable notifications on this device first." }, 404);

  const now = Math.floor(Date.now() / 1000);
  const allowed = await db.prepare(`
    INSERT INTO push_test_limits (user_id, last_sent_at) VALUES (?, ?)
    ON CONFLICT(user_id) DO UPDATE SET last_sent_at = excluded.last_sent_at
    WHERE push_test_limits.last_sent_at <= ?
    RETURNING user_id
  `).bind(userId, now, now - 30).first();
  if (!allowed) return json({ error: "Wait 30 seconds between test notifications." }, 429);

  let stage = "prepare request";
  try {
    const push = generateRequestDetails(
      { endpoint, keys: subscription },
      JSON.stringify({ title: "Deltatime", body: "Test notification from Deltatime." }),
      { TTL: 60, urgency: "high", contentEncoding: "aes128gcm", vapidDetails: { publicKey, privateKey, subject } },
    );
    const headers = new Headers();
    for (const [name, value] of Object.entries(push.headers)) {
      if (name.toLowerCase() !== "content-length") headers.set(name, String(value));
    }
    stage = "send request";
    const result = await fetch(endpoint, {
      method: "POST",
      headers,
      body: push.body ? Uint8Array.from(push.body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    // Cleanup must not turn an accepted push into a failed send.
    await result.body?.cancel().catch(() => {});
    stage = "handle response";
    if (result.status === 404 || result.status === 410) {
      await db.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?")
        .bind(endpoint, userId).run();
      return json({ error: "This device’s subscription expired. Disable and re-enable notifications." }, 410);
    }
    if (result.ok) return json({ ok: true }, 202);
    console.warn("[Deltatime push] Push service rejected test:", result.status);
  } catch (error) {
    console.warn("[Deltatime push] Test failed at " + stage + ": " + pushFailureReason(error));
  }
  return json({ error: "Couldn’t send the test notification. Try again in 30 seconds." }, 502);
}

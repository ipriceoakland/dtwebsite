import { createECDH, randomBytes } from "node:crypto";
import { env } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { generateVAPIDKeys } from "web-push";
import { runScheduledPush } from "../src/scheduled-push";
import initial from "../migrations/0001_initial_schema.sql?raw";
import google from "../migrations/0002_add_google_identity.sql?raw";
import push from "../migrations/0003_add_web_push.sql?raw";
import schedule from "../migrations/0004_schedule_web_push.sql?raw";

it("claims a due reminder once and retries only devices that still need delivery", async () => {
  const db = env.deltatime_dev;
  for (const sql of [initial, google, push, schedule]) {
    const statements = sql.replace(/^--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
  }
  const cutoff = await db.prepare("SELECT activated_at FROM push_schedule").first<number>("activated_at");
  const now = cutoff! + 120;
  await db.batch([
    db.prepare("INSERT INTO users (id, google_subject) VALUES (1, 'owner'), (2, 'other')"),
    db.prepare(`
      INSERT INTO reminders (id, user_id, body, remind_at, status) VALUES
        (1, 1, 'due', ?, 'pending'),
        (2, 1, 'overdue at rollout', ?, 'pending'),
        (3, 1, 'cancelled', ?, 'cancelled'),
        (4, 2, 'future reminder', ?, 'pending')
    `).bind(now - 1, cutoff! - 1, now - 1, now + 600),
  ]);

  const key = createECDH("prime256v1");
  key.generateKeys();
  const p256dh = key.getPublicKey().toString("base64url");
  const auth = randomBytes(16).toString("base64url");
  const apple = "https://web.push.apple.com/phone";
  const chrome = "https://fcm.googleapis.com/fcm/send/laptop";
  const expired = "https://web.push.apple.com/expired";
  const other = "https://web.push.apple.com/another-account";
  await db.batch([apple, chrome, expired, other].map((endpoint) =>
    db.prepare("INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth) VALUES (?, ?, ?, ?)")
      .bind(endpoint, endpoint === other ? 2 : 1, p256dh, auth),
  ));

  const vapid = generateVAPIDKeys();
  const workerEnv = {
    ...env,
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "mailto:push@example.com",
  };
  let laptopAttempts = 0;
  const send = vi.fn(async (url: string, request: RequestInit) => {
    const headers = new Headers(request.headers);
    expect(headers.get("Topic")).toBe("reminder-1");
    expect(headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(request.redirect).toBe("manual");
    expect(url).not.toBe(other);
    const status = url === expired ? 410 : url === chrome && ++laptopAttempts === 1 ? 503 : 201;
    return new Response(null, { status });
  });
  vi.stubGlobal("fetch", send);
  try {
    await Promise.all([runScheduledPush(workerEnv, now), runScheduledPush(workerEnv, now)]);
    expect(send.mock.calls.map(([url]) => url).sort()).toEqual([apple, chrome, expired].sort());
    expect(await db.prepare("SELECT status FROM reminders WHERE id = 1").first("status")).toBe("sending");
    expect(await db.prepare("SELECT endpoint FROM push_subscriptions WHERE endpoint = ?").bind(expired).first()).toBeNull();

    await runScheduledPush(workerEnv, now + 59);
    expect(send).toHaveBeenCalledTimes(3);

    await runScheduledPush(workerEnv, now + 60);
    expect(send.mock.calls.slice(3).map(([url]) => url)).toEqual([chrome]);
    expect(await db.prepare("SELECT status FROM reminders WHERE id = 1").first("status")).toBe("sent");

    await runScheduledPush(workerEnv, now + 120);
    expect(send).toHaveBeenCalledTimes(4);
    const others = await db.prepare("SELECT id, status FROM reminders WHERE id > 1 ORDER BY id").all();
    expect(others.results).toEqual([
      { id: 2, status: "pending" }, { id: 3, status: "cancelled" }, { id: 4, status: "pending" },
    ]);
  } finally {
    vi.unstubAllGlobals();
  }
});

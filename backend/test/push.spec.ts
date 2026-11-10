import { createECDH, createHash, randomBytes } from "node:crypto";
import { env } from "cloudflare:test";
import { expect, it, vi } from "vitest";
import { generateVAPIDKeys } from "web-push";
import worker from "../src/index";
import schema from "../migrations/0001_initial_schema.sql?raw";
import identities from "../migrations/0002_add_google_identity.sql?raw";
import pushSchema from "../migrations/0003_add_web_push.sql?raw";

it("sends a rate-limited test to the signed-in device and removes an expired subscription", async () => {
  const db = env.deltatime_dev;
  for (const sql of [schema, identities, pushSchema]) {
    const statements = sql.replace(/^--.*$/gm, "").split(";").map((s) => s.trim()).filter(Boolean);
    await db.batch(statements.map((statement) => db.prepare(statement)));
  }
  const accountTokens = [randomBytes(32).toString("base64url"), randomBytes(32).toString("base64url")];
  for (const [index, token] of accountTokens.entries()) {
    const user = await db.prepare("INSERT INTO users (google_subject) VALUES (?) RETURNING id")
      .bind("account-" + index).first<{ id: number }>();
    await db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, unixepoch(), unixepoch() + 600)")
      .bind(createHash("sha256").update(token).digest("hex"), user!.id).run();
  }

  const origin = "https://deltatime.example";
  const vapid = generateVAPIDKeys();
  const localEnv = {
    ...env,
    GOOGLE_REDIRECT_URI: origin + "/api/auth/google/callback",
    VAPID_PUBLIC_KEY: vapid.publicKey,
    VAPID_PRIVATE_KEY: vapid.privateKey,
    VAPID_SUBJECT: "mailto:push@example.com",
  };
  const endpoint = "https://web.push.apple.com/test-subscription";
  const key = createECDH("prime256v1");
  key.generateKeys();
  const request = (action: string, account = 0, overrides: object = {}, requestOrigin = origin) =>
    worker.fetch(new Request(origin + "/api/notifications", {
      method: "POST",
      headers: {
        Cookie: "dt_session=" + accountTokens[account],
        Origin: requestOrigin,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, endpoint, ...overrides }),
    }), localEnv);
  const keys = { p256dh: key.getPublicKey().toString("base64url"), auth: randomBytes(16).toString("base64url") };

  expect((await request("enable", 0, keys, "https://other.example")).status).toBe(403);
  expect((await request("enable", 0, { ...keys, endpoint: "https://other.example/push" })).status).toBe(400);
  expect((await request("enable", 0, keys)).status).toBe(200);
  expect((await request("enable", 1, keys)).status).toBe(409);
  expect((await request("test", 1)).status).toBe(404);

  const deliver = vi.fn(async (url: string, init: RequestInit) => {
    expect(url).toBe(endpoint);
    expect(init.redirect).toBe("manual");
    expect(new Headers(init.headers).get("Authorization")).toMatch(/^vapid /);
    expect(new Headers(init.headers).get("Content-Encoding")).toBe("aes128gcm");
    expect(init.body).toBeInstanceOf(Uint8Array);
    return new Response(null, { status: 201 });
  });
  vi.stubGlobal("fetch", deliver);
  try {
    expect((await request("test")).status).toBe(202);
    expect((await request("test")).status).toBe(429);
    expect(deliver).toHaveBeenCalledTimes(1);

    await db.prepare("UPDATE push_test_limits SET last_sent_at = unixepoch() - 31").run();
    deliver.mockResolvedValueOnce(new Response(null, { status: 410 }));
    expect((await request("test")).status).toBe(410);
    expect(await (await request("status")).json()).toEqual({ enabled: false });
  } finally {
    vi.unstubAllGlobals();
  }
});

import { deliverWebPush, getWebPushConfig, type PushEnv } from "./push";

// Bound both D1 queries and outbound push requests on the Workers Free plan.
const remindersPerRun = 3;
const devicesPerReminder = 3;
const maxAttemptsPerDevice = 3;
const leaseSeconds = 300;
const retrySeconds = 60;

// Both the scan and the claim use these conditions. If the user cancels or
// reschedules between them, the claim fails and nothing is sent.
const dueCondition = `
  source_message_sid IS NULL
  AND EXISTS (SELECT 1 FROM users WHERE id = reminders.user_id AND google_subject IS NOT NULL)
  AND remind_at > (SELECT activated_at FROM push_schedule WHERE id = 1)
  AND remind_at <= ?
  AND (status = 'pending' OR (status = 'sending' AND locked_until <= ?))
`;

type ClaimedReminder = { id: number; user_id: number; body: string; attempts: number };
type Delivery = { id: number; endpoint: string; p256dh: string; auth: string; attempts: number };

export async function runScheduledPush(env: PushEnv, now = Math.floor(Date.now() / 1000)) {
  const config = getWebPushConfig(env);
  if (!config) {
    console.warn("[Deltatime scheduler] Web Push keys are missing; no reminders claimed.");
    return;
  }

  const db = env.deltatime_dev;
  const due = await db.prepare(`
    SELECT id FROM reminders WHERE ${dueCondition}
    ORDER BY remind_at, id LIMIT ?
  `).bind(now, now, remindersPerRun).all<{ id: number }>();

  for (const { id } of due.results) {
    const reminder = await db.prepare(`
      UPDATE reminders
      SET status = 'sending', attempts = attempts + 1, locked_until = ?, updated_at = ?
      WHERE id = ? AND ${dueCondition}
      RETURNING id, user_id, body, attempts
    `).bind(now + leaseSeconds, now, id, now, now).first<ClaimedReminder>();
    if (!reminder) continue;

    // Snapshot recipients once. A device enabled later won't receive an old alert.
    await db.batch([
      db.prepare(`
        INSERT INTO push_reminder_deliveries (reminder_id, endpoint)
        SELECT ?, endpoint FROM push_subscriptions
        WHERE user_id = ?
          AND NOT EXISTS (SELECT 1 FROM push_reminder_deliveries WHERE reminder_id = ?)
      `).bind(id, reminder.user_id, id),
      db.prepare(`
        UPDATE push_reminder_deliveries SET status = 'failed'
        WHERE reminder_id = ? AND status = 'pending' AND endpoint IS NULL
      `).bind(id),
    ]);

    const deliveries = await db.prepare(`
      SELECT d.id, s.endpoint, s.p256dh, s.auth, d.attempts
      FROM push_reminder_deliveries d
      JOIN push_subscriptions s ON s.endpoint = d.endpoint
      WHERE d.reminder_id = ? AND d.status = 'pending' AND s.user_id = ?
      ORDER BY d.attempts, d.id LIMIT ?
    `).bind(id, reminder.user_id, devicesPerReminder).all<Delivery>();

    const results = await Promise.all(deliveries.results.map(async (delivery) => ({
      delivery,
      result: await deliverWebPush(config, delivery.endpoint, {
        p256dh: delivery.p256dh, auth: delivery.auth,
      }, { title: "Deltatime", body: reminder.body }, { topic: "reminder-" + id, ttl: 300 }),
    })));

    const updates = results.flatMap(({ delivery, result }) => {
      const status = result === "retry" && delivery.attempts + 1 < maxAttemptsPerDevice
        ? "pending" : result === "accepted" ? "accepted" : "failed";
      const statements = [db.prepare(`
        UPDATE push_reminder_deliveries SET status = ?, attempts = attempts + 1 WHERE id = ?
      `).bind(status, delivery.id)];
      if (result === "expired") {
        statements.push(db.prepare(`
          DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ? AND p256dh = ? AND auth = ?
        `).bind(delivery.endpoint, reminder.user_id, delivery.p256dh, delivery.auth));
      }
      return statements;
    });
    if (updates.length) await db.batch(updates);

    const counts = await db.prepare(`
      SELECT COUNT(CASE WHEN status = 'pending' AND endpoint IS NOT NULL THEN 1 END) AS pending,
             COUNT(CASE WHEN status = 'accepted' THEN 1 END) AS accepted
      FROM push_reminder_deliveries WHERE reminder_id = ?
    `).bind(id).first<{ pending: number; accepted: number }>();
    const status = counts?.pending ? "sending" : counts?.accepted ? "sent" : "failed";
    await db.prepare(`
      UPDATE reminders SET status = ?, locked_until = ?, sent_at = ?, updated_at = ?
      WHERE id = ? AND status = 'sending' AND attempts = ?
    `).bind(
      status, status === "sending" ? now + retrySeconds : null,
      status === "sent" ? now : null, now, id, reminder.attempts,
    ).run();
    console.log("[Deltatime scheduler] Reminder", id, status, "accepted devices:", counts?.accepted ?? 0);
  }
}

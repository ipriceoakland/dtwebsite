type SchedulerEnv = Env & { SIMULATE_SMS?: string };

export default {
	async scheduled(controller, env): Promise<void> {
		if (env.SIMULATE_SMS !== "true") return;

		const now = Math.floor(controller.scheduledTime / 1000);
		const db = env.deltatime_dev;

		const due = await db
			.prepare(
				`SELECT id FROM reminders
				 WHERE status = 'pending' AND remind_at <= ?
				 ORDER BY remind_at, id
				 LIMIT 10`,
			)
			.bind(now)
			.all<{ id: number }>();

		let processed = 0;
		for (const { id } of due.results) {
			const [attempt] = await db.batch([
				db.prepare(
					`INSERT INTO delivery_attempts
						(reminder_id, attempt_no, status, attempted_at)
					 SELECT id, attempts + 1, 'sent', ?
					 FROM reminders
					 WHERE id = ? AND status = 'pending' AND remind_at <= ?`,
				).bind(now, id, now),
				db.prepare(
					`UPDATE reminders
					 SET status = 'sent', attempts = attempts + 1,
					     sent_at = ?, updated_at = ?, locked_until = NULL
					 WHERE id = ? AND status = 'pending' AND remind_at <= ?`,
				).bind(now, now, id, now),
			]);

			processed += attempt.meta.changes;
		}

		console.log(`Deltatime scheduler: simulated ${processed} deliveries`);
	},
} satisfies ExportedHandler<SchedulerEnv>;
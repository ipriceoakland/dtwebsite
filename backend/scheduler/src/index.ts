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
	const claim = await db
		.prepare(
			`UPDATE reminders
			 SET status = 'sending',
			     attempts = attempts + 1,
			     updated_at = ?,
			     locked_until = ?
			 WHERE id = ? AND status = 'pending' AND remind_at <= ?
			 RETURNING attempts`,
		)
		.bind(now, now + 300, id, now)
		.first<{ attempts: number }>();

	if (!claim) continue;

	const [attempt] = await db.batch([
		db.prepare(
			`INSERT INTO delivery_attempts
				(reminder_id, attempt_no, status, attempted_at)
			 SELECT id, attempts, 'sent', ?
			 FROM reminders
			 WHERE id = ? AND status = 'sending' AND attempts = ?`,
		).bind(now, id, claim.attempts),
		db.prepare(
			`UPDATE reminders
			 SET status = 'sent', sent_at = ?, updated_at = ?,
			     locked_until = NULL
			 WHERE id = ? AND status = 'sending' AND attempts = ?`,
		).bind(now, now, id, claim.attempts),
	]);

	processed += attempt.meta.changes;
}

		console.log(`Deltatime scheduler: simulated ${processed} deliveries`);
	},
} satisfies ExportedHandler<SchedulerEnv>;
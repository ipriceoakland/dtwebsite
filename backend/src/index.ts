import { getSessionUserId, handleAuthRequest, type AuthEnv } from "./auth";

export default {
	async fetch(request, env): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (path.startsWith("/api/auth/")) {
			return handleAuthRequest(request, env, path);
		}
			if (path === "/sms/inbound" && request.method === "POST") {
				if (env.LOCAL_SMS_TEST !== "true") {
			return new Response("Not found", { status: 404 });
		}
		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			return Response.json({ error: "Expected form data" }, { status: 400 });
		}

		const from = form.get("From");
		const body = form.get("Body");
		const messageSid = form.get("MessageSid");

		if (
			typeof from !== "string" || !from.trim() ||
			typeof body !== "string" || !body.trim() ||
			typeof messageSid !== "string" || !messageSid.trim()
		) {
			return Response.json(
				{ error: "From, Body, and MessageSid are required" },
				{ status: 400 },
			);
		}

		const match = /^remind me in (\d{1,4}) minutes? to (.+)$/i.exec(body.trim());
		const minutes = match ? Number(match[1]) : 0;

		if (!match || minutes < 1 || minutes > 1440) {
			return Response.json(
				{ error: "Try: Remind me in 2 minutes to study" },
				{ status: 400 },
			);
		}

		const db = env.deltatime_dev;
		const sender = from.trim();
		const sid = messageSid.trim();
		const task = match[2].trim();
		const now = Math.floor(Date.now() / 1000);
		const remindAt = now + minutes * 60;

		if (task.length > 320) {
			return Response.json({ error: "Task is too long" }, { status: 400 });
		}

		const user = await db
			.prepare("SELECT id FROM users WHERE phone_e164 = ?")
			.bind(sender)
			.first<{ id: number }>();

		if (!user) {
			return Response.json({ error: "Unknown test sender" }, { status: 404 });
		}

		const [, inserted, saved] = await db.batch([
			db.prepare(
				`INSERT INTO inbound_messages
					(message_sid, user_id, body, intent, parsed_json, reply_text, received_at)
				VALUES (?, ?, ?, 'create', ?, 'Reminder saved', ?)
				ON CONFLICT(message_sid) DO NOTHING`,
			).bind(sid, user.id, body, JSON.stringify({ task, remind_at: remindAt }), now),

			db.prepare(
				`INSERT INTO reminders (user_id, source_message_sid, body, remind_at)
				SELECT user_id, message_sid,
						json_extract(parsed_json, '$.task'),
						json_extract(parsed_json, '$.remind_at')
				FROM inbound_messages
				WHERE message_sid = ? AND user_id = ? AND intent = 'create'
				ON CONFLICT(source_message_sid) DO NOTHING`,
			).bind(sid, user.id),

			db.prepare(
				`SELECT id, body, remind_at, status FROM reminders
				WHERE source_message_sid = ? AND user_id = ?`,
			).bind(sid, user.id),
		]);

		const reminder = saved.results[0];
		if (!reminder) {
			return Response.json({ error: "Message ID already in use" }, { status: 409 });
		}

		const created = inserted.meta.changes === 1;
		return Response.json({ reminder, duplicate: !created }, { status: created ? 201 : 200 });
		}
		if (path === "/") {
			return new Response("Deltatime API is running");
		}

		if (path === "/health") {
			try {
				await env.deltatime_dev
					.prepare("SELECT COUNT(*) AS total FROM reminders")
					.first();

				return Response.json({
					status: "ok",
					database: "connected",
				});
			} catch {
				return Response.json(
					{ status: "error", database: "unavailable" },
					{ status: 503 },
				);
			}
		}
		const reminderMatch = path.match(/^\/api\/reminders\/([0-9]+)$/);
		if ((path === "/api/reminders" || reminderMatch) && ["POST", "PATCH", "DELETE"].includes(request.method)) {
			const origin = request.headers.get("Origin");
			const appOrigin = URL.parse(env.GOOGLE_REDIRECT_URI ?? "")?.origin ?? new URL(request.url).origin;
			if (origin && origin !== appOrigin) {
				return Response.json({ error: "Forbidden" }, { status: 403 });
			}
		}

if (reminderMatch) {
	const reminderId = Number(reminderMatch[1]);

	if (!Number.isSafeInteger(reminderId) || reminderId < 1) {
		return Response.json({ error: "Invalid reminder ID" }, { status: 400 });
	}

	if (request.method !== "PATCH" && request.method !== "DELETE") {
		return Response.json(
			{ error: "Method not allowed" },
			{ status: 405, headers: { Allow: "PATCH, DELETE" } },
		);
	}

	try {
		const userId = await getSessionUserId(request, env.deltatime_dev);

		if (userId === null) {
			return Response.json(
				{ error: "Sign in required" },
				{ status: 401 },
			);
		}

		if (request.method === "DELETE") {
			const reminder = await env.deltatime_dev
				.prepare(
					`UPDATE reminders
					 SET status = 'cancelled', updated_at = unixepoch()
					 WHERE id = ? AND user_id = ? AND status = 'pending'
					 RETURNING id, body, remind_at, recurrence, status`,
				)
				.bind(reminderId, userId)
				.first();

			if (!reminder) {
				return Response.json(
					{ error: "Pending reminder not found" },
					{ status: 404 },
				);
			}

			return Response.json({ reminder });
		}

		let input: unknown;
		try {
			input = await request.json();
		} catch {
			return Response.json({ error: "Invalid JSON" }, { status: 400 });
		}

		if (
			typeof input !== "object" ||
			input === null ||
			Array.isArray(input)
		) {
			return Response.json(
				{ error: "Expected a reminder object" },
				{ status: 400 },
			);
		}

		const data = input as Record<string, unknown>;
		const hasBody = Object.hasOwn(data, "body");
		const hasTime = Object.hasOwn(data, "remind_at");

		if (!hasBody && !hasTime) {
			return Response.json(
				{ error: "Provide body or remind_at" },
				{ status: 400 },
			);
		}

		let body: string | null = null;
		if (hasBody) {
			if (typeof data.body !== "string") {
				return Response.json(
					{ error: "Description must be text" },
					{ status: 400 },
				);
			}
			body = data.body.trim();
			if (body.length < 1 || body.length > 320) {
				return Response.json(
					{ error: "Description must be 1–320 characters" },
					{ status: 400 },
				);
			}
		}

		let remindAt: number | null = null;
		if (hasTime) {
			if (
				typeof data.remind_at !== "number" ||
				!Number.isSafeInteger(data.remind_at) ||
				data.remind_at <= Math.floor(Date.now() / 1000)
			) {
				return Response.json(
					{ error: "remind_at must be a future UTC Unix timestamp in seconds" },
					{ status: 400 },
				);
			}
			remindAt = data.remind_at;
		}

		const reminder = await env.deltatime_dev
			.prepare(
				`UPDATE reminders
				 SET body = COALESCE(?, body),
				     remind_at = COALESCE(?, remind_at),
				     updated_at = unixepoch()
				 WHERE id = ? AND user_id = ? AND status = 'pending'
				 RETURNING id, body, remind_at, recurrence, status`,
			)
			.bind(body, remindAt, reminderId, userId)
			.first();

		if (!reminder) {
			return Response.json(
				{ error: "Pending reminder not found" },
				{ status: 404 },
			);
		}

		return Response.json({ reminder });
	} catch {
		return Response.json(
			{ error: "Unable to update reminder" },
			{ status: 500 },
		);
	}
}
		if (path === "/api/reminders" && request.method === "POST") {
	try {
		const userId = await getSessionUserId(
			request,
			env.deltatime_dev,
		);

		if (userId === null) {
			return Response.json(
				{ error: "Sign in required" },
				{ status: 401 },
			);
		}

		let input: unknown;
		try {
			input = await request.json();
		} catch {
			return Response.json(
				{ error: "Invalid JSON" },
				{ status: 400 },
			);
		}

		if (typeof input !== "object" || input === null) {
			return Response.json(
				{ error: "Expected a reminder object" },
				{ status: 400 },
			);
		}

		const data = input as Record<string, unknown>;
		const body =
			typeof data.body === "string" ? data.body.trim() : "";
		const remindAt = data.remind_at;

		if (body.length < 1 || body.length > 320) {
			return Response.json(
				{ error: "Description must be 1–320 characters" },
				{ status: 400 },
			);
		}

		if (
			typeof remindAt !== "number" ||
			!Number.isSafeInteger(remindAt) ||
			remindAt <= Math.floor(Date.now() / 1000)
		) {
			return Response.json(
				{ error: "remind_at must be a future UTC Unix timestamp in seconds" },
				{ status: 400 },
			);
		}

		const reminder = await env.deltatime_dev
			.prepare(
				`INSERT INTO reminders (user_id, body, remind_at)
				 VALUES (?, ?, ?)
				 RETURNING id, body, remind_at, recurrence, status`,
			)
			.bind(userId, body, remindAt)
			.first();

		return Response.json(
			{ reminder },
			{ status: 201 },
		);
	} catch {
		return Response.json(
			{ error: "Unable to create reminder" },
			{ status: 500 },
		);
	}
}
		if (path === "/api/reminders") {
			if (request.method !== "GET") {
				return Response.json(
					{ error: "Method not allowed" },
					{ status: 405, headers: { Allow: "GET" } },
				);
			}

			try {
				const userId = await getSessionUserId(
					request,
					env.deltatime_dev,
				);

				if (userId === null) {
					return Response.json(
						{ error: "Sign in required" },
						{ status: 401 },
					);
				}

				const rows = await env.deltatime_dev
					.prepare(
						`SELECT id, body, remind_at, recurrence, status
						 FROM reminders
						 WHERE user_id = ?
						 ORDER BY remind_at`,
					)
					.bind(userId)
					.all();

				return Response.json({ reminders: rows.results }, { headers: { "Cache-Control": "no-store" } });
			} catch {
				return Response.json(
					{ error: "Unable to load reminders" },
					{ status: 500 },
				);
			}
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<AuthEnv & { LOCAL_SMS_TEST?: string }>;

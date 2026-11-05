async function getSessionUserId(
	request: Request,
	db: D1Database,
): Promise<number | null> {
	const cookie = request.headers.get("Cookie") ?? "";
	const match = cookie.match(/(?:^|;\s*)dt_session=([A-Za-z0-9_-]{32,})/);

	if (!match) return null;

	const tokenBytes = new TextEncoder().encode(match[1]);
	const hashBytes = await crypto.subtle.digest("SHA-256", tokenBytes);
	const tokenHash = Array.from(new Uint8Array(hashBytes))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

	const session = await db
		.prepare(
			"SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?",
		)
		.bind(tokenHash, Math.floor(Date.now() / 1000))
		.first<{ user_id: number }>();

	return session?.user_id ?? null;
}

export default {
	async fetch(request, env): Promise<Response> {
		const path = new URL(request.url).pathname;

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

				return Response.json({ reminders: rows.results });
			} catch {
				return Response.json(
					{ error: "Unable to load reminders" },
					{ status: 500 },
				);
			}
		}

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
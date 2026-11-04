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

		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler<Env>;
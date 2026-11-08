export type AuthEnv = Env & {
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
	GOOGLE_REDIRECT_URI?: string;
};

const sessionCookie = "dt_session";
const oauthCookie = "dt_google_flow";
const sessionLifetime = 7 * 24 * 60 * 60;

function base64Url(bytes: Uint8Array): string {
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(): string {
	return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function sha256(value: string): Promise<Uint8Array> {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function hashSessionToken(token: string): Promise<string> {
	return Array.from(await sha256(token), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readCookie(request: Request, name: string): string | undefined {
	return request.headers.get("Cookie")?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`))?.[1];
}

function readSessionToken(request: Request): string | undefined {
	const token = readCookie(request, sessionCookie);
	return token && /^[A-Za-z0-9_-]{32,}$/.test(token) ? token : undefined;
}

function cookie(name: string, value: string, maxAge: number, redirect: URL): string {
	const secure = redirect.protocol === "https:" ? "; Secure" : "";
	return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function getSessionUser(request: Request, db: D1Database) {
	const token = readSessionToken(request);
	if (!token) return null;

	return db.prepare(
		`SELECT users.id, users.display_name
		FROM sessions JOIN users ON users.id = sessions.user_id
		WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
	).bind(await hashSessionToken(token), Math.floor(Date.now() / 1000))
		.first<{ id: number; display_name: string | null }>();
}

export async function getSessionUserId(request: Request, db: D1Database): Promise<number | null> {
	return (await getSessionUser(request, db))?.id ?? null;
}

function getGoogleConfig(env: AuthEnv) {
	const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REDIRECT_URI: uri } = env;
	if (!clientId || !clientSecret || !uri) return null;

	const redirect = URL.parse(uri);
	if (
		!redirect || redirect.username || redirect.password || redirect.search || redirect.hash ||
		redirect.pathname !== "/api/auth/google/callback" ||
		(redirect.protocol !== "https:" && !(redirect.protocol === "http:" && redirect.hostname === "localhost"))
	) return null;

	return { clientId, clientSecret, redirect };
}

type GoogleConfig = NonNullable<ReturnType<typeof getGoogleConfig>>;

function redirectWithCookies(location: URL, cookies: string[]): Response {
	const headers = new Headers({ Location: location.href, "Cache-Control": "no-store" });
	for (const value of cookies) headers.append("Set-Cookie", value);
	return new Response(null, { status: 303, headers });
}

async function startGoogleSignIn(config: GoogleConfig): Promise<Response> {
	const state = randomToken();
	const verifier = randomToken();
	const nonce = randomToken();
	const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
	authorization.search = new URLSearchParams({
		client_id: config.clientId,
		redirect_uri: config.redirect.href,
		response_type: "code",
		scope: "openid profile",
		state,
		nonce,
		code_challenge: base64Url(await sha256(verifier)),
		code_challenge_method: "S256",
		prompt: "select_account",
	}).toString();
	return redirectWithCookies(authorization, [
		cookie(oauthCookie, `${state}.${verifier}.${nonce}`, 600, config.redirect),
	]);
}

async function finishGoogleSignIn(request: Request, db: D1Database, config: GoogleConfig): Promise<Response> {
	const params = new URL(request.url).searchParams;
	const code = params.get("code");
	const flow = readCookie(request, oauthCookie);
	const [state, verifier, nonce] = flow?.split(".") ?? [];
	const clearFlow = cookie(oauthCookie, "", 0, config.redirect);
	const failed = (reason: string) => {
		console.warn(`[Deltatime auth] ${reason}`);
		return redirectWithCookies(new URL("/?signin=failed", config.redirect), [clearFlow]);
	};
	if (params.get("error") === "access_denied") return failed("Google sign-in was declined (access_denied).");
	if (!code) return failed("Google callback did not contain an authorization code.");
	if (!flow) return failed("Browser did not return the sign-in cookie. Start again from the registered localhost URL.");
	if (!state || state !== params.get("state") || !verifier || !nonce) {
		return failed("Sign-in state did not match. Start a new attempt in one tab.");
	}

	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		redirect: "manual",
		body: new URLSearchParams({
			code,
			client_id: config.clientId,
			client_secret: config.clientSecret,
			redirect_uri: config.redirect.href,
			code_verifier: verifier,
			grant_type: "authorization_code",
		}),
	}).catch(() => null);
	if (!response) return failed("Could not reach Google's token endpoint.");
	if (!response.ok) {
		const body = await response.json<{ error?: string }>().catch(() => null);
		const allowedErrors = ["invalid_client", "invalid_grant", "invalid_request", "unauthorized_client", "redirect_uri_mismatch"];
		const error = body?.error && allowedErrors.includes(body.error) ? body.error : "unknown_error";
		return failed(`Google token exchange returned HTTP ${response.status} (${error}).`);
	}

	// Google returns this ID token directly to the Worker over HTTPS.
	const body = await response.json<{ id_token?: string }>().catch(() => null);
	const payload = typeof body?.id_token === "string" ? body.id_token.split(".")[1] : undefined;
	if (!payload) return failed("Google's token response did not contain an ID token.");
	let claims: { iss?: string; aud?: string; nonce?: string; exp?: number; sub?: string; name?: string };
	try {
		const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
		claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(decoded, (byte) => byte.charCodeAt(0))));
	} catch {
		return failed("Could not decode Google's ID token.");
	}
	const now = Math.floor(Date.now() / 1000);
	if (claims?.nonce !== nonce) return failed("Google's ID token nonce did not match the sign-in attempt.");
	if (
		(claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") ||
		claims.aud !== config.clientId ||
		typeof claims.exp !== "number" || !Number.isFinite(claims.exp) || claims.exp <= now ||
		typeof claims.sub !== "string" || !claims.sub
	) return failed("Google's ID token failed issuer, audience, expiry, or account ID validation.");

	const token = randomToken();
	const displayName = typeof claims.name === "string" ? claims.name : null;
	try {
		await db.batch([
			db.prepare(
				`INSERT INTO users (google_subject, display_name) VALUES (?, ?)
				ON CONFLICT(google_subject) DO NOTHING`,
			).bind(claims.sub, displayName),
			db.prepare(
				`INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
				SELECT ?, id, ?, ? FROM users WHERE google_subject = ?`,
			).bind(await hashSessionToken(token), now, now + sessionLifetime, claims.sub),
		]);
	} catch (error) {
		if (error instanceof Error && /no such column: google_subject|no column named google_subject/.test(error.message)) {
			return failed("Local D1 is missing the Google identity migration.");
		}
		return failed("Could not save the Google account or session in D1.");
	}

	return redirectWithCookies(new URL("/calendar", config.redirect), [
		clearFlow,
		cookie(sessionCookie, token, sessionLifetime, config.redirect),
	]);
}

export async function handleAuthRequest(request: Request, env: AuthEnv, path: string): Promise<Response> {
	const routes = new Map([
		["/api/auth/session", "GET"],
		["/api/auth/google", "GET"],
		["/api/auth/google/callback", "GET"],
		["/api/auth/signout", "POST"],
	]);
	const method = routes.get(path);
	if (!method) return new Response("Not found", { status: 404 });
	if (request.method !== method) {
		return new Response("Method not allowed", { status: 405, headers: { Allow: method } });
	}

	const db = env.deltatime_dev;
	if (path === "/api/auth/session") {
		try {
			const user = await getSessionUser(request, db);
			return Response.json({ user }, { headers: { "Cache-Control": "no-store" } });
		} catch {
			return new Response("Unable to load session", { status: 503, headers: { "Cache-Control": "no-store" } });
		}
	}

	const config = getGoogleConfig(env);
	if (!config) return new Response("Google sign-in is not configured", { status: 503 });

	if (path === "/api/auth/google") return startGoogleSignIn(config);
	if (path === "/api/auth/google/callback") {
		try {
			return await finishGoogleSignIn(request, db, config);
		} catch {
			console.warn("[Deltatime auth] Unexpected error while completing the Google callback.");
			return redirectWithCookies(new URL("/?signin=failed", config.redirect), [
				cookie(oauthCookie, "", 0, config.redirect),
			]);
		}
	}

	if (request.headers.get("Origin") !== config.redirect.origin) {
		return new Response("Forbidden", { status: 403 });
	}
	const token = readSessionToken(request);
	if (token) {
		await db.prepare("DELETE FROM sessions WHERE token_hash = ?")
			.bind(await hashSessionToken(token)).run();
	}
	return redirectWithCookies(new URL("/", config.redirect), [cookie(sessionCookie, "", 0, config.redirect)]);
}

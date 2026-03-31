// Server-side Cline OAuth flow for remote users.
//
// Uses loginClineOAuth (same SDK function as MCP OAuth) with a temporary HTTP
// server on a free port. No vscode:// trigger. No popup.
//
// Flow:
//   1. GET /auth/start  → startClineOAuth() → 302 browser to WorkOS
//   2. User authenticates
//   3. Cline backend → browser → http://localhost:<freePort>/kanban/auth/callback?code=
//   4. SDK temp server handles callback, resolves credentials
//   5. We store identity in pendingTokens map, keyed by a one-time token
//   6. SDK temp server HTML (la0, patched at build time) redirects browser to
//      /auth/finalize?t=<token> on Kanban's main server
//   7. GET /auth/finalize  → consumePendingToken → set session cookie → 302 to /

import { randomBytes } from "node:crypto";
import { loginClineOAuth } from "../cline-sdk/sdk-provider-boundary";
import { getKanbanRuntimeOrigin } from "../core/runtime-endpoint";
import type { RemoteAuth } from "./remote-auth";

const CALLBACK_PORTS = [34840, 34841, 34842, 34843, 34844, 34845, 34846, 34847, 34848, 34849];
const CALLBACK_PATH = "/kanban/auth/callback";
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

// ── Pending token store ───────────────────────────────────────────────────

interface PendingToken {
	email: string;
	userId: string | null;
	displayName: string | null;
	expiresAt: number;
}

const pendingTokens = new Map<string, PendingToken>();

function storePendingToken(data: Omit<PendingToken, "expiresAt">): string {
	const token = randomBytes(24).toString("base64url");
	// Clean expired entries.
	for (const [k, v] of pendingTokens.entries()) {
		if (v.expiresAt < Date.now()) pendingTokens.delete(k);
	}
	pendingTokens.set(token, { ...data, expiresAt: Date.now() + 60_000 });
	return token;
}

export function consumePendingToken(token: string): Omit<PendingToken, "expiresAt"> | null {
	const entry = pendingTokens.get(token);
	if (!entry) return null;
	pendingTokens.delete(token);
	if (entry.expiresAt < Date.now()) return null;
	return { email: entry.email, userId: entry.userId, displayName: entry.displayName };
}

// ── SDK la0 patch ─────────────────────────────────────────────────────────
// The SDK's temp callback server responds with la0 HTML.
// We patched la0 at build time to redirect to "/".
// But we need it to redirect to /auth/finalize?t=<token>.
// Since la0 is a module-level constant we can't change per-call, we use a
// different approach: la0 redirects to "/" and we expose GET /auth/pending
// which the frontend polls after being redirected to "/".
//
// Actually — we patch la0 to redirect to a FIXED path: /auth/finalize
// Then GET /auth/finalize?t=<last-token> where the token is the most recent
// pending one. This works because only one OAuth flow runs at a time.
//
// The Dockerfile already patches la0 to redirect to "/". We instead patch it
// to redirect to "/auth/finalize" and append the token via a global variable
// we set just before the temp server fires.

let currentPendingToken: string | null = null;

export function getCurrentPendingToken(): string | null {
	return currentPendingToken;
}

// ── Main OAuth initiator ──────────────────────────────────────────────────

export async function startClineOAuth(remoteAuth: RemoteAuth): Promise<string> {
	let resolveUrl!: (url: string) => void;
	let rejectUrl!: (err: unknown) => void;

	const urlPromise = new Promise<string>((res, rej) => {
		resolveUrl = res;
		rejectUrl = rej;
	});

	loginClineOAuth({
		apiBaseUrl: "https://api.cline.bot",
		callbackPorts: CALLBACK_PORTS,
		callbackPath: CALLBACK_PATH,
		// Note: timeoutMs is not in the public type but is passed through to SZ internally.
		// We cast to any to pass it through since TypeScript doesn't know about it.
		...({ timeoutMs: OAUTH_TIMEOUT_MS } as Record<string, unknown>),
		callbacks: {
			onAuth: ({ url }: { url: string }) => resolveUrl(url),
			onProgress: () => {
				/* no-op */
			},
			onPrompt: async () => {
				// onPrompt fires when the SDK wants the user to paste a code manually.
				// In our flow this means the callback server timed out.
				// Reject the URL promise and return empty string to unblock the SDK.
				rejectUrl(new Error("Authentication timed out. Please try again."));
				return "";
			},
		},
	})
		.then(async (credentials: unknown) => {
			const raw = credentials as { email?: string; accountId?: string };
			const email = raw.email?.trim() ?? "";
			const accountId = raw.accountId ?? null;
			const resolvedEmail = email || (accountId ? `${accountId}@cline` : "unknown@cline");
			const displayName = resolvedEmail.split("@")[0] ?? resolvedEmail;
			const userRecord = remoteAuth.getOrCreateUserRecord(resolvedEmail, displayName);
			const token = storePendingToken({
				email: resolvedEmail,
				userId: accountId,
				displayName: userRecord.displayName,
			});
			currentPendingToken = token;
		})
		.catch((err: unknown) => {
			rejectUrl(err);
		});

	return Promise.race([
		urlPromise,
		new Promise<never>((_, rej) =>
			setTimeout(() => rej(new Error("OAuth server failed to start. Is the port range available?")), 10_000),
		),
	]);
}

// patchSdkSuccessHtml is no longer needed — the la0 HTML is patched at
// build time (in the Dockerfile or locally via the npm postinstall script)
// to redirect to /auth/finalize. This export is kept as a no-op for now.
export function patchSdkSuccessHtml(_kanbanOrigin: string): void {
	// No-op. Patching happens at build time.
}

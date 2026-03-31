import type { RuntimeAppRouter } from "@runtime-trpc";
import { createTRPCProxyClient, httpBatchLink, TRPCClientError } from "@trpc/client";

// Custom fetch wrapper that dispatches "kanban:unauthorized" when the server
// returns HTTP 401. useAuthGate listens for this event and flips the app
// to the login screen without requiring a full page reload.
const unauthorizedAwareFetch: typeof fetch = async (input, init) => {
	const response = await fetch(input, init);
	if (response.status === 401) {
		window.dispatchEvent(new CustomEvent("kanban:unauthorized"));
	}
	return response;
};

interface TrpcErrorDataWithConflictRevision {
	code?: string;
	conflictRevision?: number | null;
}

type RuntimeTrpcClient = ReturnType<typeof createTRPCProxyClient<RuntimeAppRouter>>;

const clientByWorkspaceId = new Map<string, RuntimeTrpcClient>();

export function getRuntimeTrpcClient(workspaceId: string | null): RuntimeTrpcClient {
	const key = workspaceId ?? "__unscoped__";
	const existing = clientByWorkspaceId.get(key);
	if (existing) {
		return existing;
	}
	const created = createTRPCProxyClient<RuntimeAppRouter>({
		links: [
			httpBatchLink({
				url: "/api/trpc",
				headers: () => (workspaceId ? { "x-kanban-workspace-id": workspaceId } : {}),
				fetch: unauthorizedAwareFetch,
			}),
		],
	});
	clientByWorkspaceId.set(key, created);
	return created;
}

export function createWorkspaceTrpcClient(workspaceId: string): RuntimeTrpcClient {
	return getRuntimeTrpcClient(workspaceId);
}

function readTrpcErrorData(error: TRPCClientError<RuntimeAppRouter>): TrpcErrorDataWithConflictRevision | null {
	const data = error.data as TrpcErrorDataWithConflictRevision | undefined;
	if (!data || typeof data !== "object") {
		return null;
	}
	return data;
}

export function readTrpcConflictRevision(error: unknown): number | null {
	if (!(error instanceof TRPCClientError)) {
		return null;
	}
	const data = readTrpcErrorData(error);
	if (data?.code !== "CONFLICT") {
		return null;
	}
	return typeof data.conflictRevision === "number" ? data.conflictRevision : null;
}

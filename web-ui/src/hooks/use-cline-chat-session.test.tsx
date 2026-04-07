import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type ClineChatMessage, useClineChatSession } from "@/hooks/use-cline-chat-session";
import type { RuntimeTaskImage, RuntimeTaskSessionMode } from "@/runtime/types";

interface HookSnapshot {
	messageIds: string[];
	lastMessageContent: string | null;
	lastMessageHookEvent: string | null;
	error: string | null;
	isSending: boolean;
	sendMessage: (
		text: string,
		options?: { mode?: RuntimeTaskSessionMode; images?: RuntimeTaskImage[] },
	) => Promise<boolean>;
}

function createDeferred<T>() {
	let resolve: (value: T) => void = () => {};
	let reject: (error: unknown) => void = () => {};
	const promise = new Promise<T>((nextResolve, nextReject) => {
		resolve = nextResolve;
		reject = nextReject;
	});
	return {
		promise,
		resolve,
		reject,
	};
}

function HookHarness({
	taskId,
	onSendMessage,
	onLoadMessages,
	incomingMessage,
	incomingMessages,
	onSnapshot,
}: {
	taskId: string;
	onSendMessage?: (
		taskId: string,
		text: string,
		options?: { mode?: RuntimeTaskSessionMode; images?: RuntimeTaskImage[] },
	) => Promise<{ ok: boolean; message?: string; chatMessage?: ClineChatMessage | null }>;
	onLoadMessages?: (taskId: string) => Promise<ClineChatMessage[] | null>;
	incomingMessage?: ClineChatMessage | null;
	incomingMessages?: ClineChatMessage[] | null;
	onSnapshot: (snapshot: HookSnapshot) => void;
}): null {
	const state = useClineChatSession({
		taskId,
		onSendMessage,
		onLoadMessages,
		incomingMessage,
		incomingMessages,
	});

	useEffect(() => {
		const lastMessage = state.messages.at(-1);
		onSnapshot({
			messageIds: state.messages.map((message) => message.id),
			lastMessageContent: lastMessage?.content ?? null,
			lastMessageHookEvent: lastMessage?.meta?.hookEventName ?? null,
			error: state.error,
			isSending: state.isSending,
			sendMessage: state.sendMessage,
		});
	}, [onSnapshot, state.error, state.isSending, state.messages, state.sendMessage]);

	return null;
}

describe("useClineChatSession", () => {
	let container: HTMLDivElement;
	let root: Root;
	let previousActEnvironment: boolean | undefined;

	beforeEach(() => {
		previousActEnvironment = (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
			.IS_REACT_ACT_ENVIRONMENT;
		(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
		container = document.createElement("div");
		document.body.appendChild(container);
		root = createRoot(container);
	});

	afterEach(() => {
		act(() => {
			root.unmount();
		});
		container.remove();
		if (previousActEnvironment === undefined) {
			delete (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
		} else {
			(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
				previousActEnvironment;
		}
	});

	it("appends incoming stream messages and updates existing messages by id", async () => {
		const initialMessage: ClineChatMessage = {
			id: "initial",
			role: "assistant",
			content: "Initial response",
			createdAt: 1,
		};
		const streamedMessage: ClineChatMessage = {
			id: "streamed",
			role: "assistant",
			content: "Stream update",
			createdAt: 2,
		};
		const onLoadMessages = vi.fn(async () => [initialMessage]);
		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onLoadMessages={onLoadMessages}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)?.messageIds).toEqual(["initial"]);

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onLoadMessages={onLoadMessages}
					incomingMessage={streamedMessage}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)?.messageIds).toEqual(["initial", "streamed"]);
		expect(snapshots.at(-1)?.lastMessageContent).toBe("Stream update");

		const streamedMessageUpdate: ClineChatMessage = {
			...streamedMessage,
			content: "Stream update (continued)",
		};

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onLoadMessages={onLoadMessages}
					incomingMessage={streamedMessageUpdate}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)?.messageIds).toEqual(["initial", "streamed"]);
		expect(snapshots.at(-1)?.lastMessageContent).toBe("Stream update (continued)");
	});

	it("updates existing message when only meta changes", async () => {
		const toolStart: ClineChatMessage = {
			id: "tool-1",
			role: "tool",
			content: "Tool: Read",
			createdAt: 2,
			meta: {
				hookEventName: "tool_call_start",
				toolName: "Read",
				toolCallId: "call-1",
				streamType: "tool",
			},
		};
		const onLoadMessages = vi.fn(async () => [toolStart]);
		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onLoadMessages={onLoadMessages}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)?.lastMessageHookEvent).toBe("tool_call_start");

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onLoadMessages={onLoadMessages}
					incomingMessage={{
						...toolStart,
						meta: {
							...toolStart.meta,
							hookEventName: "tool_call_end",
						},
					}}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)?.messageIds).toEqual(["tool-1"]);
		expect(snapshots.at(-1)?.lastMessageHookEvent).toBe("tool_call_end");
	});

	it("appends the returned chat message after send without reloading history", async () => {
		const onLoadMessages = vi.fn(async () => []);
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: {
				id: "sent-1",
				role: "user" as const,
				content: "Hello",
				createdAt: 3,
			},
		}));
		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onSendMessage={onSendMessage}
					onLoadMessages={onLoadMessages}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			await snapshots.at(-1)?.sendMessage("Hello", { mode: "plan" });
		});

		expect(snapshots.at(-1)?.messageIds).toEqual(["sent-1"]);
		expect(snapshots.at(-1)?.lastMessageContent).toBe("Hello");
		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Hello", { mode: "plan" });
		expect(onLoadMessages).toHaveBeenCalledTimes(1);
	});

	it("forwards attached images through the send callback", async () => {
		const onLoadMessages = vi.fn(async () => []);
		const onSendMessage = vi.fn(async () => ({ ok: true }));
		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onSendMessage={onSendMessage}
					onLoadMessages={onLoadMessages}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			await snapshots.at(-1)?.sendMessage("Hello", {
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
			});
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "Hello", {
			images: [
				{
					id: "img-1",
					data: "abc123",
					mimeType: "image/png",
				},
			],
		});
	});

	it("allows image-only messages through the send callback", async () => {
		const onLoadMessages = vi.fn(async () => []);
		const onSendMessage = vi.fn(async () => ({ ok: true }));
		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onSendMessage={onSendMessage}
					onLoadMessages={onLoadMessages}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			await snapshots.at(-1)?.sendMessage("   ", {
				images: [
					{
						id: "img-1",
						data: "abc123",
						mimeType: "image/png",
					},
				],
			});
		});

		expect(onSendMessage).toHaveBeenCalledWith("task-1", "", {
			images: [
				{
					id: "img-1",
					data: "abc123",
					mimeType: "image/png",
				},
			],
		});
	});

	it("merges late-loaded history with streamed messages that arrived first", async () => {
		const deferredLoad = createDeferred<ClineChatMessage[] | null>();
		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onLoadMessages={() => deferredLoad.promise}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onLoadMessages={() => deferredLoad.promise}
					incomingMessage={{
						id: "streamed-1",
						role: "assistant",
						content: "Streaming first",
						createdAt: 2,
					}}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)?.messageIds).toEqual(["streamed-1"]);

		await act(async () => {
			deferredLoad.resolve([
				{
					id: "loaded-1",
					role: "assistant",
					content: "Loaded history",
					createdAt: 1,
				},
			]);
			await deferredLoad.promise;
			await Promise.resolve();
		});

		expect(snapshots.at(-1)?.messageIds).toEqual(["loaded-1", "streamed-1"]);
		expect(snapshots.at(-1)?.lastMessageContent).toBe("Streaming first");
	});

	it("clears messages after a /clear send returns null chatMessage", async () => {
		const existingMessages: ClineChatMessage[] = [
			{
				id: "msg-1",
				role: "user",
				content: "Hello",
				createdAt: 1,
			},
			{
				id: "msg-2",
				role: "assistant",
				content: "Hi there",
				createdAt: 2,
			},
		];

		// The first call loads existing messages; subsequent calls (after clear) return [].
		const onLoadMessages = vi.fn<(taskId: string) => Promise<ClineChatMessage[] | null>>().mockResolvedValueOnce(existingMessages).mockResolvedValue([]);

		// Simulate the /clear response: ok but no chatMessage.
		const onSendMessage = vi.fn(async () => ({
			ok: true,
			chatMessage: null as ClineChatMessage | null,
		}));

		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onSendMessage={onSendMessage}
					onLoadMessages={onLoadMessages}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		// Verify existing messages are loaded.
		expect(snapshots.at(-1)?.messageIds).toEqual(["msg-1", "msg-2"]);

		// Send /clear.
		await act(async () => {
			await snapshots.at(-1)?.sendMessage("/clear");
		});

		// After /clear, messages should be empty because the send path fell
		// through to onLoadMessages (chatMessage was null) which returned [].
		expect(snapshots.at(-1)?.messageIds).toEqual([]);
		expect(onSendMessage).toHaveBeenCalledWith("task-1", "/clear");
		// onLoadMessages: once for initial mount, once for the post-clear reload.
		expect(onLoadMessages).toHaveBeenCalledTimes(2);
	});

	it("clears stale messages when switching to another task", async () => {
		const onLoadMessages = vi.fn(async (taskId: string) => {
			if (taskId === "task-1") {
				return [
					{
						id: "task-1-message",
						role: "assistant" as const,
						content: "Task one",
						createdAt: 1,
					},
				];
			}
			return [
				{
					id: "task-2-message",
					role: "assistant" as const,
					content: "Task two",
					createdAt: 2,
				},
			];
		});
		const snapshots: HookSnapshot[] = [];

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onLoadMessages={onLoadMessages}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)?.messageIds).toEqual(["task-1-message"]);

		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-2"
					onLoadMessages={onLoadMessages}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)?.messageIds).toEqual(["task-2-message"]);
		expect(snapshots.at(-1)?.lastMessageContent).toBe("Task two");
	});

	it("clears local messages when incomingMessages transitions from populated to empty (task_chat_cleared)", async () => {
		const streamedMessages: ClineChatMessage[] = [
			{
				id: "ws-msg-1",
				role: "user",
				content: "Hello",
				createdAt: 1,
			},
			{
				id: "ws-msg-2",
				role: "assistant",
				content: "Hi there",
				createdAt: 2,
			},
		];
		const snapshots: HookSnapshot[] = [];

		// Mount with streamed messages via incomingMessages prop (simulating
		// messages that arrived through the runtime state stream WebSocket).
		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					incomingMessages={streamedMessages}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		// Messages from the stream should be visible in local state.
		expect(snapshots.at(-1)?.messageIds).toEqual(["ws-msg-1", "ws-msg-2"]);

		// Simulate the task_chat_cleared websocket event: the parent reducer
		// removes the task from taskChatMessagesByTaskId, so incomingMessages
		// becomes [].  The hook should clear its local messages to match.
		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					incomingMessages={[]}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)?.messageIds).toEqual([]);
	});

	it("preserves loaded history when incomingMessages is empty-by-default across re-renders", async () => {
		const loadedMessages: ClineChatMessage[] = [
			{
				id: "loaded-1",
				role: "user",
				content: "Hello",
				createdAt: 1,
			},
			{
				id: "loaded-2",
				role: "assistant",
				content: "Hi there",
				createdAt: 2,
			},
		];
		const onLoadMessages = vi.fn(async () => loadedMessages);
		const snapshots: HookSnapshot[] = [];

		// Initial render: onLoadMessages loads history, incomingMessages is []
		// (the default fallback from the parent when no streamed messages exist).
		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onLoadMessages={onLoadMessages}
					incomingMessages={[]}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)?.messageIds).toEqual(["loaded-1", "loaded-2"]);

		// Simulate an unrelated parent re-render that passes a fresh [] reference.
		// This must NOT wipe the locally loaded history.
		await act(async () => {
			root.render(
				<HookHarness
					taskId="task-1"
					onLoadMessages={onLoadMessages}
					incomingMessages={[]}
					onSnapshot={(snapshot) => snapshots.push(snapshot)}
				/>,
			);
			await Promise.resolve();
		});

		expect(snapshots.at(-1)?.messageIds).toEqual(["loaded-1", "loaded-2"]);
	});
});

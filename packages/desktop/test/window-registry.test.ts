import { describe, expect, it, vi } from "vitest";

// Mock Electron — WindowRegistry imports BrowserWindow/shell at module level.
vi.mock("electron", () => ({
	BrowserWindow: class MockBrowserWindow {
		static getFocusedWindow() {
			return null;
		}
	},
	shell: {
		openExternal: vi.fn(),
	},
}));

import { WindowRegistry } from "../src/window-registry.js";

// ---------------------------------------------------------------------------
// WindowRegistry.buildWindowUrl — pure function, no Electron needed
// ---------------------------------------------------------------------------

describe("WindowRegistry.buildWindowUrl", () => {
	it("returns base URL unchanged when projectId is null", () => {
		expect(WindowRegistry.buildWindowUrl("http://localhost:52341", null)).toBe(
			"http://localhost:52341",
		);
	});

	it("appends projectId as a query parameter", () => {
		const url = WindowRegistry.buildWindowUrl(
			"http://localhost:52341",
			"project-abc",
		);
		expect(url).toBe("http://localhost:52341/?projectId=project-abc");
	});

	it("preserves existing path in the base URL", () => {
		const url = WindowRegistry.buildWindowUrl(
			"http://localhost:52341/some/path",
			"proj-1",
		);
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/some/path");
		expect(parsed.searchParams.get("projectId")).toBe("proj-1");
	});

	it("preserves existing query parameters", () => {
		const url = WindowRegistry.buildWindowUrl(
			"http://localhost:52341/?token=abc",
			"proj-2",
		);
		const parsed = new URL(url);
		expect(parsed.searchParams.get("token")).toBe("abc");
		expect(parsed.searchParams.get("projectId")).toBe("proj-2");
	});

	it("handles projectId with special characters", () => {
		const url = WindowRegistry.buildWindowUrl(
			"http://localhost:52341",
			"/Users/john/my project",
		);
		const parsed = new URL(url);
		expect(parsed.searchParams.get("projectId")).toBe("/Users/john/my project");
	});

	it("returns base URL unchanged when projectId is empty string (falsy)", () => {
		expect(WindowRegistry.buildWindowUrl("http://localhost:52341", "")).toBe(
			"http://localhost:52341",
		);
	});
});

// ---------------------------------------------------------------------------
// WindowRegistry.loadPersistedWindows — delegates to loadAllWindowStates
// (thorough testing in window-state.test.ts, just verify the delegation)
// ---------------------------------------------------------------------------

describe("WindowRegistry.loadPersistedWindows", () => {
	it("returns empty array for non-existent directory", () => {
		const states = WindowRegistry.loadPersistedWindows("/tmp/non-existent-dir-" + Date.now());
		expect(states).toEqual([]);
	});
});

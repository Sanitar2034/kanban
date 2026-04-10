/**
 * WindowRegistry — sole owner of BrowserWindow lifecycle, focus tracking,
 * and per-window metadata (projectId, auth interceptor disposal, title).
 *
 * All window creation, lookup, and teardown MUST go through this registry.
 * The main module should never hold a bare `BrowserWindow` reference.
 *
 * Key behaviours:
 * - Duplicate prevention: `createWindow({ projectId })` focuses an existing
 *   window for that project instead of creating a second one.
 * - Focus tracking: the most-recently-focused window is returned by
 *   `getFocused()` when no window currently has OS focus.
 * - State persistence: `saveAllStates()` captures bounds from every window
 *   and writes them to `window-states.json`.
 */

import { BrowserWindow, shell } from "electron";

import {
	type PersistedWindowState,
	loadAllWindowStates,
	saveAllWindowStates,
} from "./window-state.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WindowEntry {
	window: BrowserWindow;
	projectId: string | null;
	disposeAuth: (() => void) | null;
}

export interface CreateWindowOptions {
	projectId?: string | null;
	savedState?: PersistedWindowState;
	/** Absolute path to the preload script. */
	preloadPath: string;
	/** Whether the app is packaged (controls devTools). */
	isPackaged: boolean;
	/** Background color for the window chrome. */
	backgroundColor?: string;
	/** The base runtime URL (e.g. "http://localhost:52341"). */
	runtimeUrl?: string | null;
	/** Callback invoked when any window is closed. */
	onWindowClosed?: (windowId: number) => void;
	/** Callback invoked when any window gains focus. */
	onWindowFocused?: (windowId: number) => void;
	/** Whether this is macOS and we should hide-to-dock on close. */
	hideOnCloseForMac?: boolean;
	/** Reference to the isQuitting flag. */
	isQuitting?: () => boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 900;
const MIN_WIDTH = 800;
const MIN_HEIGHT = 600;
const DEFAULT_BACKGROUND_COLOR = "#1F2428";

// ---------------------------------------------------------------------------
// WindowRegistry
// ---------------------------------------------------------------------------

export class WindowRegistry {
	private readonly windows = new Map<number, WindowEntry>();
	private lastFocusedId: number | null = null;

	/** Number of open windows. */
	get size(): number {
		return this.windows.size;
	}

	// -----------------------------------------------------------------------
	// Window creation
	// -----------------------------------------------------------------------

	/**
	 * Create a new BrowserWindow (or focus an existing one if the projectId
	 * already has a window).
	 *
	 * Returns the BrowserWindow that was created or focused.
	 */
	createWindow(options: CreateWindowOptions): BrowserWindow {
		const projectId = options.projectId ?? null;

		// Duplicate prevention — focus existing window for this project
		// (or the single overview window when projectId is null).
		const existing = projectId !== null
			? this.findByProjectId(projectId)
			: this.findOverviewWindow();
		if (existing) {
			// On macOS, windows can be hidden (not destroyed) via hide-on-close.
			// We need to show them before focusing.
			if (!existing.isVisible()) existing.show();
			if (existing.isMinimized()) existing.restore();
			existing.focus();
			return existing;
		}

		const savedState = options.savedState;
		const backgroundColor = options.backgroundColor ?? DEFAULT_BACKGROUND_COLOR;

		const window = new BrowserWindow({
			x: savedState?.x,
			y: savedState?.y,
			width: savedState?.width ?? DEFAULT_WIDTH,
			height: savedState?.height ?? DEFAULT_HEIGHT,
			minWidth: MIN_WIDTH,
			minHeight: MIN_HEIGHT,
			title: "Kanban",
			backgroundColor,
			show: false,
			webPreferences: {
				preload: options.preloadPath,
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				webSecurity: true,
				devTools: !options.isPackaged,
			},
		});

		if (savedState?.isMaximized) {
			window.maximize();
		}

		const entry: WindowEntry = {
			window,
			projectId,
			disposeAuth: null,
		};
		this.windows.set(window.id, entry);
		this.lastFocusedId = window.id;

		// -- Show once ready -------------------------------------------------
		window.once("ready-to-show", () => {
			window.show();
		});

		// -- Focus tracking --------------------------------------------------
		window.on("focus", () => {
			this.lastFocusedId = window.id;
			options.onWindowFocused?.(window.id);
		});

		// -- Navigation guard ------------------------------------------------
		window.webContents.on("will-navigate", (event, url) => {
			if (options.runtimeUrl && !url.startsWith(options.runtimeUrl)) {
				event.preventDefault();
			}
		});

		// Block new-window requests — open in system browser.
		window.webContents.setWindowOpenHandler(({ url }) => {
			shell.openExternal(url);
			return { action: "deny" };
		});

		// -- Close handling --------------------------------------------------
		window.on("close", (event) => {
			if (
				options.hideOnCloseForMac &&
				process.platform === "darwin" &&
				!(options.isQuitting?.() ?? false)
			) {
				event.preventDefault();
				window.hide();
				return;
			}
		});

		window.on("closed", () => {
			// Dispose auth interceptor if installed.
			const e = this.windows.get(window.id);
			if (e?.disposeAuth) {
				e.disposeAuth();
			}
			this.windows.delete(window.id);
			if (this.lastFocusedId === window.id) {
				this.lastFocusedId = null;
			}
			options.onWindowClosed?.(window.id);
		});

		return window;
	}

	// -----------------------------------------------------------------------
	// Lookup helpers
	// -----------------------------------------------------------------------

	/** Get all window entries. */
	getAll(): WindowEntry[] {
		return [...this.windows.values()];
	}

	/** Get a window entry by BrowserWindow id. */
	getById(windowId: number): WindowEntry | undefined {
		return this.windows.get(windowId);
	}

	/** Find the first window locked to the given projectId. */
	findByProjectId(projectId: string): BrowserWindow | null {
		for (const entry of this.windows.values()) {
			if (entry.projectId === projectId && !entry.window.isDestroyed()) {
				return entry.window;
			}
		}
		return null;
	}

	/** Find the overview (unscoped) window — projectId is null. */
	findOverviewWindow(): BrowserWindow | null {
		for (const entry of this.windows.values()) {
			if (entry.projectId === null && !entry.window.isDestroyed()) {
				return entry.window;
			}
		}
		return null;
	}

	/**
	 * Get the currently focused window, falling back to the most recently
	 * focused window. Returns null if no windows exist.
	 */
	getFocused(): BrowserWindow | null {
		// Check OS-level focus first.
		const focused = BrowserWindow.getFocusedWindow();
		if (focused && this.windows.has(focused.id)) {
			return focused;
		}

		// Fallback to last-focused.
		if (this.lastFocusedId !== null) {
			const entry = this.windows.get(this.lastFocusedId);
			if (entry && !entry.window.isDestroyed()) {
				return entry.window;
			}
			this.lastFocusedId = null;
		}

		// Fallback to any window.
		for (const entry of this.windows.values()) {
			if (!entry.window.isDestroyed()) {
				return entry.window;
			}
		}

		return null;
	}

	/**
	 * Remove a window from the registry (e.g. when it's destroyed).
	 * Normally not needed — `closed` event handles this automatically.
	 */
	remove(windowId: number): void {
		const entry = this.windows.get(windowId);
		if (entry?.disposeAuth) {
			entry.disposeAuth();
		}
		this.windows.delete(windowId);
		if (this.lastFocusedId === windowId) {
			this.lastFocusedId = null;
		}
	}

	// -----------------------------------------------------------------------
	// Auth interceptor management
	// -----------------------------------------------------------------------

	/** Set the auth interceptor dispose function for a window. */
	setAuthDisposer(windowId: number, dispose: (() => void) | null): void {
		const entry = this.windows.get(windowId);
		if (entry) {
			// Dispose previous interceptor before replacing.
			if (entry.disposeAuth) {
				entry.disposeAuth();
			}
			entry.disposeAuth = dispose;
		}
	}

	// -----------------------------------------------------------------------
	// Window title management
	// -----------------------------------------------------------------------

	/** Update a window's title to reflect the project name. */
	setWindowTitle(windowId: number, projectName: string | null): void {
		const entry = this.windows.get(windowId);
		if (!entry || entry.window.isDestroyed()) return;
		entry.window.setTitle(
			projectName ? `Kanban — ${projectName}` : "Kanban",
		);
	}

	// -----------------------------------------------------------------------
	// State persistence
	// -----------------------------------------------------------------------

	/** Capture bounds from all windows and save to disk. */
	saveAllStates(userDataPath: string): void {
		const states: PersistedWindowState[] = [];
		for (const entry of this.windows.values()) {
			if (entry.window.isDestroyed()) continue;
			const isMaximized = entry.window.isMaximized();
			const bounds = isMaximized
				? entry.window.getNormalBounds()
				: entry.window.getBounds();
			states.push({
				x: bounds.x,
				y: bounds.y,
				width: bounds.width,
				height: bounds.height,
				isMaximized,
				projectId: entry.projectId,
			});
		}
		saveAllWindowStates(userDataPath, states);
	}

	/** Load persisted window states from disk. */
	static loadPersistedWindows(
		userDataPath: string,
	): PersistedWindowState[] {
		return loadAllWindowStates(userDataPath);
	}

	// -----------------------------------------------------------------------
	// URL loading helpers
	// -----------------------------------------------------------------------

	/**
	 * Build the URL to load in a window, appending `?projectId=` if needed.
	 */
	static buildWindowUrl(
		baseUrl: string,
		projectId: string | null,
	): string {
		if (!projectId) return baseUrl;
		const url = new URL(baseUrl);
		url.searchParams.set("projectId", projectId);
		return url.toString();
	}

	/**
	 * Load the runtime URL in a specific window.
	 */
	async loadUrlInWindow(
		windowId: number,
		baseUrl: string,
	): Promise<void> {
		const entry = this.windows.get(windowId);
		if (!entry || entry.window.isDestroyed()) return;
		const url = WindowRegistry.buildWindowUrl(baseUrl, entry.projectId);
		await entry.window.loadURL(url);
	}

	/**
	 * Load the runtime URL in all windows.
	 */
	async loadUrlInAllWindows(baseUrl: string): Promise<void> {
		const promises: Promise<void>[] = [];
		for (const entry of this.windows.values()) {
			if (entry.window.isDestroyed()) continue;
			const url = WindowRegistry.buildWindowUrl(baseUrl, entry.projectId);
			promises.push(entry.window.loadURL(url));
		}
		await Promise.all(promises);
	}
}

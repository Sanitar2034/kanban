/**
 * Preload script for the Electron renderer process.
 *
 * Runs in a sandboxed context with access to a limited set of Node APIs.
 * Uses contextBridge to safely expose IPC channels to the renderer.
 */

import { contextBridge, ipcRenderer } from "electron";

/**
 * Desktop API exposed to the renderer via window.desktop.
 * Kept minimal; only add methods here when the renderer genuinely needs
 * main-process capabilities that can't go through the runtime HTTP/WS layer.
 */
const desktopApi = {
	/** Returns the platform the desktop app is running on. */
	platform: process.platform,

	/**
	 * Register a callback for the "open-diagnostics" menu action.
	 * Returns a dispose function to unregister the listener.
	 */
	onOpenDiagnostics(callback: () => void): () => void {
		const handler = () => callback();
		ipcRenderer.on("open-diagnostics", handler);
		return () => {
			ipcRenderer.removeListener("open-diagnostics", handler);
		};
	},

	/**
	 * Open a new Electron window locked to the given project.
	 */
	openProjectWindow(projectId: string): void {
		ipcRenderer.send("open-project-window", projectId);
	},

	/**
	 * Read a persistent desktop setting (survives port/origin changes).
	 * Returns null if the key doesn't exist.
	 */
	getDesktopSetting(key: string): Promise<string | null> {
		return ipcRenderer.invoke("get-desktop-setting", key);
	},

	/**
	 * Write a persistent desktop setting (survives port/origin changes).
	 */
	setDesktopSetting(key: string, value: string): void {
		ipcRenderer.send("set-desktop-setting", key, value);
	},
} as const;

contextBridge.exposeInMainWorld("desktop", desktopApi);

export type DesktopApi = typeof desktopApi;

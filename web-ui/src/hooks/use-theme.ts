import { useCallback, useSyncExternalStore } from "react";

import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

// ---------------------------------------------------------------------------
// Theme definitions
// ---------------------------------------------------------------------------

export type ThemeId =
	| "default"
	| "graphite"
	| "midnight"
	| "pitch"
	| "solarized-dark"
	| "light"
	| "overcast"
	| "solarized-light"
	| "high-contrast-dark"
	| "high-contrast-light";

export type ThemeGroup = "dark" | "light" | "high-contrast";

export interface ThemeDefinition {
	readonly id: ThemeId;
	readonly label: string;
	readonly group: ThemeGroup;
	/** Accent color shown in the theme swatch. */
	readonly accent: string;
	/** Darkest surface color shown as the swatch background. */
	readonly surface: string;
	/** Text color to use on top of accent backgrounds (ensures contrast). */
	readonly accentFg: string;
}

export const THEMES: readonly ThemeDefinition[] = [
	/* Dark */
	{ id: "default", label: "Default", group: "dark", accent: "#0084FF", surface: "#1F2428", accentFg: "#FFFFFF" },
	{ id: "graphite", label: "Graphite", group: "dark", accent: "#A855F7", surface: "#1E1E1E", accentFg: "#FFFFFF" },
	{ id: "midnight", label: "Midnight", group: "dark", accent: "#6366F1", surface: "#121214", accentFg: "#FFFFFF" },
	{ id: "pitch", label: "Pitch", group: "dark", accent: "#22C55E", surface: "#000000", accentFg: "#000000" },
	{
		id: "solarized-dark",
		label: "Solarized Dark",
		group: "dark",
		accent: "#268BD2",
		surface: "#002B36",
		accentFg: "#FFFFFF",
	},
	/* Light */
	{ id: "light", label: "Light", group: "light", accent: "#0084FF", surface: "#FFFFFF", accentFg: "#FFFFFF" },
	{ id: "overcast", label: "Overcast", group: "light", accent: "#7C3AED", surface: "#F0F0F0", accentFg: "#FFFFFF" },
	{
		id: "solarized-light",
		label: "Solarized Light",
		group: "light",
		accent: "#268BD2",
		surface: "#FDF6E3",
		accentFg: "#FFFFFF",
	},
	/* High contrast */
	{
		id: "high-contrast-dark",
		label: "High Contrast Dark",
		group: "high-contrast",
		accent: "#FFD700",
		surface: "#000000",
		accentFg: "#000000",
	},
	{
		id: "high-contrast-light",
		label: "High Contrast Light",
		group: "high-contrast",
		accent: "#0050A0",
		surface: "#FFFFFF",
		accentFg: "#FFFFFF",
	},
] as const;

export const THEME_GROUPS: readonly { key: ThemeGroup; label: string }[] = [
	{ key: "dark", label: "Dark" },
	{ key: "light", label: "Light" },
	{ key: "high-contrast", label: "High Contrast" },
];

const THEME_IDS = new Set<string>(THEMES.map((theme) => theme.id));
const themeStoreListeners = new Set<() => void>();
let storageSyncInstalled = false;
let currentThemeId: ThemeId = readStoredThemeId();

// ---------------------------------------------------------------------------
// Terminal color lookup per theme
// ---------------------------------------------------------------------------

export interface ThemeTerminalColors {
	readonly textPrimary: string;
	readonly surfacePrimary: string;
	readonly surfaceRaised: string;
	readonly selectionBackground: string;
	readonly selectionForeground: string;
	readonly selectionInactiveBackground: string;
}

/** Terminal hex colors keyed by theme id. */
const TERMINAL_COLORS_BY_THEME: Record<ThemeId, ThemeTerminalColors> = {
	default: {
		textPrimary: "#E6EDF3",
		surfacePrimary: "#1F2428",
		surfaceRaised: "#24292E",
		selectionBackground: "#0084FF4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#2D333966",
	},
	graphite: {
		textPrimary: "#E0E0E0",
		surfacePrimary: "#1E1E1E",
		surfaceRaised: "#252526",
		selectionBackground: "#A855F74D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#2D2D2D66",
	},
	midnight: {
		textPrimary: "#E4E4E7",
		surfacePrimary: "#121214",
		surfaceRaised: "#18181B",
		selectionBackground: "#6366F14D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#1F1F2366",
	},
	pitch: {
		textPrimary: "#E4E4E4",
		surfacePrimary: "#000000",
		surfaceRaised: "#0A0A0A",
		selectionBackground: "#22C55E4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#14141466",
	},
	"solarized-dark": {
		textPrimary: "#FDF6E3",
		surfacePrimary: "#002B36",
		surfaceRaised: "#073642",
		selectionBackground: "#268BD24D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#0E3E4A66",
	},
	light: {
		textPrimary: "#1F2328",
		surfacePrimary: "#FFFFFF",
		surfaceRaised: "#F6F8FA",
		selectionBackground: "#0084FF33",
		selectionForeground: "#1F2328",
		selectionInactiveBackground: "#E5E7EB66",
	},
	overcast: {
		textPrimary: "#1A1A1A",
		surfacePrimary: "#F0F0F0",
		surfaceRaised: "#E8E8E8",
		selectionBackground: "#7C3AED33",
		selectionForeground: "#1A1A1A",
		selectionInactiveBackground: "#D4D4D466",
	},
	"solarized-light": {
		textPrimary: "#073642",
		surfacePrimary: "#FDF6E3",
		surfaceRaised: "#EEE8D5",
		selectionBackground: "#268BD233",
		selectionForeground: "#073642",
		selectionInactiveBackground: "#DDD7C366",
	},
	"high-contrast-dark": {
		textPrimary: "#FFFFFF",
		surfacePrimary: "#000000",
		surfaceRaised: "#0A0A0A",
		selectionBackground: "#FFD7004D",
		selectionForeground: "#000000",
		selectionInactiveBackground: "#1A1A1A66",
	},
	"high-contrast-light": {
		textPrimary: "#000000",
		surfacePrimary: "#FFFFFF",
		surfaceRaised: "#F5F5F5",
		selectionBackground: "#0050A033",
		selectionForeground: "#000000",
		selectionInactiveBackground: "#DEDEDE66",
	},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isThemeId(value: string | null): value is ThemeId {
	return value !== null && THEME_IDS.has(value);
}

function notifyThemeStoreListeners(): void {
	for (const listener of themeStoreListeners) {
		listener();
	}
}

function readThemeSnapshot(): ThemeId {
	return currentThemeId;
}

function subscribeThemeStore(listener: () => void): () => void {
	installStorageSyncListener();
	themeStoreListeners.add(listener);
	return () => {
		themeStoreListeners.delete(listener);
	};
}

function installStorageSyncListener(): void {
	if (storageSyncInstalled || typeof window === "undefined") {
		return;
	}
	storageSyncInstalled = true;
	window.addEventListener("storage", (event) => {
		if (event.key !== null && event.key !== LocalStorageKey.Theme) {
			return;
		}
		const nextThemeId = readStoredThemeId();
		if (nextThemeId === currentThemeId) {
			return;
		}
		currentThemeId = nextThemeId;
		applyThemeToDocument(nextThemeId);
		notifyThemeStoreListeners();
	});
}

function applyThemeChange(themeId: ThemeId): void {
	if (themeId === currentThemeId) {
		return;
	}
	currentThemeId = themeId;
	applyThemeToDocument(themeId);
	notifyThemeStoreListeners();
}

export function readStoredThemeId(): ThemeId {
	const stored = readLocalStorageItem(LocalStorageKey.Theme);
	return isThemeId(stored) ? stored : "default";
}

export function applyThemeToDocument(themeId: ThemeId): void {
	if (typeof document === "undefined") {
		return;
	}
	if (themeId === "default") {
		document.documentElement.removeAttribute("data-theme");
	} else {
		document.documentElement.setAttribute("data-theme", themeId);
	}
}

export function previewThemeId(themeId: ThemeId): void {
	applyThemeChange(themeId);
}

export function saveThemeId(themeId: ThemeId): void {
	writeLocalStorageItem(LocalStorageKey.Theme, themeId);
	applyThemeChange(themeId);
}

/** Get terminal colors for the given theme (or the currently active theme). */
export function getTerminalThemeColors(themeId?: ThemeId): ThemeTerminalColors {
	const id = themeId ?? readThemeSnapshot();
	return TERMINAL_COLORS_BY_THEME[id];
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export interface UseThemeResult {
	themeId: ThemeId;
	setThemeId: (id: ThemeId) => void;
}

export function useTheme(): UseThemeResult {
	const themeId = useSyncExternalStore(subscribeThemeStore, readThemeSnapshot, readThemeSnapshot);

	const setThemeId = useCallback((id: ThemeId) => {
		saveThemeId(id);
	}, []);

	return { themeId, setThemeId };
}

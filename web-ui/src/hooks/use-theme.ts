import { useCallback, useSyncExternalStore } from "react";

import { LocalStorageKey, readLocalStorageItem, writeLocalStorageItem } from "@/storage/local-storage-store";

// ---------------------------------------------------------------------------
// Theme definitions
// ---------------------------------------------------------------------------

export type ThemeMode = "dark" | "light";

export type ThemeId =
	| "default"
	| "high-contrast"
	| "forest"
	| "sunset"
	| "ocean"
	| "nord"
	| "light"
	| "light-nord"
	| "light-solarized"
	| "light-rose"
	| "light-lavender"
	| "light-postit";

export interface ThemeDefinition {
	readonly id: ThemeId;
	readonly label: string;
	readonly mode: ThemeMode;
	/** Accent color shown in the theme preview. */
	readonly accent: string;
	/** Darkest/lightest surface color (background). */
	readonly surface: string;
	/** Secondary surface for the preview strip. */
	readonly surfaceAlt: string;
	/** Primary text color for the preview strip. */
	readonly text: string;
}

export const THEMES: readonly ThemeDefinition[] = [
	// -- Dark themes --
	{
		id: "default",
		label: "Default",
		mode: "dark",
		accent: "#0084FF",
		surface: "#1F2428",
		surfaceAlt: "#24292E",
		text: "#E6EDF3",
	},
	{
		id: "high-contrast",
		label: "High Contrast",
		mode: "dark",
		accent: "#58A6FF",
		surface: "#010409",
		surfaceAlt: "#0D1117",
		text: "#F0F6FC",
	},
	{
		id: "forest",
		label: "Forest",
		mode: "dark",
		accent: "#147340",
		surface: "#1C1C1C",
		surfaceAlt: "#212421",
		text: "#F0E4D8",
	},
	{
		id: "sunset",
		label: "Sunset",
		mode: "dark",
		accent: "#D94A1E",
		surface: "#1C1C1C",
		surfaceAlt: "#252525",
		text: "#F0E4D8",
	},
	{
		id: "ocean",
		label: "Ocean",
		mode: "dark",
		accent: "#34B5C8",
		surface: "#162028",
		surfaceAlt: "#1B2830",
		text: "#D8ECF0",
	},
	{
		id: "nord",
		label: "Nord",
		mode: "dark",
		accent: "#88C0D0",
		surface: "#2E3440",
		surfaceAlt: "#3B4252",
		text: "#ECEFF4",
	},
	// -- Light themes --
	{
		id: "light",
		label: "Light",
		mode: "light",
		accent: "#0969DA",
		surface: "#FFFFFF",
		surfaceAlt: "#F6F8FA",
		text: "#1F2328",
	},
	{
		id: "light-nord",
		label: "Light Nord",
		mode: "light",
		accent: "#5E81AC",
		surface: "#ECEFF4",
		surfaceAlt: "#E5E9F0",
		text: "#2E3440",
	},
	{
		id: "light-solarized",
		label: "Solarized Light",
		mode: "light",
		accent: "#268BD2",
		surface: "#FDF6E3",
		surfaceAlt: "#EEE8D5",
		text: "#657B83",
	},
	{
		id: "light-rose",
		label: "Light Rosé",
		mode: "light",
		accent: "#D6336C",
		surface: "#FFFBFC",
		surfaceAlt: "#FFF0F3",
		text: "#3D1F29",
	},
	{
		id: "light-lavender",
		label: "Light Lavender",
		mode: "light",
		accent: "#7C4DFF",
		surface: "#FDFBFF",
		surfaceAlt: "#F4F0FA",
		text: "#2D2440",
	},
	{
		id: "light-postit",
		label: "Post-it",
		mode: "light",
		accent: "#FFDD63",
		surface: "#FCF9E1",
		surfaceAlt: "#FFF9D1",
		text: "#3E2723",
	},
] as const;

export const DARK_THEMES: readonly ThemeDefinition[] = THEMES.filter((t) => t.mode === "dark");
export const LIGHT_THEMES: readonly ThemeDefinition[] = THEMES.filter((t) => t.mode === "light");

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
	"high-contrast": {
		textPrimary: "#F0F6FC",
		surfacePrimary: "#010409",
		surfaceRaised: "#0D1117",
		selectionBackground: "#58A6FF4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#16192466",
	},
	forest: {
		textPrimary: "#F0E4D8",
		surfacePrimary: "#1C1C1C",
		surfaceRaised: "#212421",
		selectionBackground: "#1473404D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#33333366",
	},
	sunset: {
		textPrimary: "#F0E4D8",
		surfacePrimary: "#1C1C1C",
		surfaceRaised: "#252525",
		selectionBackground: "#D94A1E4D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#33333366",
	},
	ocean: {
		textPrimary: "#D8ECF0",
		surfacePrimary: "#162028",
		surfaceRaised: "#1B2830",
		selectionBackground: "#34B5C84D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#22323A66",
	},
	nord: {
		textPrimary: "#ECEFF4",
		surfacePrimary: "#2E3440",
		surfaceRaised: "#3B4252",
		selectionBackground: "#88C0D04D",
		selectionForeground: "#ffffff",
		selectionInactiveBackground: "#434C5E66",
	},
	// -- Light terminal colors --
	light: {
		textPrimary: "#1F2328",
		surfacePrimary: "#FFFFFF",
		surfaceRaised: "#F6F8FA",
		selectionBackground: "#0969DA33",
		selectionForeground: "#1F2328",
		selectionInactiveBackground: "#D0D7DE66",
	},
	"light-nord": {
		textPrimary: "#2E3440",
		surfacePrimary: "#ECEFF4",
		surfaceRaised: "#E5E9F0",
		selectionBackground: "#5E81AC33",
		selectionForeground: "#2E3440",
		selectionInactiveBackground: "#D8DEE966",
	},
	"light-solarized": {
		textPrimary: "#657B83",
		surfacePrimary: "#FDF6E3",
		surfaceRaised: "#EEE8D5",
		selectionBackground: "#268BD233",
		selectionForeground: "#657B83",
		selectionInactiveBackground: "#D6CABF66",
	},
	"light-rose": {
		textPrimary: "#3D1F29",
		surfacePrimary: "#FFFBFC",
		surfaceRaised: "#FFF0F3",
		selectionBackground: "#D6336C33",
		selectionForeground: "#3D1F29",
		selectionInactiveBackground: "#F5D0DC66",
	},
	"light-lavender": {
		textPrimary: "#2D2440",
		surfacePrimary: "#FDFBFF",
		surfaceRaised: "#F4F0FA",
		selectionBackground: "#7C4DFF33",
		selectionForeground: "#2D2440",
		selectionInactiveBackground: "#DCD4EC66",
	},
	"light-postit": {
		textPrimary: "#3E2723",
		surfacePrimary: "#FCF9E1",
		surfaceRaised: "#FFF9D1",
		selectionBackground: "#FFDD6366",
		selectionForeground: "#3E2723",
		selectionInactiveBackground: "#F0D8A866",
	},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function isThemeId(value: string | null): value is ThemeId {
	return value !== null && THEME_IDS.has(value);
}

export function getThemeDefinition(themeId: ThemeId): ThemeDefinition {
	const found = THEMES.find((t) => t.id === themeId);
	if (!found) {
		// ThemeId is a closed union so this should never happen, but satisfy the compiler.
		return THEMES[0] as ThemeDefinition;
	}
	return found;
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

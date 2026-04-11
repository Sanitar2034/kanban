import type { ITerminalOptions } from "@xterm/xterm";

import type { ThemeTerminalColors } from "@/hooks/use-theme";

interface CreateKanbanTerminalOptionsInput {
	cursorColor: string;
	isMacPlatform: boolean;
	terminalBackgroundColor: string;
	themeColors: ThemeTerminalColors;
}

const TERMINAL_WORD_SEPARATOR = " ()[]{}',\"`";
const TERMINAL_FONT_FAMILY =
	"'Cascadia Code', 'Fira Code', 'JetBrains Mono', 'SF Mono', Menlo, Monaco, 'Courier New', monospace";

/**
 * ANSI color palette for light terminal backgrounds.
 * Uses darker, more saturated colors that remain readable on white/cream surfaces.
 */
const LIGHT_ANSI_COLORS = {
	black: "#1B1B1B",
	red: "#C72A2A",
	green: "#177F17",
	yellow: "#8A6B00",
	blue: "#1A5FB4",
	magenta: "#A0379E",
	cyan: "#0D7377",
	white: "#657B83",
	brightBlack: "#6E7681",
	brightRed: "#E03E3E",
	brightGreen: "#1EA21E",
	brightYellow: "#B38B00",
	brightBlue: "#2B7BD9",
	brightMagenta: "#C244C0",
	brightCyan: "#1A9C9C",
	brightWhite: "#586069",
} as const;

export function createKanbanTerminalOptions({
	cursorColor,
	isMacPlatform,
	terminalBackgroundColor,
	themeColors,
}: CreateKanbanTerminalOptionsInput): ITerminalOptions {
	return {
		allowProposedApi: true,
		allowTransparency: false,
		convertEol: false,
		cursorBlink: false,
		cursorInactiveStyle: "outline",
		cursorStyle: "block",
		disableStdin: false,
		fontFamily: TERMINAL_FONT_FAMILY,
		fontSize: 13,
		fontWeight: "normal",
		fontWeightBold: "bold",
		letterSpacing: 0,
		lineHeight: 1,
		macOptionClickForcesSelection: isMacPlatform,
		macOptionIsMeta: isMacPlatform,
		rightClickSelectsWord: false,
		scrollOnEraseInDisplay: true,
		scrollOnUserInput: true,
		scrollback: 10_000,
		smoothScrollDuration: 0,
		theme: {
			background: terminalBackgroundColor,
			cursor: cursorColor,
			cursorAccent: terminalBackgroundColor,
			foreground: themeColors.textPrimary,
			selectionBackground: themeColors.selectionBackground,
			selectionForeground: themeColors.selectionForeground,
			selectionInactiveBackground: themeColors.selectionInactiveBackground,
			...(themeColors.isLightBackground ? LIGHT_ANSI_COLORS : {}),
		},
		windowOptions: {
			getCellSizePixels: true,
			getWinSizeChars: true,
			getWinSizePixels: true,
		},
		wordSeparator: TERMINAL_WORD_SEPARATOR,
	};
}

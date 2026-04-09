import Editor, { type OnMount } from "@monaco-editor/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { getRuntimeTrpcClient } from "@/runtime/trpc-client";

// ── Language map ───────────────────────────────────────────────

const LANGUAGE_MAP: Record<string, string> = {
	ts: "typescript",
	tsx: "typescript",
	js: "javascript",
	jsx: "javascript",
	json: "json",
	jsonc: "json",
	md: "markdown",
	mdx: "markdown",
	css: "css",
	scss: "scss",
	less: "less",
	html: "html",
	htm: "html",
	xml: "xml",
	yaml: "yaml",
	yml: "yaml",
	toml: "ini",
	py: "python",
	rb: "ruby",
	go: "go",
	rs: "rust",
	java: "java",
	kt: "kotlin",
	c: "c",
	cpp: "cpp",
	h: "c",
	hpp: "cpp",
	cs: "csharp",
	swift: "swift",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	sql: "sql",
	graphql: "graphql",
	proto: "protobuf",
	dockerfile: "dockerfile",
	makefile: "makefile",
	lua: "lua",
	php: "php",
	dart: "dart",
	vue: "html",
	svelte: "html",
	env: "ini",
	gitignore: "ini",
	mjs: "javascript",
	cjs: "javascript",
};

function getMonacoLanguage(filePath: string): string {
	const name = filePath.slice(filePath.lastIndexOf("/") + 1).toLowerCase();
	if (name === "dockerfile" || name.startsWith("dockerfile.")) return "dockerfile";
	if (name === "makefile" || name === "gnumakefile") return "makefile";
	if (name.endsWith(".d.ts")) return "typescript";
	const dotIndex = name.lastIndexOf(".");
	if (dotIndex === -1) return "plaintext";
	const ext = name.slice(dotIndex + 1);
	return LANGUAGE_MAP[ext] ?? "plaintext";
}

// ── Custom theme (matches Prism token colors from globals.css) ─

const THEME_NAME = "kanban-dark";
let themeRegistered = false;

function ensureTheme(monaco: Parameters<OnMount>[1]) {
	if (themeRegistered) return;
	themeRegistered = true;

	monaco.editor.defineTheme(THEME_NAME, {
		base: "vs-dark",
		inherit: true,
		rules: [
			{ token: "comment", foreground: "6E7681" },
			{ token: "comment.content", foreground: "6E7681" },
			{ token: "comment.block", foreground: "6E7681" },
			{ token: "keyword", foreground: "4C9AFF" },
			{ token: "keyword.control", foreground: "4C9AFF" },
			{ token: "keyword.operator", foreground: "8B949E" },
			{ token: "tag", foreground: "4C9AFF" },
			{ token: "string", foreground: "3FB950" },
			{ token: "string.key", foreground: "4C9AFF" },
			{ token: "attribute.value", foreground: "3FB950" },
			{ token: "number", foreground: "D29922" },
			{ token: "number.float", foreground: "D29922" },
			{ token: "number.hex", foreground: "D29922" },
			{ token: "constant", foreground: "D29922" },
			{ token: "entity.name.function", foreground: "4C9AFF" },
			{ token: "support.function", foreground: "4C9AFF" },
			{ token: "entity.name.type", foreground: "4C9AFF" },
			{ token: "type", foreground: "4C9AFF" },
			{ token: "type.identifier", foreground: "4C9AFF" },
			{ token: "operator", foreground: "8B949E" },
			{ token: "delimiter", foreground: "8B949E" },
			{ token: "delimiter.bracket", foreground: "8B949E" },
			{ token: "delimiter.parenthesis", foreground: "8B949E" },
			{ token: "delimiter.square", foreground: "8B949E" },
			{ token: "delimiter.angle", foreground: "8B949E" },
			{ token: "variable", foreground: "E6EDF3" },
			{ token: "identifier", foreground: "E6EDF3" },
			{ token: "attribute.name", foreground: "4C9AFF" },
			{ token: "regexp", foreground: "D29922" },
		],
		colors: {
			"editor.background": "#24292E",
			"editor.foreground": "#E6EDF3",
			"editorLineNumber.foreground": "#6E7681",
			"editorLineNumber.activeForeground": "#8B949E",
			"editor.selectionBackground": "#264F78",
			"editor.lineHighlightBackground": "#2D3339",
			"editorCursor.foreground": "#E6EDF3",
			"editorIndentGuide.background": "#30363D",
			"editorIndentGuide.activeBackground": "#444C56",
			"scrollbarSlider.background": "#3E464E80",
			"scrollbarSlider.hoverBackground": "#3E464EA0",
			"scrollbarSlider.activeBackground": "#3E464EC0",
			"editorWidget.background": "#24292E",
			"editorWidget.border": "#30363D",
			"editorSuggestWidget.background": "#24292E",
			"editorSuggestWidget.border": "#30363D",
			"editorSuggestWidget.selectedBackground": "#2D3339",
			"editorOverviewRuler.border": "#00000000",
			"editorBracketMatch.background": "#2D333940",
			"editorBracketMatch.border": "#444C56",
			"editorGutter.background": "#24292E",
			"minimap.background": "#1F2428",
			"minimapSlider.background": "#3E464E40",
			"minimapSlider.hoverBackground": "#3E464E60",
			"minimapSlider.activeBackground": "#3E464E80",
		},
	});
}

// ── Git gutter decorations ─────────────────────────────────────

let gutterStylesInjected = false;

function ensureGutterStyles(): void {
	if (gutterStylesInjected) return;
	gutterStylesInjected = true;
	const style = document.createElement("style");
	style.textContent = `
		.kb-git-gutter-added { border-left: 3px solid #3FB950 !important; margin-left: 2px; }
		.kb-git-gutter-modified { border-left: 3px solid #4C9AFF !important; margin-left: 2px; }
		.kb-git-gutter-deleted { border-left: 3px solid #F85149 !important; margin-left: 2px; }
	`;
	document.head.appendChild(style);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadGitGutterDecorations(editor: any, workspaceId: string, filePath: string): Promise<void> {
	ensureGutterStyles();
	try {
		const client = getRuntimeTrpcClient(workspaceId);
		const result = await client.workspace.getFileGitLineStatus.query({ path: filePath });
		if (!result.changes || result.changes.length === 0) return;

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const decorations: any[] = [];
		for (const change of result.changes) {
			if (change.type === "deleted") {
				const line = Math.max(1, change.startLine);
				decorations.push({
					range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
					options: { isWholeLine: true, linesDecorationsClassName: "kb-git-gutter-deleted" },
				});
			} else {
				const endLine = change.startLine + Math.max(change.lineCount - 1, 0);
				const className = change.type === "added" ? "kb-git-gutter-added" : "kb-git-gutter-modified";
				decorations.push({
					range: { startLineNumber: change.startLine, startColumn: 1, endLineNumber: endLine, endColumn: 1 },
					options: { isWholeLine: true, linesDecorationsClassName: className },
				});
			}
		}
		editor.createDecorationsCollection(decorations);
	} catch {
		// Non-critical: gutter decoration failures should not affect the editor.
	}
}

// ── Types ──────────────────────────────────────────────────────

export interface EditorSettings {
	fontSize: number;
	wordWrap: boolean;
}

interface FileContent {
	path: string;
	content: string | null;
	size: number;
	isBinary: boolean;
	error?: string;
}

// ── Component ──────────────────────────────────────────────────

export function CodeViewer({
	workspaceId,
	filePath,
	onDirtyChange,
	editorSettings,
}: {
	workspaceId: string | null;
	filePath: string | null;
	onDirtyChange?: (path: string, isDirty: boolean) => void;
	editorSettings?: EditorSettings;
}): React.ReactElement {
	const [fileContent, setFileContent] = useState<FileContent | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const loadingPathRef = useRef<string | null>(null);
	const originalContentRef = useRef<string>("");
	const currentContentRef = useRef<string>("");
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const editorRef = useRef<any>(null);

	const loadFile = useCallback(
		async (path: string) => {
			if (!workspaceId) return;
			loadingPathRef.current = path;
			setIsLoading(true);
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const result = await client.workspace.readFile.query({ path });
				if (loadingPathRef.current !== path) return;
				setFileContent(result as FileContent);
				originalContentRef.current = result.content ?? "";
				currentContentRef.current = result.content ?? "";
			} catch (err) {
				if (loadingPathRef.current !== path) return;
				setFileContent({
					path,
					content: null,
					size: 0,
					isBinary: false,
					error: err instanceof Error ? err.message : String(err),
				});
			} finally {
				if (loadingPathRef.current === path) setIsLoading(false);
			}
		},
		[workspaceId],
	);

	useEffect(() => {
		if (!filePath) {
			setFileContent(null);
			loadingPathRef.current = null;
			return;
		}
		void loadFile(filePath);
	}, [filePath, loadFile]);

	const saveFile = useCallback(async () => {
		if (!workspaceId || !filePath || isSaving) return;
		const content = currentContentRef.current;
		setIsSaving(true);
		try {
			const client = getRuntimeTrpcClient(workspaceId);
			const result = await client.workspace.writeFile.mutate({ path: filePath, content });
			if (result.ok) {
				originalContentRef.current = content;
				onDirtyChange?.(filePath, false);
			}
		} finally {
			setIsSaving(false);
		}
	}, [workspaceId, filePath, isSaving, onDirtyChange]);

	const handleEditorMount: OnMount = useCallback(
		(editor, monaco) => {
			editorRef.current = editor;
			ensureTheme(monaco);
			monaco.editor.setTheme(THEME_NAME);

			const noValidation = { noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true };
			monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(noValidation);
			monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(noValidation);

			editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
				void saveFile();
			});

			if (workspaceId && filePath) {
				void loadGitGutterDecorations(editor, workspaceId, filePath);
			}
		},
		[saveFile, workspaceId, filePath],
	);

	const handleEditorChange = useCallback(
		(value: string | undefined) => {
			const newContent = value ?? "";
			currentContentRef.current = newContent;
			if (filePath) onDirtyChange?.(filePath, newContent !== originalContentRef.current);
		},
		[filePath, onDirtyChange],
	);

	if (!filePath) {
		return (
			<div className="flex flex-1 items-center justify-center min-h-0 text-text-tertiary text-sm">
				Select a file to view its contents
			</div>
		);
	}
	if (isLoading) {
		return (
			<div className="flex flex-1 items-center justify-center min-h-0">
				<Spinner size={24} />
			</div>
		);
	}
	if (!fileContent) return <div />;
	if (fileContent.error) {
		return (
			<div className="flex flex-1 items-center justify-center min-h-0 text-text-tertiary text-sm">
				Cannot read file: {fileContent.error}
			</div>
		);
	}
	if (fileContent.isBinary) {
		return (
			<div className="flex flex-1 items-center justify-center min-h-0 text-text-tertiary text-sm">
				Binary file: {fileContent.path}
			</div>
		);
	}

	const content = fileContent.content ?? "";
	const language = getMonacoLanguage(fileContent.path);

	return (
		<div className="flex flex-col flex-1 min-h-0 min-w-0 relative">
			{isSaving && <div className="absolute top-1 right-3 z-10 text-[11px] text-text-tertiary">Saving…</div>}
			<div className="flex-1 min-h-0 min-w-0">
				<Editor
					key={filePath}
					defaultValue={content}
					language={language}
					theme={THEME_NAME}
					onMount={handleEditorMount}
					onChange={handleEditorChange}
					options={{
						minimap: { enabled: false },
						scrollBeyondLastLine: false,
						fontSize: editorSettings?.fontSize ?? 12,
						lineNumbers: "on",
						renderLineHighlight: "line",
						folding: true,
						wordWrap: (editorSettings?.wordWrap ?? false) ? "on" : "off",
						automaticLayout: true,
						contextmenu: true,
						overviewRulerLanes: 0,
						hideCursorInOverviewRuler: true,
						scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
						padding: { top: 8 },
						fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
					}}
					loading={<Spinner size={24} />}
				/>
			</div>
		</div>
	);
}

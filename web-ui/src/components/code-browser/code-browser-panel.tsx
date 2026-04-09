import { Ellipsis, Search, X } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { CodeViewer, type EditorSettings } from "./code-viewer";
import { FileTypeIcon } from "./file-icons";
import { FileSearchDialog } from "./file-search-dialog";
import { FileTree } from "./file-tree";

const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 160;
const MAX_SIDEBAR_WIDTH = 500;

interface TabInfo {
	path: string;
	isDirty: boolean;
}

const DEFAULT_EDITOR_SETTINGS: EditorSettings = { fontSize: 12, wordWrap: false };

function getFileName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

function useResizableSidebar(initialWidth: number) {
	const [width, setWidth] = useState(initialWidth);
	const [isDragging, setIsDragging] = useState(false);
	const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);
	const startDrag = useCallback(
		(e: ReactMouseEvent) => {
			e.preventDefault();
			dragRef.current = { startX: e.clientX, startWidth: width };
			setIsDragging(true);
			document.body.style.userSelect = "none";
			document.body.style.cursor = "ew-resize";
		},
		[width],
	);
	useEffect(() => {
		if (!isDragging) return;
		const onMouseMove = (e: MouseEvent) => {
			if (!dragRef.current) return;
			const delta = e.clientX - dragRef.current.startX;
			setWidth(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, dragRef.current.startWidth + delta)));
		};
		const onMouseUp = () => {
			setIsDragging(false);
			document.body.style.userSelect = "";
			document.body.style.cursor = "";
			dragRef.current = null;
		};
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
		return () => {
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, [isDragging]);
	return { width, startDrag };
}

function EditorSettingsPopover({
	settings,
	onChange,
}: {
	settings: EditorSettings;
	onChange: (s: EditorSettings) => void;
}) {
	const [open, setOpen] = useState(false);
	const btnRef = useRef<HTMLButtonElement>(null);
	const [pos, setPos] = useState({ top: 0, right: 0 });
	const handleOpen = useCallback(() => {
		if (!open && btnRef.current) {
			const rect = btnRef.current.getBoundingClientRect();
			setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
		}
		setOpen(!open);
	}, [open]);
	return (
		<div className="relative">
			<button
				ref={btnRef}
				type="button"
				className="p-1 rounded hover:bg-surface-2 text-text-tertiary hover:text-text-secondary cursor-pointer"
				onClick={handleOpen}
				title="Editor settings"
			>
				<Ellipsis size={14} />
			</button>
			{open && (
				<>
					<div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
					<div
						className="fixed z-50 bg-surface-2 border border-border rounded-lg shadow-xl p-3 w-[200px]"
						style={{ top: pos.top, right: pos.right }}
					>
						<div className="text-[11px] font-semibold text-text-tertiary mb-2 uppercase">Editor</div>
						<label className="flex items-center justify-between text-xs text-text-secondary mb-2">
							Font Size
							<input
								type="number"
								min={8}
								max={28}
								value={settings.fontSize}
								onChange={(e) =>
									onChange({ ...settings, fontSize: Math.max(8, Math.min(28, Number(e.target.value))) })
								}
								className="w-12 bg-surface-0 border border-border rounded px-1.5 py-0.5 text-xs text-text-primary text-center"
							/>
						</label>
						<label className="flex items-center justify-between text-xs text-text-secondary cursor-pointer">
							Word Wrap
							<input
								type="checkbox"
								checked={settings.wordWrap}
								onChange={() => onChange({ ...settings, wordWrap: !settings.wordWrap })}
							/>
						</label>
					</div>
				</>
			)}
		</div>
	);
}

function TabBar({
	tabs,
	activeTabPath,
	onSelectTab,
	onCloseTab,
	onOpenSearch,
	editorSettings,
	onEditorSettingsChange,
}: {
	tabs: TabInfo[];
	activeTabPath: string | null;
	onSelectTab: (path: string) => void;
	onCloseTab: (path: string) => void;
	onOpenSearch: () => void;
	editorSettings: EditorSettings;
	onEditorSettingsChange: (s: EditorSettings) => void;
}) {
	return (
		<div className="flex items-stretch h-[34px] min-h-[34px] bg-surface-1 border-b border-border overflow-hidden shrink-0">
			<div className="flex flex-1 overflow-x-auto overflow-y-hidden items-stretch">
				{tabs.map((tab) => {
					const isActive = tab.path === activeTabPath;
					const name = getFileName(tab.path);
					return (
						<div
							key={tab.path}
							onMouseDown={(e) => {
								if (e.button === 1) {
									e.preventDefault();
									onCloseTab(tab.path);
								}
							}}
							onClick={() => onSelectTab(tab.path)}
							className={`flex items-center gap-1.5 px-2.5 cursor-pointer whitespace-nowrap text-[12px] border-r border-border select-none shrink-0 ${isActive ? "bg-surface-0 text-text-primary" : "text-text-tertiary hover:text-text-secondary"}`}
						>
							<FileTypeIcon name={name} size={14} />
							<span className="overflow-hidden text-ellipsis">
								{tab.isDirty ? "● " : ""}
								{name}
							</span>
							<button
								type="button"
								className="ml-0.5 p-0 border-0 bg-transparent text-text-tertiary hover:text-text-primary cursor-pointer"
								onClick={(e) => {
									e.stopPropagation();
									onCloseTab(tab.path);
								}}
							>
								<X size={12} />
							</button>
						</div>
					);
				})}
			</div>
			<div className="flex items-center gap-0.5 px-1.5 shrink-0">
				<Tooltip side="bottom" content="Search files (⇧⌘P)">
					<Button variant="ghost" size="sm" icon={<Search size={14} />} onClick={onOpenSearch} />
				</Tooltip>
				<EditorSettingsPopover settings={editorSettings} onChange={onEditorSettingsChange} />
			</div>
		</div>
	);
}

export function CodeBrowserPanel({
	workspaceId,
	externalFilePath,
}: {
	workspaceId: string | null;
	externalFilePath?: string | null;
}): React.ReactElement {
	const [tabs, setTabs] = useState<TabInfo[]>([]);
	const [activeTabPath, setActiveTabPath] = useState<string | null>(null);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [editorSettings, setEditorSettings] = useState<EditorSettings>(DEFAULT_EDITOR_SETTINGS);
	const { width: sidebarWidth, startDrag } = useResizableSidebar(DEFAULT_SIDEBAR_WIDTH);

	const handleSelectFile = useCallback((path: string) => {
		setTabs((prev) => {
			if (prev.some((tab) => tab.path === path)) return prev;
			return [...prev, { path, isDirty: false }];
		});
		setActiveTabPath(path);
	}, []);

	const handleCloseTab = useCallback(
		(path: string) => {
			setTabs((prev) => {
				const next = prev.filter((tab) => tab.path !== path);
				if (activeTabPath === path) {
					const closedIndex = prev.findIndex((tab) => tab.path === path);
					const newActive = next[Math.min(closedIndex, next.length - 1)]?.path ?? null;
					setActiveTabPath(newActive);
				}
				return next;
			});
		},
		[activeTabPath],
	);

	const handleDirtyChange = useCallback((path: string, isDirty: boolean) => {
		setTabs((prev) => prev.map((tab) => (tab.path === path ? { ...tab, isDirty } : tab)));
	}, []);

	// Open files requested externally (e.g. from the global Cmd+Shift+P search).
	useEffect(() => {
		if (externalFilePath) {
			handleSelectFile(externalFilePath);
		}
	}, [externalFilePath, handleSelectFile]);

	return (
		<div className="flex flex-1 min-h-0 min-w-0 bg-surface-0 p-2 gap-2">
			<div
				className="flex flex-col bg-surface-1 overflow-hidden shrink-0 relative rounded-lg border border-border"
				style={{ width: sidebarWidth, minWidth: MIN_SIDEBAR_WIDTH, maxWidth: MAX_SIDEBAR_WIDTH }}
			>
				<div className="flex items-center px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary border-b border-border shrink-0">
					Explorer
				</div>
				<FileTree workspaceId={workspaceId} selectedFilePath={activeTabPath} onSelectFile={handleSelectFile} />
				<div onMouseDown={startDrag} className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize z-10" />
			</div>
			<div className="flex flex-1 min-w-0 min-h-0 flex-col rounded-lg border border-border overflow-hidden">
				<TabBar
					tabs={tabs}
					activeTabPath={activeTabPath}
					onSelectTab={setActiveTabPath}
					onCloseTab={handleCloseTab}
					onOpenSearch={() => setIsSearchOpen(true)}
					editorSettings={editorSettings}
					onEditorSettingsChange={setEditorSettings}
				/>
				<CodeViewer
					workspaceId={workspaceId}
					filePath={activeTabPath}
					onDirtyChange={handleDirtyChange}
					editorSettings={editorSettings}
				/>
			</div>
			<FileSearchDialog
				isOpen={isSearchOpen}
				onClose={() => setIsSearchOpen(false)}
				workspaceId={workspaceId}
				onSelectFile={handleSelectFile}
			/>
		</div>
	);
}

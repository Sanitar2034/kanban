import { Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getRuntimeTrpcClient } from "@/runtime/trpc-client";
import { FileTypeIcon } from "./file-icons";

export interface FileSearchDialogProps {
	isOpen: boolean;
	onClose: () => void;
	workspaceId: string | null;
	onSelectFile: (path: string) => void;
}

export function FileSearchDialog({
	isOpen,
	onClose,
	workspaceId,
	onSelectFile,
}: FileSearchDialogProps): React.ReactElement | null {
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<{ path: string; name: string }[]>([]);
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [isSearching, setIsSearching] = useState(false);
	const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!isOpen) {
			setQuery("");
			setResults([]);
			setSelectedIndex(0);
		} else {
			setTimeout(() => inputRef.current?.focus(), 50);
		}
	}, [isOpen]);

	useEffect(() => {
		if (!workspaceId || !isOpen) {
			return;
		}
		if (searchTimerRef.current) {
			clearTimeout(searchTimerRef.current);
		}
		searchTimerRef.current = setTimeout(async () => {
			setIsSearching(true);
			try {
				const client = getRuntimeTrpcClient(workspaceId);
				const result = await client.workspace.searchFiles.query({ query, limit: 50 });
				setResults(result.files.map((f) => ({ path: f.path, name: f.name })));
				setSelectedIndex(0);
			} catch {
				setResults([]);
			} finally {
				setIsSearching(false);
			}
		}, 100);
		return () => {
			if (searchTimerRef.current) {
				clearTimeout(searchTimerRef.current);
			}
		};
	}, [query, workspaceId, isOpen]);

	const handleConfirm = useCallback(() => {
		const selected = results[selectedIndex];
		if (selected) {
			onSelectFile(selected.path);
			onClose();
		}
	}, [results, selectedIndex, onSelectFile, onClose]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setSelectedIndex((prev) => Math.max(prev - 1, 0));
			} else if (e.key === "Enter") {
				e.preventDefault();
				handleConfirm();
			} else if (e.key === "Escape") {
				onClose();
			}
		},
		[results.length, handleConfirm, onClose],
	);

	if (!isOpen) {
		return null;
	}

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
			<div
				className="w-[520px] bg-surface-2 border border-border rounded-lg shadow-2xl overflow-hidden"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center border-b border-border px-3 gap-2">
					<Search size={14} className="text-text-tertiary shrink-0" />
					<input
						ref={inputRef}
						type="text"
						className="flex-1 bg-transparent border-0 outline-none text-sm text-text-primary py-2.5 placeholder:text-text-tertiary"
						placeholder="Search files by name…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
					/>
				</div>
				<div className="max-h-[360px] overflow-y-auto">
					{results.length > 0 ? (
						results.map((result, index) => (
							<button
								key={result.path}
								type="button"
								className={`flex flex-col w-full text-left px-3 py-1.5 text-sm cursor-pointer border-0 ${index === selectedIndex ? "bg-accent/15" : "hover:bg-surface-3"}`}
								onClick={() => {
									onSelectFile(result.path);
									onClose();
								}}
							>
								<span className="flex items-center gap-1.5 text-text-primary">
									<FileTypeIcon name={result.name} size={14} />
									{result.name}
								</span>
								<span className="text-[11px] text-text-tertiary font-mono ml-5 truncate">{result.path}</span>
							</button>
						))
					) : query && !isSearching ? (
						<div className="p-4 text-center text-text-tertiary text-sm">No files found</div>
					) : !query ? (
						<div className="p-4 text-center text-text-tertiary text-sm">Type to search…</div>
					) : null}
				</div>
			</div>
		</div>
	);
}

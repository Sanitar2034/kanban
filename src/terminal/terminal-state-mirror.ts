import serializeAddonModule from "@xterm/addon-serialize";
import headlessTerminalModule from "@xterm/headless";

const { SerializeAddon } = serializeAddonModule as typeof import("@xterm/addon-serialize");
const { Terminal } = headlessTerminalModule as typeof import("@xterm/headless");

const TERMINAL_SCROLLBACK = 10_000;
const SNAPSHOT_CACHE_DEBOUNCE_MS = 200;

export interface TerminalRestoreSnapshot {
	snapshot: string;
	cols: number;
	rows: number;
}

interface TerminalStateMirrorOptions {
	onInputResponse?: (data: string) => void;
}

export class TerminalStateMirror {
	private readonly terminal: InstanceType<typeof Terminal>;
	private readonly serializeAddon = new SerializeAddon();
	private operationQueue: Promise<void> = Promise.resolve();
	private snapshotGeneration = 0;
	private snapshotCacheGeneration = -1;
	private snapshotCache = "";
	private snapshotRefreshTimer: ReturnType<typeof setTimeout> | null = null;
	private snapshotRefreshInFlight = false;
	private disposed = false;

	constructor(cols: number, rows: number, options: TerminalStateMirrorOptions = {}) {
		this.terminal = new Terminal({
			allowProposedApi: true,
			cols,
			rows,
			scrollback: TERMINAL_SCROLLBACK,
		});
		this.terminal.loadAddon(this.serializeAddon);
		this.terminal.onData((data) => {
			options.onInputResponse?.(data);
		});
	}

	applyOutput(chunk: Buffer): void {
		const chunkCopy = new Uint8Array(chunk);
		this.enqueueOperation(
			() =>
				new Promise<void>((resolve) => {
					this.terminal.write(chunkCopy, () => {
						resolve();
					});
				}),
		);
		this.markSnapshotDirty();
	}

	resize(cols: number, rows: number): void {
		if (cols === this.terminal.cols && rows === this.terminal.rows) {
			return;
		}
		this.enqueueOperation(() => {
			this.terminal.resize(cols, rows);
		});
		this.markSnapshotDirty();
	}

	applySerializedSnapshot(snapshot: string, cols: number | null, rows: number | null): void {
		const shouldResize =
			Number.isFinite(cols ?? Number.NaN) &&
			Number.isFinite(rows ?? Number.NaN) &&
			cols !== null &&
			rows !== null &&
			cols > 0 &&
			rows > 0 &&
			(this.terminal.cols !== cols || this.terminal.rows !== rows);
		if (shouldResize) {
			this.enqueueOperation(() => {
				this.terminal.resize(cols, rows);
			});
		}
		if (snapshot.length > 0) {
			this.enqueueOperation(
				() =>
					new Promise<void>((resolve) => {
						this.terminal.write(snapshot, () => {
							resolve();
						});
					}),
			);
		}
		this.markSnapshotDirty();
	}

	async getSnapshot(): Promise<TerminalRestoreSnapshot> {
		await this.ensureSnapshotCacheCurrent();
		return {
			snapshot: this.snapshotCache,
			cols: this.terminal.cols,
			rows: this.terminal.rows,
		};
	}

	dispose(): void {
		this.disposed = true;
		if (this.snapshotRefreshTimer !== null) {
			clearTimeout(this.snapshotRefreshTimer);
			this.snapshotRefreshTimer = null;
		}
		this.terminal.dispose();
	}

	private markSnapshotDirty(): void {
		if (this.disposed) {
			return;
		}
		this.snapshotGeneration += 1;
		this.scheduleSnapshotRefresh();
	}

	private scheduleSnapshotRefresh(): void {
		if (this.disposed || this.snapshotRefreshTimer !== null) {
			return;
		}
		this.snapshotRefreshTimer = setTimeout(() => {
			this.snapshotRefreshTimer = null;
			void this.refreshSnapshotCache();
		}, SNAPSHOT_CACHE_DEBOUNCE_MS);
	}

	private async refreshSnapshotCache(): Promise<void> {
		if (this.disposed || this.snapshotRefreshInFlight) {
			return;
		}
		this.snapshotRefreshInFlight = true;
		try {
			await this.ensureSnapshotCacheCurrent();
		} finally {
			this.snapshotRefreshInFlight = false;
			if (this.snapshotCacheGeneration !== this.snapshotGeneration) {
				this.scheduleSnapshotRefresh();
			}
		}
	}

	private async ensureSnapshotCacheCurrent(): Promise<void> {
		while (!this.disposed && this.snapshotCacheGeneration !== this.snapshotGeneration) {
			await this.operationQueue.catch(() => undefined);
			const generationAtSerialize = this.snapshotGeneration;
			this.snapshotCache = this.serializeAddon.serialize();
			this.snapshotCacheGeneration = generationAtSerialize;
		}
	}

	private enqueueOperation(operation: () => void | Promise<void>): void {
		this.operationQueue = this.operationQueue
			.catch(() => undefined)
			.then(async () => {
				await operation();
			});
	}
}

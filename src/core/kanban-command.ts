import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export interface RuntimeInvocationContext {
	execPath: string;
	argv: string[];
	execArgv?: string[];
	cwd?: string;
}

type NodeLoaderFlagKind = "import" | "require";

interface LoaderResolutionContext {
	cwd: string;
	requireFromCwd: NodeJS.Require;
}

function resolveLoaderResolutionContext(context: RuntimeInvocationContext): LoaderResolutionContext {
	const cwd = context.cwd ?? process.cwd();
	const requireFromCwd = createRequire(resolve(cwd, "package.json"));
	return {
		cwd,
		requireFromCwd,
	};
}

function normalizeLoaderSpecifier(
	specifier: string,
	kind: NodeLoaderFlagKind,
	context: LoaderResolutionContext,
): string {
	if (!specifier) {
		return specifier;
	}
	if (specifier.startsWith("node:") || specifier.startsWith("data:") || specifier.startsWith("file:")) {
		return specifier;
	}
	if (isAbsolute(specifier)) {
		return kind === "import" ? pathToFileURL(specifier).href : specifier;
	}
	if (specifier.startsWith("./") || specifier.startsWith("../")) {
		const resolved = resolve(context.cwd, specifier);
		return kind === "import" ? pathToFileURL(resolved).href : resolved;
	}
	try {
		const resolved = context.requireFromCwd.resolve(specifier);
		return kind === "import" ? pathToFileURL(resolved).href : resolved;
	} catch {
		return specifier;
	}
}

function normalizeNodeExecArgv(execArgv: string[], context: RuntimeInvocationContext): string[] {
	const output: string[] = [];
	const loaderContext = resolveLoaderResolutionContext(context);
	for (let index = 0; index < execArgv.length; index += 1) {
		const arg = execArgv[index] ?? "";
		if (arg === "--import") {
			const next = execArgv[index + 1];
			if (typeof next === "string") {
				output.push(arg, normalizeLoaderSpecifier(next, "import", loaderContext));
				index += 1;
			} else {
				output.push(arg);
			}
			continue;
		}
		if (arg.startsWith("--import=")) {
			const specifier = arg.slice("--import=".length);
			output.push(`--import=${normalizeLoaderSpecifier(specifier, "import", loaderContext)}`);
			continue;
		}
		if (arg === "--require" || arg === "-r") {
			const next = execArgv[index + 1];
			if (typeof next === "string") {
				output.push(arg, normalizeLoaderSpecifier(next, "require", loaderContext));
				index += 1;
			} else {
				output.push(arg);
			}
			continue;
		}
		if (arg.startsWith("--require=")) {
			const specifier = arg.slice("--require=".length);
			output.push(`--require=${normalizeLoaderSpecifier(specifier, "require", loaderContext)}`);
			continue;
		}
		if (arg.startsWith("-r") && arg.length > 2) {
			const specifier = arg.slice(2);
			output.push(`-r${normalizeLoaderSpecifier(specifier, "require", loaderContext)}`);
			continue;
		}
		output.push(arg);
	}
	return output;
}

function resolveNodeCommandPrefix(context: RuntimeInvocationContext): string[] {
	const execArgv = normalizeNodeExecArgv(context.execArgv ?? [], context);
	if (execArgv.length === 0) {
		return [context.execPath];
	}
	return [context.execPath, ...execArgv];
}

function isLikelyTsxCliEntrypoint(value: string): boolean {
	const normalized = value.replaceAll("\\", "/").toLowerCase();
	if (normalized.endsWith("/tsx") || normalized.endsWith("/tsx.js")) {
		return true;
	}
	return normalized.includes("/tsx/") && normalized.endsWith("/cli.mjs");
}

function looksLikeEntrypointPath(value: string): boolean {
	if (!value) {
		return false;
	}
	if (value.includes("/") || value.includes("\\")) {
		return true;
	}
	if (/\.(?:mjs|cjs|js|ts|mts|cts)$/iu.test(value)) {
		return true;
	}
	return /kanban(?:\.(?:cmd|ps1|exe))?$/iu.test(value);
}

export function resolveKanbanCommandParts(
	context: RuntimeInvocationContext = {
		execPath: process.execPath,
		argv: process.argv,
		execArgv: process.execArgv,
		cwd: process.cwd(),
	},
): string[] {
	const commandPrefix = resolveNodeCommandPrefix(context);
	const entrypoint = context.argv[1];
	if (!entrypoint || !looksLikeEntrypointPath(entrypoint)) {
		return commandPrefix;
	}

	const tsxTarget = context.argv[2];
	if (tsxTarget && isLikelyTsxCliEntrypoint(entrypoint) && looksLikeEntrypointPath(tsxTarget)) {
		return [...commandPrefix, entrypoint, tsxTarget];
	}

	return [...commandPrefix, entrypoint];
}

export function buildKanbanCommandParts(
	args: string[],
	context: RuntimeInvocationContext = {
		execPath: process.execPath,
		argv: process.argv,
		execArgv: process.execArgv,
		cwd: process.cwd(),
	},
): string[] {
	return [...resolveKanbanCommandParts(context), ...args];
}

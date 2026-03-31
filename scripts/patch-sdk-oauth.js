#!/usr/bin/env node
// Patches the Cline SDK's OAuth success HTML to redirect to /auth/finalize.
// Run during Docker build after npm ci.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Resolve path to the compiled SDK bundle.
const sdkPath = resolve(join(__dirname, "..", "node_modules", "@clinebot", "core", "dist", "index.node.js"));

let content;
try {
	content = readFileSync(sdkPath, "utf-8");
} catch (err) {
	console.error("patch-sdk-oauth: could not read SDK file:", sdkPath, err.message);
	process.exit(1);
}

const OLD_CLOSE = "<script>setTimeout(() => window.close(), 3000);</script>";
const OLD_REPLACE = '<script>window.location.replace("/");</script>';
const NEW = '<script>window.location.replace("/auth/finalize");</script>';

let patched = false;

if (content.includes(OLD_CLOSE)) {
	content = content.replace(OLD_CLOSE, NEW);
	patched = true;
	console.log("patch-sdk-oauth: patched la0 (setTimeout close variant)");
}

if (content.includes(OLD_REPLACE)) {
	content = content.replace(OLD_REPLACE, NEW);
	patched = true;
	console.log("patch-sdk-oauth: patched la0 (replace / variant)");
}

if (patched) {
	writeFileSync(sdkPath, content, "utf-8");
	console.log("patch-sdk-oauth: done →", sdkPath);
} else if (content.includes(NEW)) {
	console.log("patch-sdk-oauth: already patched, skipping");
} else {
	// Non-fatal warning — OAuth may still work if la0 was patched another way.
	console.log("patch-sdk-oauth: WARNING — target pattern not found in", sdkPath);
}

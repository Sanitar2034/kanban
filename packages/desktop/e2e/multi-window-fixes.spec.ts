/**
 * E2E tests for multi-window fixes:
 *
 * 1. Onboarding dialog is suppressed when desktop-settings.json has the flag
 * 2. Duplicate overview windows in window-states.json are deduplicated to one
 * 3. Window title reflects the current project name
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { type LaunchedDesktopApp, launchDesktopApp } from "./fixtures";

test.describe("multi-window fixes", () => {
	test.setTimeout(180_000);

	test("onboarding dialog is suppressed when desktop-settings.json marks it shown", async () => {
		const userDataDir = await mkdtemp(join(tmpdir(), "kanban-e2e-onboarding-"));

		try {
			// Pre-seed the desktop-settings.json with onboarding shown flag
			writeFileSync(
				join(userDataDir, "desktop-settings.json"),
				JSON.stringify({ "kanban.onboarding.dialog.shown": "true" }),
				"utf-8",
			);

			let launched: LaunchedDesktopApp | undefined;

			try {
				launched = await launchDesktopApp({ userDataDir });
				const { page } = launched;

				// Wait for the app to load (Backlog column visible means board loaded)
				await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

				// The "Get started" dialog should NOT be visible
				const onboardingDialog = page.getByText("Get started");
				await expect(onboardingDialog).not.toBeVisible({ timeout: 5_000 });
			} finally {
				await launched?.cleanup();
			}
		} finally {
			await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
		}
	});

	test("onboarding dialog shows when desktop-settings.json has no flag", async () => {
		const userDataDir = await mkdtemp(join(tmpdir(), "kanban-e2e-onboarding-show-"));

		try {
			// Don't seed desktop-settings.json — onboarding should show
			let launched: LaunchedDesktopApp | undefined;

			try {
				launched = await launchDesktopApp({ userDataDir });
				const { page } = launched;

				// The "Get started" dialog SHOULD appear
				await expect(page.getByText("Get started")).toBeVisible({ timeout: 30_000 });
			} finally {
				await launched?.cleanup();
			}
		} finally {
			await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
		}
	});

	test("duplicate overview windows in window-states.json are deduplicated to one", async () => {
		const userDataDir = await mkdtemp(join(tmpdir(), "kanban-e2e-dedup-"));

		try {
			// Pre-seed with 3 duplicate overview windows (all projectId: null)
			const duplicateStates = [
				{ x: 100, y: 100, width: 1400, height: 900, isMaximized: false, projectId: null },
				{ x: 200, y: 200, width: 1400, height: 900, isMaximized: false, projectId: null },
				{ x: 300, y: 300, width: 1400, height: 900, isMaximized: false, projectId: null },
			];
			writeFileSync(
				join(userDataDir, "window-states.json"),
				JSON.stringify(duplicateStates),
				"utf-8",
			);
			// Suppress onboarding
			writeFileSync(
				join(userDataDir, "desktop-settings.json"),
				JSON.stringify({ "kanban.onboarding.dialog.shown": "true" }),
				"utf-8",
			);

			let launched: LaunchedDesktopApp | undefined;

			try {
				launched = await launchDesktopApp({ userDataDir });
				const { electronApp, page } = launched;

				await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

				// Check that only 1 window was created (not 3)
				const windowCount = await electronApp.evaluate(({ BrowserWindow }) => {
					return BrowserWindow.getAllWindows().length;
				});

				expect(windowCount).toBe(1);
			} finally {
				await launched?.cleanup();
			}
		} finally {
			await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
		}
	});

	test("closing onboarding persists flag to desktop-settings.json", async () => {
		const userDataDir = await mkdtemp(join(tmpdir(), "kanban-e2e-onboarding-persist-"));

		try {
			// Don't seed — onboarding will show
			let launched: LaunchedDesktopApp | undefined;

			try {
				launched = await launchDesktopApp({ userDataDir });
				const { page } = launched;

				// Wait for onboarding to appear
				await expect(page.getByText("Get started")).toBeVisible({ timeout: 30_000 });

				// Click through the onboarding: Next → Next → Done
				// (or just close it via the X / clicking Done)
				const nextButton = page.getByRole("button", { name: "Next" });
				const doneButton = page.getByRole("button", { name: "Done" });

				// Click Next through all slides until Done appears
				while (await nextButton.isVisible().catch(() => false)) {
					await nextButton.click();
					await page.waitForTimeout(200);
				}

				// Click Done to dismiss
				if (await doneButton.isVisible().catch(() => false)) {
					await doneButton.click();
				}

				// Wait for dialog to close
				await expect(page.getByText("Get started")).not.toBeVisible({ timeout: 5_000 });

				// Verify desktop-settings.json was written with the flag
				await page.waitForTimeout(1_000); // give IPC time to flush
				const settingsPath = join(userDataDir, "desktop-settings.json");
				expect(existsSync(settingsPath)).toBe(true);

				const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
				expect(settings["kanban.onboarding.dialog.shown"]).toBe("true");
			} finally {
				await launched?.cleanup();
			}
		} finally {
			await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
		}
	});

	test("window title includes Kanban prefix once a project is loaded", async () => {
		const userDataDir = await mkdtemp(join(tmpdir(), "kanban-e2e-title-"));

		try {
			// Suppress onboarding
			writeFileSync(
				join(userDataDir, "desktop-settings.json"),
				JSON.stringify({ "kanban.onboarding.dialog.shown": "true" }),
				"utf-8",
			);

			let launched: LaunchedDesktopApp | undefined;

			try {
				launched = await launchDesktopApp({ userDataDir });
				const { electronApp, page } = launched;

				// Wait for the board to fully load
				await expect(page.getByText("Backlog")).toBeVisible({ timeout: 30_000 });

				// Wait for the title to be set by the React effect
				// (document.title is set asynchronously after project loads)
				await page.waitForFunction(
					() => document.title.startsWith("Kanban"),
					{ timeout: 10_000 },
				);

				const title = await electronApp.evaluate(({ BrowserWindow }) => {
					const win = BrowserWindow.getAllWindows()[0];
					return win ? win.getTitle() : null;
				});

				expect(title).toBeTruthy();
				expect(title).toMatch(/^Kanban/);
			} finally {
				await launched?.cleanup();
			}
		} finally {
			await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
		}
	});
});

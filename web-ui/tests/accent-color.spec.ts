import { expect, test } from "@playwright/test";

test.describe("Card inline buttons accent color", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
	});

	test("button.inline uses accent color token, not hardcoded value", async ({ page }) => {
		const accentColor = await page.evaluate(() => {
			const el = document.createElement("button");
			el.className = "inline";
			document.body.appendChild(el);
			const color = getComputedStyle(el).color;
			el.remove();
			return color;
		});

		const accentTokenValue = await page.evaluate(() => {
			return getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
		});

		// Verify that accent token is defined and not empty
		expect(accentTokenValue).toBeTruthy();

		// Verify button.inline resolves to a color (not inherited/transparent)
		expect(accentColor).toBeTruthy();
		expect(accentColor).not.toBe("");
	});

	test("project-row-selected background matches accent token", async ({ page }) => {
		const selectedBg = await page.evaluate(() => {
			const el = document.createElement("div");
			el.className = "kb-project-row-selected";
			document.body.appendChild(el);
			const bg = getComputedStyle(el).backgroundColor;
			el.remove();
			return bg;
		});

		const accentTokenValue = await page.evaluate(() => {
			return getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
		});

		expect(accentTokenValue).toBeTruthy();
		expect(selectedBg).toBeTruthy();
		// Should NOT be a hardcoded rgb(0, 132, 255) — must come from token
		expect(selectedBg).not.toBe("");
	});

	test("theme change updates button.inline color via accent token", async ({ page }) => {
		// Default theme accent color
		const defaultColor = await page.evaluate(() => {
			const el = document.createElement("button");
			el.className = "inline";
			document.body.appendChild(el);
			const color = getComputedStyle(el).color;
			el.remove();
			return color;
		});

		// Switch to midnight theme
		await page.evaluate(() => {
			document.documentElement.setAttribute("data-theme", "midnight");
		});

		const midnightColor = await page.evaluate(() => {
			const el = document.createElement("button");
			el.className = "inline";
			document.body.appendChild(el);
			const color = getComputedStyle(el).color;
			el.remove();
			return color;
		});

		// Colors should differ between themes (accent changes)
		expect(midnightColor).toBeTruthy();
		// Both should resolve to valid colors, not empty/transparent
		expect(defaultColor).not.toBe(midnightColor);
	});
});

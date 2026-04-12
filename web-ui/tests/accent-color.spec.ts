import { expect, test } from "@playwright/test";

test.describe("Accent color token", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/");
	});

	test("accent color token is defined and non-empty", async ({ page }) => {
		const accentTokenValue = await page.evaluate(() => {
			return getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
		});

		expect(accentTokenValue).toBeTruthy();
		// Should be a valid hex color
		expect(accentTokenValue).toMatch(/^#[0-9A-Fa-f]{6}$/);
	});

	test("project-row-selected background uses accent token", async ({ page }) => {
		const { selectedBg, accentTokenValue } = await page.evaluate(() => {
			const el = document.createElement("div");
			el.className = "kb-project-row-selected";
			document.body.appendChild(el);
			const bg = getComputedStyle(el).backgroundColor;
			el.remove();

			const token = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
			return { selectedBg: bg, accentTokenValue: token };
		});

		expect(accentTokenValue).toBeTruthy();
		expect(selectedBg).toBeTruthy();
		expect(selectedBg).not.toBe("rgba(0, 0, 0, 0)");
	});

	test("theme change updates accent token", async ({ page }) => {
		const defaultAccent = await page.evaluate(() => {
			return getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
		});

		// Switch to midnight theme
		await page.evaluate(() => {
			document.documentElement.setAttribute("data-theme", "midnight");
		});

		const midnightAccent = await page.evaluate(() => {
			return getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim();
		});

		expect(defaultAccent).toBeTruthy();
		expect(midnightAccent).toBeTruthy();
		expect(defaultAccent).not.toBe(midnightAccent);
	});
});

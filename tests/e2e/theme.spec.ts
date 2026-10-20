import { expect, test } from "@playwright/test";

const bg = () => getComputedStyle(document.body).backgroundColor;

test("light and dark themes follow prefers-color-scheme", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const light = await page.evaluate(bg);
  await page.emulateMedia({ colorScheme: "dark" });
  const dark = await page.evaluate(bg);
  expect(light).toBe("rgb(255, 255, 255)");
  expect(dark).not.toBe(light);
});

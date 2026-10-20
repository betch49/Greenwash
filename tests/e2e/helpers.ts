import type { APIRequestContext, Page } from "@playwright/test";

export async function runCount(request: APIRequestContext): Promise<number> {
  const res = await request.get("/api/runs/count");
  if (!res.ok()) throw new Error(`runs count route returned ${res.status()}`);
  return (await res.json()).count as number;
}

export async function search(page: Page, brand: string): Promise<void> {
  await page.goto("/");
  const box = page.getByLabel("Brand name");
  await box.fill(brand);
  await box.press("Enter");
}

import { test, expect } from "@playwright/test";
test("packaged backend serves a self-contained Persian UI", async ({
  page,
  request,
}) => {
  const base = process.env.PACKAGED_URL;
  test.skip(!base, "Set PACKAGED_URL to a running bundled backend");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base!);
  await expect(
    page.getByRole("button", { name: "جلسه جدید", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "جلسه جدید", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ذخیره و پردازش جلسه" }),
  ).toBeDisabled();
  const health = await request.get(base + "/api/health");
  expect(health.ok()).toBeTruthy();
  expect((await health.json()).ffmpeg).toBeTruthy();
  expect(errors).toEqual([]);
  await page.screenshot({ path: "artifacts/ui-packaged.png", fullPage: true });
});

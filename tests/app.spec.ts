import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  let settings = { vocabulary: "CRO, CVR", delete_audio: false };
  await page.route("**/api/settings", (route) => {
    if (route.request().method() === "PUT")
      settings = route.request().postDataJSON();
    return route.fulfill({ json: settings });
  });
});

const fixture = () => ({
  id: "test-meeting",
  title: "برنامه‌ریزی محصول",
  started_at: "2026-09-20T09:00:00Z",
  duration: 120,
  status: "ready",
  audio_path: null,
  error: null,
  segments: [
    {
      start: 0,
      end: 10,
      text: "علی: دیتای سه ماه اخیر را تا دوشنبه آماده می‌کنم.",
    },
  ],
  intelligence: {
    summary: "تیم درباره نرخ تبدیل صفحه رستوران گفتگو کرد.",
    decisions: ["کاربران جدید و قدیمی جداگانه تحلیل شوند."],
    actions: [
      {
        description: "استخراج دیتای سه ماه اخیر",
        owner: "علی",
        deadline: "دوشنبه",
        done: false,
      },
    ],
    questions: ["علت افت نرخ تبدیل چیست؟"],
    topics: ["Conversion Rate"],
  },
});

test("empty state, settings persistence, and mobile layout", async ({
  page,
}) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({
      json: { ready: true, ffmpeg: true, ollama: true, model_ready: true },
    }),
  );
  await page.route("**/api/meetings", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await expect(page.getByText("جای اولین جلسه‌تان اینجاست")).toBeVisible();
  await page.screenshot({ path: "artifacts/ui-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "تنظیمات", exact: true }).click();
  await page.locator("textarea").fill("Checkout, تیم محصول");
  await page.getByLabel("حذف فایل صوتی پس از پیاده‌سازی موفق").check();
  await page.getByRole("button", { name: "ذخیره تنظیمات" }).click();
  await page.reload();
  await page.getByRole("button", { name: "تنظیمات", exact: true }).click();
  await expect(page.locator("textarea")).toHaveValue("Checkout, تیم محصول");
  await expect(
    page.getByLabel("حذف فایل صوتی پس از پیاده‌سازی موفق"),
  ).toBeChecked();
  await page.getByRole("button", { name: "بستن", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "ساخت اولین جلسه" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({ path: "artifacts/ui-mobile.png", fullPage: true });
});

test("meeting navigation, task update, search, and export", async ({
  page,
}) => {
  const m = fixture();
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { ready: true } }),
  );
  await page.route("**/api/meetings", (route) => route.fulfill({ json: [m] }));
  await page.route("**/api/meetings/test-meeting/actions/0", (route) => {
    m.intelligence.actions[0].done = route.request().postDataJSON().done;
    return route.fulfill({ json: m });
  });
  await page.goto("/");
  await page.getByPlaceholder("جستجو در عنوان و متن جلسه‌ها...").fill("علی");
  await page.getByRole("button", { name: /برنامه‌ریزی محصول/ }).click();
  await expect(page.getByText(m.intelligence.summary)).toBeVisible();
  await page.getByRole("button", { name: "متن کامل", exact: true }).click();
  await expect(page.getByText(m.segments[0].text)).toBeVisible();
  await page.getByRole("button", { name: "تصمیم‌ها", exact: true }).click();
  await expect(page.getByText(m.intelligence.decisions[0])).toBeVisible();
  await page.getByRole("button", { name: "کارها", exact: true }).click();
  await page.getByRole("checkbox").check();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.screenshot({ path: "artifacts/ui-tasks.png", fullPage: true });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "دریافت متن" }).click();
  const exported = await download;
  expect(exported.suggestedFilename()).toMatch(/محصول\.md$/);
  const stream = await exported.createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  expect(Buffer.concat(chunks).toString("utf8")).toContain(
    "- [x] استخراج دیتای سه ماه اخیر",
  );
});

test("delete all meetings requires confirmation and clears the list", async ({
  page,
}) => {
  let meetings = [fixture()];
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { ready: true } }),
  );
  await page.route("**/api/meetings", (route) => {
    if (route.request().method() === "DELETE") {
      meetings = [];
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: meetings });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "حذف همه" }).click();
  const confirmation = page.getByRole("dialog", {
    name: "تأیید حذف همه جلسات",
  });
  await expect(confirmation).toContainText("قابل بازگشت نیست");
  await confirmation.getByRole("button", { name: "بله، همه حذف شوند" }).click();
  await expect(page.getByText("جای اولین جلسه‌تان اینجاست")).toBeVisible();
  await expect(page.getByRole("button", { name: "حذف همه" })).toHaveCount(0);
});

test("microphone capture produces uploadable audio", async ({ page }) => {
  let uploaded = false;
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { ready: true } }),
  );
  await page.route("**/api/meetings", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataBuffer();
      expect(body?.length).toBeGreaterThan(1000);
      uploaded = true;
      return route.fulfill({ status: 201, json: fixture() });
    }
    return route.fulfill({ json: uploaded ? [fixture()] : [] });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "جلسه جدید", exact: true }).click();
  await page
    .getByPlaceholder("مثلاً: برنامه‌ریزی هفتگی محصول")
    .fill("ضبط آزمایشی");
  await page.getByRole("button", { name: "شروع ضبط", exact: true }).click();
  await expect(page.getByText("در حال ضبط صدا…")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "بستن", exact: true }),
  ).toBeDisabled();
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "توقف و ذخیره ضبط" }).click();
  await expect(page.getByText("meeting.webm")).toBeVisible();
  await page.getByRole("button", { name: "ذخیره و پردازش جلسه" }).click();
  await expect(
    page.getByRole("heading", { name: "برنامه‌ریزی محصول" }),
  ).toBeVisible();
  expect(uploaded).toBeTruthy();
});

test("audio file upload reports backend errors inside the dialog", async ({
  page,
}) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { ready: true } }),
  );
  await page.route("**/api/meetings", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 413,
          json: { detail: "Audio must be smaller than 250 MB" },
        })
      : route.fulfill({ json: [] }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "جلسه جدید", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "meeting.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("test audio"),
  });
  await page.getByRole("button", { name: "ذخیره و پردازش جلسه" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "250 MB",
  );
  await expect(
    page.getByRole("button", { name: "ذخیره و پردازش جلسه" }),
  ).toBeEnabled();
});

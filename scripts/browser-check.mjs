import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const base = "http://127.0.0.1:3000";
await mkdir(".local", { recursive: true });
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: true,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const { events } = await (await fetch(`${base}/api/events`)).json();
const escape = events.find((event) => event.source === "escape");
const scrap = events.find((event) => event.source === "scrap");
assert(escape && scrap);
async function settled() {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    [...document.images].every((img) => img.complete),
  );
}
try {
  await page.goto(base);
  await page.getByRole("heading", { name: "公演スケジュール" }).waitFor();
  await page.locator("tbody tr").first().waitFor();
  assert.equal(await page.locator("tbody tr").count(), 2);
  assert.equal(await page.locator(".date-heading").count(), 30);
  await settled();
  assert(
    await page
      .locator(".poster img")
      .evaluateAll((images) => images.every((image) => image.naturalWidth > 0)),
  );
  await page.screenshot({ path: ".local/desktop-month.png", fullPage: true });

  await page.getByRole("textbox", { name: "公演を検索" }).fill("空空");
  assert.equal(await page.locator("tbody tr").count(), 1);
  await page.getByRole("textbox", { name: "公演を検索" }).fill("");
  await page.goto(`${base}/events/${escape.id}`);
  await page
    .getByRole("heading", { name: escape.title, exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "11月13日(金) 2回", exact: true })
    .click();
  assert.equal(await page.locator(".session-row").count(), 2);
  assert(
    await page
      .locator(".session-row")
      .first()
      .textContent()
      .then((value) => value.includes("販売期間外")),
  );
  await settled();
  await page.screenshot({ path: ".local/desktop-detail.png", fullPage: true });

  const selectedId = escape.sessions.find(
    (s) => s.start === "2026-11-13T07:00:00.000Z",
  ).id;
  const original = escape.sessions.find((s) => s.id === selectedId).reserved;
  const originalStatus = escape.status;
  const checkbox = page.locator(".session-row").first().getByRole("checkbox");
  await checkbox.click();
  await page.waitForFunction(
    async ({ base, id, slot, value }) => {
      const data = await (await fetch(`${base}/api/events`)).json();
      return (
        data.events.find((e) => e.id === id).sessions.find((s) => s.id === slot)
          .reserved === value
      );
    },
    { base, id: escape.id, slot: selectedId, value: !original },
  );
  await page.reload();
  await page.locator(".session-row").first().waitFor();
  assert.equal(
    await page
      .locator(".session-row")
      .first()
      .getByRole("checkbox")
      .isChecked(),
    !original,
  );
  await page.locator(".session-row").first().getByRole("checkbox").click();
  await page.waitForFunction(
    async ({ base, id, slot, value }) => {
      const data = await (await fetch(`${base}/api/events`)).json();
      return (
        data.events.find((e) => e.id === id).sessions.find((s) => s.id === slot)
          .reserved === value
      );
    },
    { base, id: escape.id, slot: selectedId, value: original },
  );
  const restore = await fetch(`${base}/api/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "status",
      id: escape.id,
      status: originalStatus,
    }),
  });
  assert.equal(restore.status, 200);

  await page.goto(`${base}/day?date=2026-09-30`);
  await page.locator(".time-block").first().waitFor();
  assert.equal(await page.locator(".time-block").count(), 3);
  await page.locator(".time-block").first().click();
  assert.equal(await page.locator(".day-detail .session-row").count(), 3);
  await page.screenshot({ path: ".local/desktop-day.png", fullPage: true });

  await page.goto(`${base}/register`);
  await page.getByLabel("公演ページのURL").fill("https://example.com/test");
  await page.getByRole("button", { name: "登録する", exact: true }).click();
  await page.locator(".notice.error").waitFor();
  assert(
    (await page.locator(".notice.error").textContent()).includes(
      "対応しています",
    ),
  );
  assert.equal(
    (await (await fetch(`${base}/api/events`)).json()).events.length,
    2,
  );

  await page
    .getByLabel("公演ページのURL")
    .fill(escape.url + "?utm_source=verification");
  await page.getByRole("button", { name: "登録する", exact: true }).click();
  await page
    .getByRole("heading", { name: escape.title, exact: true })
    .waitFor();
  assert.equal(
    (await (await fetch(`${base}/api/events`)).json()).events.length,
    2,
  );
  await page
    .getByRole("button", { name: "空き状況を更新", exact: true })
    .click();
  await page.locator(".notice.error").waitFor();
  assert(
    (await page.locator(".notice.error").textContent()).includes(
      "間隔をあけて",
    ),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route, name] of [
    ["/", "month"],
    [`/events/${escape.id}`, "detail"],
    ["/day?date=2026-09-30", "day"],
    ["/register", "register"],
  ]) {
    await page.goto(base + route);
    await page.locator("main h1").waitFor();
    await settled();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    assert.equal(overflow, false, `body overflow on ${name}`);
    await page.screenshot({
      path: `.local/mobile-${name}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        "real images",
        "30-day columns",
        "search",
        "event calendar",
        "purchase persistence and restoration",
        "day timeline",
        "URL validation",
        "live URL import without duplicates and refresh cooldown",
        "four mobile views without page overflow",
        "no browser runtime errors",
      ],
    }),
  );
} finally {
  await browser.close();
}

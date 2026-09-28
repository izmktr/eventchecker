import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSourceUrl } from "../lib/sources";
import { parseMysteryCircusInfo, parseMysteryCircusSessions } from "../lib/mystery-circus";

test("TMC URLs preserve product identity and discard tracking and selected sessions", () => {
  assert.equal(normalizeSourceUrl("https://ticket.mysterycircus.jp/index.php?dispatch=products.view&product_id=596&time_id=123&utm_source=test").href,
    "https://ticket.mysterycircus.jp/index.php?dispatch=products.view&product_id=596");
  for (const url of ["https://ticket.mysterycircus.jp/index.php?dispatch=products.buy_now&product_id=596",
    "https://ticket.mysterycircus.jp/index.php?dispatch=products.view&product_id=596&product_id=597",
    "https://ticket.mysterycircus.jp.evil.test/index.php?dispatch=products.view&product_id=596"])
    assert.throws(() => normalizeSourceUrl(url));
});

test("TMC info validates identity and extracts advertised duration", () => {
  const html = `<h1 class="ty-product-block-title">Test</h1><input id="product_id" value="596">
    <meta name="description" content="所要時間：約25分"><select id="option_596_date"><option value="">選択</option><option value="123">2026/10/09</option></select>`;
  const info = parseMysteryCircusInfo(html, "596");
  assert.deepEqual(info.dates, ["2026-10-09"]);
  assert.equal(info.durationMinutes, 25);
  assert.throws(() => parseMysteryCircusInfo(html, "597"));
});

test("TMC sessions preserve slot identity and distinguish sold out, closed and unknown", () => {
  const labels = ["残席あり", "残席残りわずか", "残席なし", "販売終了", "新しい表記"];
  const html = `<ul id="list-schedule">${labels.map((label, i) => `<li class="schedule-item-event-time-list-item"><a href="?dispatch=products.view&product_id=596&time_id=${i + 1}&venue_id=10"><p>11:50 ∼</p><p class="svg-icon-text">${label}</p></a></li>`).join("")}</ul>`;
  const sessions = parseMysteryCircusSessions(html, "2026-10-09", "596", "Tokyo", 25, "now");
  assert.deepEqual(sessions.map(s => s.availability), ["available", "few", "full", "closed", "unknown"]);
  assert.equal(sessions[0].start, "2026-10-09T02:50:00.000Z");
  assert.equal(sessions[0].end, "2026-10-09T03:15:00.000Z");
  assert.equal(sessions[0].id, "596:2026-10-09T02:50:00.000Z");
  const upcoming = html.replaceAll(/href="[^"]*"/g, 'href=""').replaceAll(/<p class="svg-icon-text">[^<]*<\/p>/g, '<p class="svg-icon-text">準備中</p>');
  const prepared = parseMysteryCircusSessions(upcoming, "2026-10-09", "596", "Tokyo", 25, "now");
  assert.equal(prepared[0].availability, "closed");
  assert.equal(prepared[0].id, sessions[0].id);
  assert.throws(() => parseMysteryCircusSessions(html.replaceAll("product_id=596", "product_id=597"), "2026-10-09", "596", "Tokyo", null, "now"));
  assert.throws(() => parseMysteryCircusSessions("unexpected", "2026-10-09", "596", "Tokyo", null, "now"));
});

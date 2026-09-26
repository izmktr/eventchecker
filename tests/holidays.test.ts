import assert from "node:assert/strict";
import test from "node:test";
import { loadHolidays } from "../lib/holiday-data";
import { calendarDayClass } from "../lib/holidays";

test("holiday CSV is decoded and dates are normalized", () => {
  const holidays = loadHolidays();
  assert.equal(holidays["2026-10-12"], "スポーツの日");
  assert.equal(holidays["2026-09-22"], "休日");
  assert.equal(holidays["2027-03-22"], "休日");
  assert.equal(holidays["2027-11-23"], "勤労感謝の日");
});

test("Sundays and holidays take precedence over Saturdays", () => {
  const holidays = loadHolidays();
  assert.equal(calendarDayClass("2026-09-26", holidays), "saturday-background");
  assert.equal(calendarDayClass("2026-09-27", holidays), "holiday-background");
  assert.equal(calendarDayClass("2026-10-12", holidays), "holiday-background");
  assert.equal(calendarDayClass("2026-09-28", holidays), "");
  assert.equal(calendarDayClass("2024-05-04", holidays), "holiday-background");
});

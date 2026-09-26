import test from "node:test";
import assert from "node:assert/strict";
import { scheduleRows } from "../lib/schedule";
import type { EventRecord } from "../lib/types";

function event(id: string, dates: string[]): EventRecord {
  return {
    id,
    source: "escape",
    sourceKey: id,
    url: "https://escape.id/test-org/e-test/",
    title: id,
    organizer: "Test",
    venue: "Tokyo",
    durationMinutes: null,
    durationLabel: "未取得",
    imageUrl: null,
    checkedAt: "",
    warning: null,
    status: "unpurchased",
    sessions: dates.map((start, index) => ({
      id: `${id}-${index}`,
      start,
      end: null,
      venue: "Tokyo",
      availability: "available",
      rawAvailability: "空席あり",
      url: "",
      checkedAt: "",
      active: true,
      reserved: false,
    })),
  };
}

test("30-day rows sort by first visible date, then next future date, then latest past date", () => {
  const input = [
    event("past-old", ["2026-07-01T00:00:00Z"]),
    event("future-later", ["2026-12-01T00:00:00Z"]),
    event("in-later", ["2026-01-01T00:00:00Z", "2026-10-20T00:00:00Z"]),
    event("past-recent", ["2026-09-30T00:00:00Z"]),
    event("future-gap", ["2026-08-01T00:00:00Z", "2026-11-13T00:00:00Z"]),
    event("in-first", ["2026-10-02T00:00:00Z"]),
  ];
  const original = input.map((e) => e.id);
  const rows = scheduleRows(input, "2026-10-01");
  assert.deepEqual(
    rows.map((r) => r.event.id),
    [
      "in-first",
      "in-later",
      "future-gap",
      "future-later",
      "past-recent",
      "past-old",
    ],
  );
  assert.equal(rows[2].kind, "future");
  assert.equal(rows[2].date, "2026-11-13");
  assert.deepEqual(
    input.map((e) => e.id),
    original,
  );
});

test("the 30-day range is inclusive and uses Japanese dates", () => {
  const rows = scheduleRows(
    [
      event("last", ["2026-10-30T14:59:00Z"]),
      event("after", ["2026-10-30T15:00:00Z"]),
      event("first", ["2026-09-30T15:00:00Z"]),
    ],
    "2026-10-01",
  );
  assert.deepEqual(
    rows.map((r) => [r.event.id, r.kind]),
    [
      ["first", "scheduled"],
      ["last", "scheduled"],
      ["after", "future"],
    ],
  );
});

test("changing the displayed range reclassifies runs and unknown schedules are not marked ended", () => {
  const upcoming = event("event", ["2026-11-13T00:00:00Z"]);
  assert.equal(scheduleRows([upcoming], "2026-10-01")[0].kind, "future");
  assert.equal(scheduleRows([upcoming], "2026-11-01")[0].kind, "scheduled");
  assert.equal(scheduleRows([upcoming], "2026-12-01")[0].kind, "past");
  assert.equal(
    scheduleRows([event("empty", [])], "2026-10-01")[0].kind,
    "unknown",
  );
  upcoming.sessions[0].active = false;
  assert.equal(scheduleRows([upcoming], "2026-10-01")[0].kind, "unknown");
  upcoming.sessions[0].reserved = true;
  assert.equal(scheduleRows([upcoming], "2026-10-01")[0].kind, "future");
});

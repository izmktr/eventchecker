import test from "node:test";
import assert from "node:assert/strict";
import { dayScheduleRows, scheduleRows } from "../lib/schedule";
import { availableSessionCount } from "../lib/dates";
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

test("remaining counts include only active available and few sessions", () => {
  const sample = event("mixed", Array(7).fill("2026-10-01T01:00:00Z"));
  const states = ["available", "few", "full", "closed", "pending", "unknown", "available"] as const;
  sample.sessions.forEach((session, i) => { session.availability = states[i]; });
  sample.sessions[6].active = false;
  sample.sessions[6].reserved = true;
  assert.equal(availableSessionCount(sample.sessions), 2);
  assert.equal(availableSessionCount([]), 0);
});

test("day rows prioritize remaining sessions on the selected day without mutating input", () => {
  const full = event("full", ["2026-10-01T01:00:00Z"]);
  full.sessions[0].availability = "full";
  const one = event("one", ["2026-10-01T02:00:00Z", "2026-10-02T02:00:00Z"]);
  one.sessions[0].availability = "few";
  const two = event("two", ["2026-10-01T03:00:00Z", "2026-10-01T04:00:00Z"]);
  const next = event("next", ["2026-10-02T01:00:00Z"]);
  const input = [full, one, two, next];
  assert.deepEqual(dayScheduleRows(input, "2026-10-01").map((r) => [r.event.id, r.available]),
    [["two", 2], ["one", 1], ["full", 0]]);
  assert.deepEqual(input.map((e) => e.id), ["full", "one", "two", "next"]);
});

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

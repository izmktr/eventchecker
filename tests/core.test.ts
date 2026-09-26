import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../lib/store";
import { addDays, dateKey, validDate } from "../lib/dates";
import {
  normalizeSourceUrl,
  escapeAvailability,
  scrapAvailability,
  parseScrapInfo,
  parseEscapeInfo,
} from "../lib/sources";
import type { ImportedEvent } from "../lib/types";
import { isLocalRequest } from "../lib/request-policy";

test("local browser origins are accepted while cross-site and nonlocal hosts are rejected", () => {
  assert.equal(
    isLocalRequest(
      new Headers({ host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" }),
    ),
    true,
  );
  assert.equal(
    isLocalRequest(
      new Headers({ host: "localhost:3000", origin: "http://localhost:3000" }),
    ),
    true,
  );
  assert.equal(
    isLocalRequest(
      new Headers({ host: "localhost:3000", origin: "http://localhost:3001" }),
    ),
    false,
  );
  assert.equal(
    isLocalRequest(
      new Headers({ host: "localhost:3000", origin: "https://example.com" }),
    ),
    false,
  );
  assert.equal(
    isLocalRequest(
      new Headers({ host: "evil.test:3000", origin: "http://evil.test:3000" }),
    ),
    false,
  );
  assert.equal(
    isLocalRequest(
      new Headers({ host: "127.0.0.1:3000", "sec-fetch-site": "cross-site" }),
    ),
    false,
  );
});

test("only supported HTTPS event URLs are accepted and tracking is removed", () => {
  assert.equal(
    normalizeSourceUrl(
      "https://scrapticket.jp/events/show/P882489650?utm_source=x#top",
    ).href,
    "https://scrapticket.jp/events/show/P882489650",
  );
  assert.equal(
    normalizeSourceUrl("https://escape.id/karakara-org/e-meguru").href,
    "https://escape.id/karakara-org/e-meguru/",
  );
  for (const url of [
    "http://escape.id/karakara-org/e-meguru/",
    "https://localhost/events/show/P1",
    "https://scrapticket.jp.evil.test/events/show/P1",
    "https://user:pass@scrapticket.jp/events/show/P1",
    "https://scrapticket.jp:8080/events/show/P1",
    "https://scrapticket.jp/auth/login",
  ]) {
    assert.throws(() => normalizeSourceUrl(url));
  }
});

test("dates use Japan's calendar even when the UTC date differs", () => {
  assert.equal(dateKey("2026-09-30T16:00:00Z"), "2026-10-01");
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(validDate("2026-13-01"), false);
  assert.equal(validDate("2028-02-29"), true);
});

test("unknown and off-sale availability never become sold out", () => {
  assert.deepEqual(escapeAvailability("NOT_IN_SALES_PERIOD"), {
    availability: "closed",
    rawAvailability: "販売期間外",
  });
  assert.equal(escapeAvailability("NEW_STATUS").availability, "unknown");
  assert.equal(escapeAvailability("FULL_PENDING").availability, "pending");
  assert.equal(escapeAvailability("FEW", 2).rawAvailability, "残り2席");
  assert.deepEqual(scrapAvailability("○ 12:30"), {
    availability: "available",
    rawAvailability: "○",
  });
  assert.equal(scrapAvailability("△ 19:00").availability, "few");
  assert.equal(scrapAvailability("× 10:00").availability, "full");
  assert.equal(scrapAvailability("受付前 10:00").availability, "closed");
  assert.equal(scrapAvailability("新しい表記 10:00").availability, "unknown");
});

test("source parsers fail visibly on changed markup and never execute embedded JavaScript", () => {
  assert.throws(() => parseEscapeInfo("<html>Login</html>"));
  assert.throws(
    () =>
      parseScrapInfo(
        "<script>window.__INITIAL_DATA__ = (() => { throw Error('executed'); })();</script>",
      ),
    SyntaxError,
  );
  assert.throws(() =>
    parseScrapInfo(
      '<script>window.__INITIAL_DATA__ = {"unexpected":true};</script>',
    ),
  );
});

function fixture(): ImportedEvent {
  return {
    source: "escape",
    sourceKey: "example-1",
    url: "https://escape.id/test-org/e-test/",
    title: "Test event",
    organizer: "Test",
    venue: "Tokyo",
    durationLabel: "120分",
    durationMinutes: 120,
    imageUrl: null,
    checkedAt: "2026-09-26T01:00:00.000Z",
    warning: null,
    complete: true,
    coverageFrom: "2026-10-01",
    coverageTo: "2026-10-31",
    sessions: [
      {
        id: "slot-1",
        start: "2026-10-01T10:00:00.000Z",
        end: "2026-10-01T12:00:00.000Z",
        venue: "Tokyo",
        availability: "available",
        rawAvailability: "空席あり",
        url: "https://escape.id/test-org/e-test/?u=slot-1",
        checkedAt: "2026-09-26T01:00:00.000Z",
        active: true,
        reserved: false,
      },
    ],
  };
}

test("refresh upserts the event without losing purchases; disappearance preserves the booked session", () => {
  const store = createStore(":memory:");
  try {
    const id = store.save(fixture());
    store.reserve(id, "slot-1", true);
    assert.throws(() => store.setStatus(id, "ignored"));
    const update = fixture();
    update.sessions[0].availability = "full";
    update.sessions[0].rawAvailability = "売り切れ";
    assert.equal(store.save(update), id);
    assert.equal(store.list().length, 1);
    assert.equal(store.list()[0].sessions[0].reserved, true);
    assert.equal(store.list()[0].sessions[0].availability, "full");
    assert.equal(store.list()[0].status, "purchased");
    store.save({ ...update, sessions: [] });
    assert.equal(store.list()[0].sessions[0].active, false);
    assert.equal(store.list()[0].sessions[0].reserved, true);
    store.reserve(id, "slot-1", false);
    assert.equal(store.list()[0].status, "unpurchased");
    store.remove(id);
    assert.deepEqual(store.list(), []);
  } finally {
    store.close();
  }
});

test("failed and partial refreshes retain previous slots and expose the error", () => {
  const store = createStore(":memory:");
  try {
    const id = store.save(fixture());
    store.recordError(id, "Network failure");
    assert.equal(store.list()[0].sessions[0].active, true);
    assert.match(store.list()[0].warning || "", /前回の情報/);
    store.save({ ...fixture(), complete: false, sessions: [] });
    assert.equal(store.list()[0].sessions[0].active, true);
    assert.equal(store.list()[0].warning, null);
    assert.throws(() => store.reserve(id, "nonexistent-slot", true));
  } finally {
    store.close();
  }
});

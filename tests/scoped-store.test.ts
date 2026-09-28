import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseStore } from "../lib/supabase-store";
import { createStore } from "../lib/store";
import type { ImportedEvent } from "../lib/types";

test("SQLite reads one event and its URL without including other events", () => {
  const store = createStore(":memory:");
  const sample: ImportedEvent = { source: "escape", sourceKey: "a", title: "A", url: "https://escape.id/a-org/e-a/",
    organizer: "A", venue: "A", durationLabel: "", durationMinutes: null, imageUrl: null, checkedAt: "", warning: null,
    sessions: [], complete: false, coverageFrom: "2026-10-01", coverageTo: "2026-10-01" };
  try {
    const id = store.save(sample);
    store.save({ ...sample, sourceKey: "b", title: "B" });
    assert.equal(store.get(id)?.title, "A");
    assert.equal(store.getSourceUrl(id), sample.url);
    assert.equal(store.get("missing"), null);
    assert.equal(store.getSourceUrl("missing"), null);
    assert.equal(store.list().length, 2);
  } finally { store.close(); }
});

test("Supabase scoped read paginates large events and preserves one-to-one purchase relations", async () => {
  const ranges: number[] = [];
  const client = { from(table: string) {
    let selection = "";
    return {
      select(value: string) { selection = value; return this; },
      eq(key: string, value: string) {
        assert.equal(value, "chosen");
        assert.equal(key, table === "eventchecker_events" ? "id" : "event_id");
        return this;
      },
      async maybeSingle() {
        assert.equal(table, "eventchecker_events");
        return { data: selection === "data->>url" ? { url: "https://example.com" } : {
          id: "chosen", data: { title: "Chosen", warning: null }, last_error: "Warning",
          eventchecker_user_events: { status: "purchased" },
        }, error: null };
      },
      order(key: string) { assert.equal(key, "id"); return this; },
      async range(from: number, to: number) {
        assert.equal(table, "eventchecker_sessions");
        assert.equal(to - from, 499);
        ranges.push(from);
        return { data: Array.from({ length: Math.min(500, 1201 - from) }, (_, i) => ({
          data: { id: String(from + i), start: "2026-10-01T00:00:00Z", reserved: false },
          active: true, eventchecker_reservations: from + i === 1200 ? { session_id: "1200" } : null,
        })), error: null };
      },
    };
  } } as unknown as SupabaseClient;
  const store = createSupabaseStore(client);
  const event = await store.get("chosen");
  assert.equal(event?.sessions.length, 1201);
  assert.equal(event?.status, "purchased");
  assert.equal(event?.warning, "Warning");
  assert.equal(event?.sessions.filter(s => s.reserved).length, 1);
  assert.deepEqual(ranges, [0, 500, 1000]);
  assert.equal(await store.getSourceUrl("chosen"), "https://example.com");
  assert.deepEqual(ranges, [0, 500, 1000]);
});

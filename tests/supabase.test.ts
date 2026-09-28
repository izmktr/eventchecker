import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("Supabase SQL transactions and row-level access policies", async () => {
  const db = new PGlite();
  const owner = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  const denied = "33333333-3333-4333-8333-333333333333";
  const payload = {
    id: "event-1",
    source: "escape",
    sourceKey: "test",
    title: "Test",
    complete: true,
    coverageFrom: "2026-10-01",
    coverageTo: "2026-10-31",
    sessions: [
      {
        id: "slot",
        start: "2026-10-01T01:00:00Z",
        active: true,
        reserved: false,
      },
    ],
  };
  async function asUser(id: string) {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [
      id,
    ]);
    await db.exec("set role authenticated");
  }
  async function command(action: string, data: object = {}) {
    const result = await db.query<{ result: unknown }>(
      "select public.eventchecker_command($1,$2::jsonb) as result",
      [action, JSON.stringify(data)],
    );
    return result.rows[0].result;
  }
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key, email text);
      grant usage on schema auth to anon,authenticated;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      insert into auth.users values ('${owner}','owner@example.com'),('${other}','other@example.com'),('${denied}','denied@example.com');`);
    const schema = readFileSync(
      new URL("../supabase/schema.sql", import.meta.url),
      "utf8",
    );
    await db.exec(schema);
    await db.exec(schema);
    await db.exec("alter table public.eventchecker_events drop constraint eventchecker_events_source_check; alter table public.eventchecker_events add constraint eventchecker_events_source_check check (source in ('escape', 'scrap'))");
    const migration = readFileSync(new URL("../supabase/migrations/20260928_add_tmc.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    await db.query("insert into public.eventchecker_members values ($1),($2)", [
      owner,
      other,
    ]);
    await db.exec("set role anon");
    await assert.rejects(() => command("list"), /permission denied/);
    await asUser(denied);
    await assert.rejects(() => command("list"), /利用権限/);
    assert.equal(
      (await db.query("select * from public.eventchecker_events")).rows.length,
      0,
    );
    await assert.rejects(
      () =>
        db.query("insert into public.eventchecker_members values($1)", [
          denied,
        ]),
      /permission denied/,
    );

    await asUser(owner);
    await command("save", { ...payload, id: "tmc-event", source: "tmc", sourceKey: "596" });
    assert.equal((await command("list") as { source: string }[])[0].source, "tmc");
    await command("delete", { id: "tmc-event" });
    await command("save", payload);
    await command("reserve", {
      id: payload.id,
      sessionId: "slot",
      value: true,
    });
    await assert.rejects(
      () => command("status", { id: payload.id, status: "ignored" }),
      /購入済み/,
    );
    await command("save", { ...payload, title: "Updated", sessions: [] });
    const saved = (await command("list")) as {
      title: string;
      status: string;
      sessions: { active: boolean; reserved: boolean }[];
    }[];
    assert.equal(saved[0].title, "Updated");
    assert.equal(saved[0].status, "purchased");
    assert.equal(saved[0].sessions[0].active, false);
    assert.equal(saved[0].sessions[0].reserved, true);
    await command("restore", {
      ...payload,
      title: "Should not overwrite",
      status: "ignored",
    });
    assert.equal(((await command("list")) as typeof saved)[0].title, "Updated");

    await assert.rejects(() =>
      command("save", {
        ...payload,
        id: "broken",
        sourceKey: "broken",
        sessions: [...payload.sessions, { id: "bad", start: "invalid" }],
      }),
    );
    assert.equal(((await command("list")) as unknown[]).length, 1);
    await asUser(other);
    assert.deepEqual(await command("list"), []);
    assert.equal(
      (await db.query("select * from public.eventchecker_sessions")).rows
        .length,
      0,
    );
    await assert.rejects(
      () =>
        db.query(
          "insert into public.eventchecker_events(user_id,id,source,source_key,data) values($1,'x','escape','x','{}')",
          [owner],
        ),
      /row-level security/,
    );

    await asUser(owner);
    const token = "44444444-4444-4444-8444-444444444444";
    await command("acquire", {
      url: "https://escape.id/test-org/e-test/",
      token,
    });
    await assert.rejects(
      () =>
        command("acquire", {
          url: "https://escape.id/test-org/e-other/",
          token,
        }),
      /取得中/,
    );
    await command("release", { token });
    await assert.rejects(
      () =>
        command("acquire", {
          url: "https://escape.id/test-org/e-test/",
          token,
        }),
      /間隔をあけて/,
    );
    await command("restore", {
      ...payload,
      id: "large",
      sourceKey: "large",
      status: "unpurchased",
      sessions: Array.from({ length: 1200 }, (_, i) => ({
        ...payload.sessions[0],
        id: String(i),
      })),
    });
    const listed = (await command("list")) as {
      id: string;
      sessions: unknown[];
    }[];
    assert.equal(listed.find((e) => e.id === "large")?.sessions.length, 1200);
    await command("delete", { id: "event-1" });
    assert.equal(
      (await db.query("select * from public.eventchecker_reservations")).rows
        .length,
      0,
    );
  } finally {
    await db.close();
  }
});

import Database from "better-sqlite3";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EventRecord, PersonalStatus, Session } from "../lib/types";

const email = process.argv[2];
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error(
    "Usage: npx tsx scripts/export-supabase.ts owner@example.com",
  );
const db = new Database(
  process.env.EVENTCHECKER_DB || resolve("data/eventchecker.sqlite"),
  { readonly: true, fileMustExist: true },
);
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
let events: EventRecord[];
try {
  events = db.transaction(() => {
    const rows = db
      .prepare(
        "SELECT e.id,e.data,u.status FROM events e LEFT JOIN user_events u ON u.event_id=e.id AND u.user_id='local' ORDER BY e.rowid",
      )
      .all() as { id: string; data: string; status: PersonalStatus | null }[];
    return rows.map((row) => {
      const sessions = db
        .prepare(
          "SELECT s.data,s.active,r.session_id FROM sessions s LEFT JOIN reservations r ON r.event_id=s.event_id AND r.session_id=s.id AND r.user_id='local' WHERE s.event_id=? ORDER BY s.start",
        )
        .all(row.id) as {
        data: string;
        active: number;
        session_id: string | null;
      }[];
      return {
        ...JSON.parse(row.data),
        id: row.id,
        status: row.status || "unpurchased",
        sessions: sessions.map(
          (s) =>
            ({
              ...JSON.parse(s.data),
              active: !!s.active,
              reserved: !!s.session_id,
            }) as Session,
        ),
      };
    });
  })();
} finally {
  db.close();
}

const sql = `-- Personal data: do not commit or share this file.
-- Apply schema.sql and allow-owner.sql first. Existing cloud events are skipped.
begin;
do $migration$
declare owner_id uuid;
begin
  select id into owner_id from auth.users where lower(email)=lower(${quote(email)});
  if owner_id is null then raise exception 'Login user does not exist'; end if;
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub',owner_id,'role','authenticated')::text, true);
end $migration$;
set local role authenticated;
${events.map((event) => `select public.eventchecker_command('restore', ${quote(JSON.stringify(event))}::jsonb);`).join("\n")}
commit;
`;
mkdirSync(resolve(".local"), { recursive: true });
writeFileSync(resolve(".local/supabase-data.sql"), sql, "utf8");
console.log(
  `Exported ${events.length} events, ${events.reduce((sum, e) => sum + e.sessions.length, 0)} sessions to .local/supabase-data.sql. Local data was not modified.`,
);

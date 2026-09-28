import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import type {
  EventRecord,
  ImportedEvent,
  PersonalStatus,
  Session,
} from "./types";

export function createStore(filename: string) {
  if (filename !== ":memory:")
    mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, source TEXT NOT NULL, source_key TEXT NOT NULL,
      data TEXT NOT NULL, last_error TEXT, UNIQUE(source, source_key)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      id TEXT NOT NULL, start TEXT NOT NULL, data TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY(event_id, id)
    );
    CREATE TABLE IF NOT EXISTS user_events (
      user_id TEXT NOT NULL, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK(status IN ('unpurchased', 'purchased', 'ignored')),
      PRIMARY KEY(user_id, event_id)
    );
    CREATE TABLE IF NOT EXISTS reservations (
      user_id TEXT NOT NULL, event_id TEXT NOT NULL, session_id TEXT NOT NULL,
      PRIMARY KEY(user_id, event_id, session_id),
      FOREIGN KEY(event_id, session_id) REFERENCES sessions(event_id, id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS sessions_start ON sessions(start);
  `);

  const list = (id?: string): EventRecord[] => {
    const rows = db
      .prepare(
        `SELECT e.id, e.data, e.last_error, COALESCE(u.status, 'unpurchased') AS status
      FROM events e LEFT JOIN user_events u ON u.event_id = e.id AND u.user_id = 'local'
      ${id ? "WHERE e.id = ?" : ""} ORDER BY e.rowid DESC`,
      )
      .all(...(id ? [id] : [])) as {
      id: string;
      data: string;
      last_error: string | null;
      status: PersonalStatus;
    }[];
    return rows.map((row) => {
      const sessions = db
        .prepare(
          `SELECT s.data, s.active, r.session_id AS reserved FROM sessions s
        LEFT JOIN reservations r ON r.event_id = s.event_id AND r.session_id = s.id AND r.user_id = 'local'
        WHERE s.event_id = ? ORDER BY s.start`,
        )
        .all(row.id) as {
        data: string;
        active: number;
        reserved: string | null;
      }[];
      const data = JSON.parse(row.data);
      return {
        ...data,
        id: row.id,
        status: row.status,
        warning: row.last_error || data.warning,
        sessions: sessions.map((s) => ({
          ...JSON.parse(s.data),
          active: !!s.active,
          reserved: !!s.reserved,
        })),
      };
    });
  };

  const save = db.transaction((imported: ImportedEvent) => {
    const { sessions, complete, coverageFrom, coverageTo, ...metadata } =
      imported;
    const id = createHash("sha256")
      .update(`${imported.source}:${imported.sourceKey}`)
      .digest("hex")
      .slice(0, 20);
    db.prepare(
      `INSERT INTO events(id, source, source_key, data) VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET data=excluded.data, last_error=NULL`,
    ).run(id, imported.source, imported.sourceKey, JSON.stringify(metadata));
    if (complete) {
      db.prepare(
        "UPDATE sessions SET active=0 WHERE event_id=? AND start>=? AND start<?",
      ).run(
        id,
        new Date(`${coverageFrom}T00:00:00+09:00`).toISOString(),
        new Date(
          Date.parse(`${coverageTo}T00:00:00+09:00`) + 86400000,
        ).toISOString(),
      );
    }
    const upsert =
      db.prepare(`INSERT INTO sessions(event_id, id, start, data, active) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(event_id, id) DO UPDATE SET start=excluded.start, data=excluded.data, active=1`);
    for (const session of sessions)
      upsert.run(id, session.id, session.start, JSON.stringify(session));
    return id;
  });

  const setStatus = db.transaction((id: string, status: PersonalStatus) => {
    if (!db.prepare("SELECT 1 FROM events WHERE id=?").get(id))
      throw new Error("公演が見つかりません。");
    if (
      status !== "purchased" &&
      db
        .prepare(
          "SELECT 1 FROM reservations WHERE event_id=? AND user_id='local'",
        )
        .get(id)
    ) {
      throw new Error(
        "購入済みの開催回を解除してから、状態を変更してください。",
      );
    }
    db.prepare(
      `INSERT INTO user_events(user_id,event_id,status) VALUES ('local',?,?)
      ON CONFLICT(user_id,event_id) DO UPDATE SET status=excluded.status`,
    ).run(id, status);
  });

  const reserve = db.transaction(
    (id: string, sessionId: string, value: boolean) => {
      const session = db
        .prepare("SELECT active FROM sessions WHERE event_id=? AND id=?")
        .get(id, sessionId) as { active: number } | undefined;
      if (!session || (value && !session.active))
        throw new Error("この開催回は現在掲載されていません。");
      if (value) {
        db.prepare(
          "INSERT OR IGNORE INTO reservations(user_id,event_id,session_id) VALUES ('local',?,?)",
        ).run(id, sessionId);
        setStatus(id, "purchased");
      } else {
        db.prepare(
          "DELETE FROM reservations WHERE user_id='local' AND event_id=? AND session_id=?",
        ).run(id, sessionId);
        if (
          !db
            .prepare(
              "SELECT 1 FROM reservations WHERE event_id=? AND user_id='local'",
            )
            .get(id)
        )
          setStatus(id, "unpurchased");
      }
    },
  );

  return {
    list,
    get: (id: string) => list(id)[0] || null,
    getSourceUrl: (id: string) => {
      const row = db.prepare("SELECT data FROM events WHERE id=?").get(id) as { data: string } | undefined;
      return row ? JSON.parse(row.data).url as string : null;
    },
    save,
    setStatus,
    reserve,
    remove: (id: string) => db.prepare("DELETE FROM events WHERE id=?").run(id),
    recordError: (id: string, message: string) =>
      db
        .prepare("UPDATE events SET last_error=? WHERE id=?")
        .run(`更新に失敗しました。前回の情報を表示しています。${message}`, id),
    close: () => db.close(),
  };
}

const globalStore = globalThis as typeof globalThis & {
  eventStore?: ReturnType<typeof createStore>;
};
export function getStore() {
  return (globalStore.eventStore ??= createStore(
    process.env.EVENTCHECKER_DB || resolve("data", "eventchecker.sqlite"),
  ));
}

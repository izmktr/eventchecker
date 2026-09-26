import { addDays, availableSessionCount, dateKey } from "./dates";
import type { EventRecord, Session } from "./types";

interface ScheduleRow {
  event: EventRecord;
  kind: "scheduled" | "future" | "past" | "unknown";
  date: string;
  sessionsByDate: Map<string, Session[]>;
}

export function dayScheduleRows(events: EventRecord[], date: string) {
  const start = Date.parse(`${date}T00:00:00+09:00`);
  return events.map((event) => {
    const sessions = event.sessions.filter((session) =>
      (session.active || session.reserved) &&
      Date.parse(session.start) < start + 86400000 &&
      Date.parse(session.end || session.start) >= start,
    );
    return { event, sessions, available: availableSessionCount(sessions) };
  }).filter((row) => row.sessions.length > 0)
    .sort((a, b) => b.available - a.available);
}

export function scheduleRows(
  events: EventRecord[],
  start: string,
): ScheduleRow[] {
  const end = addDays(start, 29);
  const rows = events.map((event): ScheduleRow => {
    const sessionsByDate = new Map<string, Session[]>();
    for (const session of event.sessions) {
      if (!session.active && !session.reserved) continue;
      const date = dateKey(session.start);
      const daily = sessionsByDate.get(date) || [];
      daily.push(session);
      sessionsByDate.set(date, daily);
    }
    const dates = [...sessionsByDate.keys()].sort();
    const firstInRange = dates.find((date) => date >= start && date <= end);
    if (firstInRange)
      return { event, kind: "scheduled", date: firstInRange, sessionsByDate };
    // A later run takes precedence over an earlier run separated by a long gap.
    const next = dates.find((date) => date > end);
    if (next) return { event, kind: "future", date: next, sessionsByDate };
    const last = dates.at(-1);
    return {
      event,
      kind: last ? "past" : "unknown",
      date: last || "",
      sessionsByDate,
    };
  });
  const order = { scheduled: 0, future: 1, past: 2, unknown: 3 };
  return rows.sort((a, b) => {
    const group = order[a.kind] - order[b.kind];
    if (group) return group;
    const chronological = a.date.localeCompare(b.date);
    return (
      (a.kind === "past" ? -chronological : chronological) ||
      a.event.title.localeCompare(b.event.title, "ja") ||
      a.event.id.localeCompare(b.event.id)
    );
  });
}

"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  ListPlus,
  LoaderCircle,
  MapPin,
  Plus,
  RefreshCw,
  Search,
  Ticket,
  Trash2,
  X,
  AlertCircle,
  LogOut,
} from "lucide-react";
import {
  addDays,
  availableSessionCount,
  dateKey,
  dayAvailability,
  dayLabel,
  monthShift,
  timeLabel,
  today,
  validDate,
} from "@/lib/dates";
import {
  availabilityLabels,
  availabilitySymbols,
  statusLabels,
  type Availability,
  type EventRecord,
  type PersonalStatus,
  type Session,
} from "@/lib/types";
import { dayScheduleRows, scheduleRows } from "@/lib/schedule";
import { calendarDayClass, type Holidays } from "@/lib/holidays";

type Action = Record<string, string | boolean>;
type Mutate = (action: Action) => Promise<string | undefined>;

function availabilityText(session: Session) {
  return /^[○◯〇△×✕－―]$/.test(session.rawAvailability)
    ? availabilityLabels[session.availability]
    : session.rawAvailability;
}

function IconButton({
  title,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className="icon-button"
      {...props}
    >
      {children}
    </button>
  );
}

function Poster({
  event,
  large = false,
}: {
  event: EventRecord;
  large?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <div className={large ? "poster poster-large" : "poster"}>
      {event.imageUrl && !failed ? (
        <img
          src={event.imageUrl}
          alt={`${event.title} 公演ビジュアル`}
          onError={() => setFailed(true)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <Ticket size={large ? 40 : 22} />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="legend" aria-label="空き状況の凡例">
      {(
        [
          "available",
          "few",
          "full",
          "pending",
          "closed",
          "unknown",
        ] as Availability[]
      ).map((state) => (
        <span key={state}>
          <b className={`legend-symbol ${state}`}>
            {availabilitySymbols[state]}
          </b>
          {availabilityLabels[state]}
        </span>
      ))}
      <span>
        <b className="legend-symbol reserved">
          <Check size={12} />
        </b>
        購入済み
      </span>
    </div>
  );
}

function StatusSelect({
  event,
  mutate,
  disabled,
}: {
  event: EventRecord;
  mutate: Mutate;
  disabled: boolean;
}) {
  return (
    <select
      aria-label={`${event.title}の購入状態`}
      className={`status-select ${event.status}`}
      value={event.status}
      disabled={disabled}
      onChange={(e) =>
        void mutate({ action: "status", id: event.id, status: e.target.value })
      }
    >
      {Object.entries(statusLabels).map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

function EventName({
  event,
  mutate,
  busy,
}: {
  event: EventRecord;
  mutate: Mutate;
  busy: boolean;
}) {
  return (
    <div className="event-name">
      <Poster event={event} />
      <div className="event-name-text">
        <Link className="event-title" href={`/events/${event.id}`}>
          {event.title}
        </Link>
        <span className="small muted">{event.organizer}</span>
        <StatusSelect event={event} mutate={mutate} disabled={busy} />
        {event.warning && (
          <span className="event-warning" title={event.warning}>
            <AlertCircle size={12} />
            要確認
          </span>
        )}
      </div>
    </div>
  );
}

function RangeControls({
  date,
  span,
  onChange,
}: {
  date: string;
  span: number;
  onChange: (date: string) => void;
}) {
  return (
    <div className="range-controls">
      <IconButton
        title={span === 30 ? "前の30日" : "前の日"}
        onClick={() => onChange(addDays(date, -span))}
      >
        <ChevronLeft size={18} />
      </IconButton>
      <IconButton
        title={span === 30 ? "次の30日" : "次の日"}
        onClick={() => onChange(addDays(date, span))}
      >
        <ChevronRight size={18} />
      </IconButton>
      <button className="button compact" onClick={() => onChange(today())}>
        今日
      </button>
      <label className="date-input">
        <CalendarDays size={16} />
        <input
          type="date"
          aria-label={span === 30 ? "表示開始日" : "表示日"}
          value={date}
          min="2000-01-01"
          max="2100-12-31"
          onChange={(e) =>
            validDate(e.target.value) && onChange(e.target.value)
          }
        />
      </label>
    </div>
  );
}

function ThirtyDays({
  holidays,
  events,
  date,
  mutate,
  busy,
}: {
  holidays: Holidays;
  events: EventRecord[];
  date: string;
  mutate: Mutate;
  busy: boolean;
}) {
  const days = Array.from({ length: 30 }, (_, index) => addDays(date, index));
  const months: { label: string; count: number }[] = [];
  for (const day of days) {
    const label = `${day.slice(0, 4)}年${Number(day.slice(5, 7))}月`;
    const previous = months.at(-1);
    if (previous?.label === label) previous.count++;
    else months.push({ label, count: 1 });
  }
  return (
    <div className="schedule-scroll" tabIndex={0} aria-label="30日間の公演一覧">
      <table className="schedule-table">
        <colgroup>
          <col className="name-col" />
          {days.map((day) => (
            <col key={day} className="day-col" />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th rowSpan={2} className="sticky-name">
              公演 <span className="muted">{events.length}</span>
            </th>
            {months.map((month) => (
              <th
                className="month-heading"
                key={month.label}
                colSpan={month.count}
              >
                {month.label}
              </th>
            ))}
          </tr>
          <tr>
            {days.map((day) => {
              const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
              return (
                <th
                  key={day}
                  className={`date-heading ${calendarDayClass(day, holidays)} ${day === today() ? "is-today" : ""}`}
                >
                  <Link href={`/day?date=${day}`} title={`${dayLabel(day)}${holidays[day] ? ` ${holidays[day]}` : ""}`}>
                    {day.slice(8)}
                    <small>{"日月火水木金土"[weekday]}</small>
                  </Link>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {scheduleRows(events, date).map(
            ({ event, kind, date: nextDate, sessionsByDate }) => (
              <tr key={event.id}>
                <th scope="row" className="sticky-name">
                  <EventName event={event} mutate={mutate} busy={busy} />
                </th>
                {kind !== "scheduled" ? (
                  <td colSpan={30} className={`outside-range ${kind}`}>
                    {kind === "future" ? (
                      <Link
                        href={`/?date=${nextDate}`}
                        className="outside-range-label"
                      >
                        {Number(nextDate.slice(5, 7))}月
                        {Number(nextDate.slice(8))}日～
                        <ArrowRight size={14} />
                      </Link>
                    ) : (
                      <span className="outside-range-label">
                        {kind === "past" ? "終了" : "日程未取得"}
                      </span>
                    )}
                  </td>
                ) : (
                  days.map((day) => {
                    const sessions = sessionsByDate.get(day) || [];
                    const reserved = sessions.some((s) => s.reserved);
                    const active = sessions.filter((s) => s.active);
                    const remaining = availableSessionCount(sessions);
                    const state = dayAvailability(active);
                    return (
                      <td
                        key={day}
                        className={`${calendarDayClass(day, holidays)} ${day === today() ? "today-column" : ""}`}
                      >
                        {sessions.length > 0 ? (
                          <Link
                            className={`day-cell ${reserved ? "reserved" : state}`}
                            href={`/events/${event.id}?date=${day}`}
                            title={`${event.title} / ${dayLabel(day)} / 空きあり${remaining}回・全${sessions.length}回 / ${reserved ? "購入済み" : availabilityLabels[state]}`}
                            aria-label={`${event.title} ${dayLabel(day)} 空きあり${remaining}回・全${sessions.length}回${reserved ? " 購入済み" : ""}`}
                          >
                            {reserved ? (
                              <Check size={16} />
                            ) : (
                              availabilitySymbols[state]
                            )}
                            <small>{remaining}/{sessions.length}</small>
                          </Link>
                        ) : (
                          <span className="no-session">·</span>
                        )}
                      </td>
                    );
                  })
                )}
              </tr>
            ),
          )}
        </tbody>
      </table>
      {events.length === 0 && (
        <div className="empty-inline">該当する公演はありません。</div>
      )}
    </div>
  );
}

function SessionList({
  event,
  sessions,
  busy,
  mutate,
}: {
  event: EventRecord;
  sessions: Session[];
  busy: boolean;
  mutate: Mutate;
}) {
  return (
    <div className="session-list">
      {sessions.map((session) => (
        <div
          className={`session-row ${session.reserved ? "is-reserved" : ""}`}
          key={session.id}
        >
          <div className="session-primary">
            <strong>
              {timeLabel(session.start)}
              <span className="time-end">
                {session.end
                  ? `–${timeLabel(session.end)}${event.source === "scrap" ? "頃" : ""}`
                  : ""}
              </span>
            </strong>
            <span className={`availability-text ${session.availability}`}>
              {availabilitySymbols[session.availability]}{" "}
              {availabilityText(session)}
            </span>
            {!session.active && (
              <span className="warning-text">現在は掲載なし</span>
            )}
            <span className="small muted">{session.venue}</span>
            <span className="tiny muted">
              確認{" "}
              {new Date(session.checkedAt).toLocaleString("ja-JP", {
                timeZone: "Asia/Tokyo",
              })}
            </span>
          </div>
          <div className="session-actions">
            <label className="reservation-check">
              <input
                type="checkbox"
                checked={session.reserved}
                disabled={busy || (!session.active && !session.reserved)}
                onChange={(e) =>
                  void mutate({
                    action: "reserve",
                    id: event.id,
                    sessionId: session.id,
                    value: e.target.checked,
                  })
                }
              />
              <span>購入済み</span>
            </label>
            <a
              href={session.url}
              target="_blank"
              rel="noopener noreferrer"
              className="source-link"
            >
              販売ページ
              <ExternalLink size={13} />
            </a>
          </div>
        </div>
      ))}
      {sessions.length === 0 && (
        <div className="empty-inline">この日の公演はありません。</div>
      )}
    </div>
  );
}

function DayView({
  events,
  date,
  busy,
  mutate,
}: {
  events: EventRecord[];
  date: string;
  busy: boolean;
  mutate: Mutate;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const startOfDay = Date.parse(`${date}T00:00:00+09:00`);
  const rows = dayScheduleRows(events, date);
  const sessionsByEvent = new Map(rows.map((row) => [row.event.id, row.sessions]));
  const daySessions = (event: EventRecord) => sessionsByEvent.get(event.id) || [];
  const shown = rows.map((row) => row.event);
  const all = shown.flatMap(daySessions);
  const minHour = Math.max(
    0,
    Math.min(
      9,
      ...all.map((s) =>
        Math.floor((Date.parse(s.start) - startOfDay) / 3600000),
      ),
    ),
  );
  const maxHour = Math.min(
    24,
    Math.max(
      21,
      ...all.map(
        (s) =>
          Math.ceil((Date.parse(s.end || s.start) - startOfDay) / 3600000) +
          (s.end ? 0 : 1),
      ),
    ),
  );
  const hourWidth = 76;
  const width = (maxHour - minHour) * hourWidth;
  const selectedEvent = shown.find((event) => event.id === selected);
  return (
    <>
      <div className="timeline-scroll" tabIndex={0} aria-label="日別の公演時間">
        <div className="timeline" style={{ minWidth: width + 280 }}>
          <div className="timeline-heading">
            <div className="timeline-name">
              公演 <span className="muted">{shown.length}</span>
            </div>
            <div className="timeline-hours" style={{ width }}>
              {Array.from({ length: maxHour - minHour }, (_, i) => (
                <span style={{ width: hourWidth }} key={i}>
                  {minHour + i}:00
                </span>
              ))}
            </div>
          </div>
          {shown.map((event) => {
            const laneEnds: number[] = [];
            const blocks = daySessions(event).map((session) => {
              const start = Math.max(
                minHour * 60,
                (Date.parse(session.start) - startOfDay) / 60000,
              );
              const end = Math.min(
                maxHour * 60,
                session.end
                  ? (Date.parse(session.end) - startOfDay) / 60000
                  : start + 40,
              );
              let lane = laneEnds.findIndex((value) => value <= start);
              if (lane < 0) lane = laneEnds.length;
              laneEnds[lane] = end;
              return { session, start, end, lane };
            });
            return (
              <div className="timeline-row" key={event.id}>
                <div className="timeline-name">
                  <EventName event={event} mutate={mutate} busy={busy} />
                </div>
                <div
                  className="timeline-track"
                  style={{
                    width,
                    height: Math.max(126, laneEnds.length * 70 + 22),
                    backgroundSize: `${hourWidth}px 100%`,
                  }}
                >
                  {blocks.map(({ session, start, end, lane }) => (
                    <button
                      key={session.id}
                      className={`time-block ${session.reserved ? "reserved" : session.availability}`}
                      style={{
                        left: ((start - minHour * 60) / 60) * hourWidth,
                        width: Math.max(
                          30,
                          ((end - start) / 60) * hourWidth - 3,
                        ),
                        top: lane * 70 + 14,
                      }}
                      onClick={() => setSelected(event.id)}
                      title={`${event.title} ${timeLabel(session.start)} ${session.rawAvailability}`}
                    >
                      <strong>
                        {timeLabel(session.start)}
                        {session.reserved && <Check size={13} />}
                      </strong>
                      <span>
                        {availabilitySymbols[session.availability]}{" "}
                        {availabilityText(session)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {shown.length === 0 && (
          <div className="empty-inline">
            この日に登録されている公演はありません。
          </div>
        )}
      </div>
      {selectedEvent && (
        <section className="day-detail">
          <div className="section-heading">
            <h2>{selectedEvent.title}</h2>
            <IconButton
              title="開催回を閉じる"
              onClick={() => setSelected(null)}
            >
              <X size={18} />
            </IconButton>
          </div>
          <SessionList
            event={selectedEvent}
            sessions={daySessions(selectedEvent)}
            mutate={mutate}
            busy={busy}
          />
        </section>
      )}
    </>
  );
}

function Detail({
  holidays,
  event,
  queryDate,
  mutate,
  busy,
}: {
  holidays: Holidays;
  event: EventRecord;
  queryDate: string | null;
  mutate: Mutate;
  busy: boolean;
}) {
  const router = useRouter();
  const first =
    event.sessions.find((s) => s.active && dateKey(s.start) >= today()) ||
    event.sessions.find((s) => s.active);
  const initial = validDate(queryDate)
    ? queryDate
    : first
      ? dateKey(first.start)
      : today();
  const [month, setMonth] = useState(initial.slice(0, 7) + "-01");
  const [selected, setSelected] = useState(initial);
  const [deleting, setDeleting] = useState(false);
  const start = addDays(month, -new Date(`${month}T00:00:00Z`).getUTCDay());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const sessions = event.sessions.filter(
    (s) => (s.active || s.reserved) && dateKey(s.start) === selected,
  );
  const moveMonth = (delta: number) => {
    const next = monthShift(month, delta);
    setMonth(next);
    setSelected(next);
  };
  return (
    <>
      <Link className="back-link" href="/">
        <ArrowLeft size={16} />
        公演一覧
      </Link>
      <section className="event-overview">
        <Poster event={event} large />
        <div className="event-overview-main">
          <span className="eyebrow">
            {event.source === "escape" ? "ESCAPE.ID" : "SCRAP TICKET"}{" "}
            <span>/</span> {event.organizer}
          </span>
          <h1>{event.title}</h1>
          <div className="event-facts">
            <span>
              <MapPin size={16} />
              {event.venue}
            </span>
            <span>
              <Clock3 size={16} />
              {event.durationLabel}
            </span>
          </div>
          <div className="event-overview-actions">
            <StatusSelect event={event} mutate={mutate} disabled={busy} />
            <a
              className="button"
              href={event.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              公演ページ
              <ExternalLink size={14} />
            </a>
            <button
              className="button"
              disabled={busy}
              onClick={() => void mutate({ action: "refresh", id: event.id })}
            >
              <RefreshCw size={15} className={busy ? "spin" : ""} />
              空き状況を更新
            </button>
            <IconButton
              title="公演を削除"
              disabled={busy}
              onClick={() => setDeleting(true)}
            >
              <Trash2 size={16} />
            </IconButton>
          </div>
          <p className="small muted">
            最終取得{" "}
            {new Date(event.checkedAt).toLocaleString("ja-JP", {
              timeZone: "Asia/Tokyo",
            })}{" "}
            · {event.sessions.filter((s) => s.active).length}開催回
          </p>
        </div>
      </section>
      {event.warning && (
        <div className="notice warning">
          <AlertCircle size={18} />
          {event.warning}
        </div>
      )}
      <div className="detail-grid">
        <section className="event-calendar">
          <div className="section-heading">
            <h2>
              {month.slice(0, 4)}年 {Number(month.slice(5, 7))}月
            </h2>
            <div className="inline">
              <IconButton title="前の月" onClick={() => moveMonth(-1)}>
                <ChevronLeft size={18} />
              </IconButton>
              <IconButton title="次の月" onClick={() => moveMonth(1)}>
                <ChevronRight size={18} />
              </IconButton>
            </div>
          </div>
          <div className="calendar-weekdays">
            {"日月火水木金土".split("").map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid">
            {cells.map((day) => {
              const daily = event.sessions.filter(
                (s) => (s.active || s.reserved) && dateKey(s.start) === day,
              );
              const state = dayAvailability(daily.filter((s) => s.active));
              const reserved = daily.some((s) => s.reserved);
              return (
                <button
                  key={day}
                  aria-label={`${dayLabel(day)} ${daily.length}回 空きあり${availableSessionCount(daily)}回${holidays[day] ? ` ${holidays[day]}` : ""}`}
                  title={holidays[day]}
                  aria-pressed={selected === day}
                  className={`calendar-day ${calendarDayClass(day, holidays)} ${day.slice(0, 7) !== month.slice(0, 7) ? "outside-month" : ""} ${selected === day ? "selected" : ""}`}
                  onClick={() => setSelected(day)}
                >
                  <span className={day === today() ? "today-number" : ""}>
                    {Number(day.slice(8))}
                  </span>
                  {daily.length > 0 && (
                    <>
                      <b
                        className={`calendar-marker ${reserved ? "reserved" : state}`}
                      >
                        {reserved ? (
                          <Check size={16} />
                        ) : (
                          availabilitySymbols[state]
                        )}
                      </b>
                      <small>空き{availableSessionCount(daily)}/{daily.length}回</small>
                    </>
                  )}
                </button>
              );
            })}
          </div>
          <Legend />
        </section>
        <section className="selected-sessions">
          <div className="section-heading">
            <h2>{dayLabel(selected)}</h2>
            <Link href={`/day?date=${selected}`} className="source-link">
              この日の一覧
              <ArrowRight size={14} />
            </Link>
          </div>
          <SessionList
            event={event}
            sessions={sessions}
            busy={busy}
            mutate={mutate}
          />
        </section>
      </div>
      {deleting && (
        <div
          className="modal-overlay"
          onClick={() => !busy && setDeleting(false)}
        >
          <div
            className="confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="delete-title">この公演を削除しますか？</h2>
            <p>{event.title}</p>
            <p className="muted">購入済みの記録も削除されます。</p>
            <div className="dialog-actions">
              <button
                autoFocus
                className="button"
                disabled={busy}
                onClick={() => setDeleting(false)}
              >
                キャンセル
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={async () => {
                  const result = await mutate({
                    action: "delete",
                    id: event.id,
                  });
                  if (result !== undefined) router.push("/");
                }}
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Register({ mutate, busy }: { mutate: Mutate; busy: boolean }) {
  const [url, setUrl] = useState("");
  const router = useRouter();
  async function submit(event: FormEvent) {
    event.preventDefault();
    const id = await mutate({ action: "import", url });
    if (id) router.push(`/events/${id}`);
  }
  return (
    <section className="register-surface">
      <div className="register-icon">
        <ListPlus size={32} />
      </div>
      <h1>公演を登録</h1>
      <form onSubmit={submit}>
        <label htmlFor="event-url">公演ページのURL</label>
        <div className="url-field">
          <input
            autoFocus
            required
            id="event-url"
            type="url"
            placeholder="https://escape.id/…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy}
          />
          <button
            className="button primary"
            disabled={busy || !url.trim()}
            type="submit"
          >
            {busy ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Plus size={17} />
            )}
            {busy ? "取得中…" : "登録する"}
          </button>
        </div>
        <div className="supported-sources">
          <span>ESCAPE.ID</span>
          <span>SCRAP TICKET</span>
        </div>
        {busy && (
          <p className="muted" role="status">
            公演情報と開催日程を取得しています…
          </p>
        )}
      </form>
    </section>
  );
}

export default function EventChecker({ holidays }: { holidays: Holidays }) {
  const params = useParams<{ view?: string[] }>();
  const query = useSearchParams();
  const router = useRouter();
  const route = params.view || [];
  const view = route[0] || "month";
  const queryDate = query.get("date");
  const date = validDate(queryDate) ? queryDate : today();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | PersonalStatus>("unpurchased");
  const [source, setSource] = useState("all");
  const [mode, setMode] = useState("sqlite");
  async function reload() {
    const response = await fetch("/api/events", { cache: "no-store" });
    const data = await response.json();
    if (response.status === 401) {
      setEvents([]);
      router.replace("/login");
      return;
    }
    if (!response.ok)
      throw new Error(data.error || "保存データを読み込めませんでした。");
    setEvents(data.events);
    setMode(data.mode || "sqlite");
  }
  useEffect(() => {
    reload()
      .catch((error) => setError(error.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    setNotice("");
    setError("");
  }, [view, route[1]]);
  const mutate: Mutate = async (action) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action),
      });
      const data = await response.json();
      if (response.status === 401) {
        setEvents([]);
        router.replace("/login");
        return undefined;
      }
      if (!response.ok) throw new Error(data.error || "処理に失敗しました。");
      setEvents(data.events);
      if (action.action === "refresh") setNotice("空き状況を更新しました。");
      return data.id ?? "";
    } catch (error) {
      setError(error instanceof Error ? error.message : "処理に失敗しました。");
      await reload().catch(() => {});
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  const filtered = events.filter(
    (event) =>
      (status === "all" || event.status === status) &&
      (source === "all" || event.source === source) &&
      `${event.title} ${event.organizer} ${event.venue}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const selectedEvent = events.find((event) => event.id === route[1]);
  const upcomingReservations = events.flatMap((event) =>
    event.sessions.filter((s) => s.reserved && dateKey(s.start) >= today()),
  );
  const isList = view === "month" || view === "day";
  const changeDate = (value: string) =>
    router.push(`${view === "day" ? "/day" : "/"}?date=${value}`);
  return (
    <>
      <header className="app-header">
        <Link href="/" className="brand">
          <span className="brand-symbol">
            <CalendarCheck2 size={23} />
          </span>
          <span>イベントチェッカー</span>
        </Link>
        <span className="local-indicator">
          <span />
          {mode === "supabase" ? "クラウド" : "ローカル"}
        </span>
        <Link className="button primary header-add" href="/register">
          <Plus size={16} />
          <span>公演を登録</span>
        </Link>
        {mode === "supabase" && (
          <IconButton
            title="ログアウト"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const response = await fetch("/api/auth", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "logout" }),
                });
                if (!response.ok)
                  throw new Error("ログアウトできませんでした。");
                setEvents([]);
                router.replace("/login");
              } catch (error) {
                setError(
                  error instanceof Error
                    ? error.message
                    : "ログアウトできませんでした。",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <LogOut size={16} />
          </IconButton>
        )}
      </header>
      <nav className="main-nav" aria-label="メインナビゲーション">
        <Link className={view === "month" ? "active" : ""} href="/">
          <CalendarDays size={17} />
          30日一覧
        </Link>
        <Link
          className={view === "day" ? "active" : ""}
          href={`/day?date=${date}`}
        >
          <Clock3 size={17} />
          日別
        </Link>
        <Link className={view === "register" ? "active" : ""} href="/register">
          <ListPlus size={17} />
          公演登録
        </Link>
        <span className="nav-note">JST / 日本時間</span>
      </nav>
      <main>
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <IconButton title="エラー表示を閉じる" onClick={() => setError("")}>
              <X size={16} />
            </IconButton>
          </div>
        )}
        {notice && (
          <div className="notice success" role="status">
            <Check size={18} />
            {notice}
          </div>
        )}
        {loading ? (
          <div className="loading-screen">
            <LoaderCircle size={22} className="spin" />
            公演を読み込んでいます…
          </div>
        ) : view === "register" ? (
          <Register mutate={mutate} busy={busy} />
        ) : view === "events" ? (
          selectedEvent ? (
            <Detail
              holidays={holidays}
              key={selectedEvent.id + (queryDate || "")}
              event={selectedEvent}
              queryDate={queryDate}
              mutate={mutate}
              busy={busy}
            />
          ) : (
            <div className="empty-state">
              <h1>公演が見つかりません</h1>
              <Link href="/" className="button">
                公演一覧へ
              </Link>
            </div>
          )
        ) : isList ? (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">MY EVENTS</span>
                <h1>{view === "day" ? dayLabel(date) : "公演スケジュール"}</h1>
              </div>
              <div className="summary">
                <span>
                  <strong>{events.length}</strong>登録公演
                </span>
                <span>
                  <Ticket size={16} />
                  <strong>{upcomingReservations.length}</strong>購入済みの予定
                </span>
              </div>
            </div>
            {events.length === 0 ? (
              <div className="empty-state">
                <CalendarDays size={46} strokeWidth={1.4} />
                <h2>まだ公演が登録されていません</h2>
                <Link href="/register" className="button primary">
                  <Plus size={17} />
                  公演を登録
                </Link>
              </div>
            ) : (
              <>
                <div className="schedule-toolbar">
                  <RangeControls
                    date={date}
                    span={view === "day" ? 1 : 30}
                    onChange={changeDate}
                  />
                  {view === "month" && (
                    <span className="range-caption">
                      {dayLabel(date)} — {dayLabel(addDays(date, 29))}
                    </span>
                  )}
                  <div className="filters">
                    <label className="search-field">
                      <Search size={16} />
                      <input
                        aria-label="公演を検索"
                        placeholder="公演・団体・会場を検索"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <select
                      aria-label="サイトで絞り込み"
                      value={source}
                      onChange={(e) => setSource(e.target.value)}
                    >
                      <option value="all">すべてのサイト</option>
                      <option value="escape">ESCAPE.ID</option>
                      <option value="scrap">SCRAP TICKET</option>
                    </select>
                    <select
                      aria-label="購入状態で絞り込み"
                      value={status}
                      onChange={(e) =>
                        setStatus(e.target.value as typeof status)
                      }
                    >
                      <option value="all">すべての状態</option>
                      {Object.entries(statusLabels).map(([key, value]) => (
                        <option key={key} value={key}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {view === "month" ? (
                  <ThirtyDays
                    holidays={holidays}
                    events={filtered}
                    date={date}
                    mutate={mutate}
                    busy={busy}
                  />
                ) : (
                  <DayView
                    key={date}
                    events={filtered}
                    date={date}
                    mutate={mutate}
                    busy={busy}
                  />
                )}
                <div className="schedule-footer">
                  <Legend />
                  <span className="tiny muted">取得時点の空き状況</span>
                </div>
                <section className="event-index">
                  <div className="section-heading">
                    <h2>登録公演</h2>
                    <span className="small muted">{filtered.length}件</span>
                  </div>
                  {filtered.map((event) => {
                    const next = event.sessions.find(
                      (s) => s.active && dateKey(s.start) >= today(),
                    );
                    return (
                      <div className="index-row" key={event.id}>
                        <Poster event={event} />
                        <div className="index-title">
                          <Link
                            className="event-title"
                            href={`/events/${event.id}`}
                          >
                            {event.title}
                          </Link>
                          <span className="small muted">
                            {event.organizer} · {event.venue}
                          </span>
                          {event.warning && (
                            <span className="small warning-text">
                              {event.warning}
                            </span>
                          )}
                        </div>
                        <div className="index-date">
                          {next ? (
                            <Link href={`/?date=${dateKey(next.start)}`}>
                              {dayLabel(dateKey(next.start))}
                              <ArrowRight size={14} />
                            </Link>
                          ) : (
                            <span className="muted small">
                              今後の開催回なし
                            </span>
                          )}
                          <span className="tiny muted">
                            {event.sessions.filter((s) => s.active).length}
                            開催回
                          </span>
                        </div>
                        <IconButton
                          title={`${event.title}の空き状況を更新`}
                          disabled={busy}
                          onClick={() =>
                            void mutate({ action: "refresh", id: event.id })
                          }
                        >
                          <RefreshCw size={16} className={busy ? "spin" : ""} />
                        </IconButton>
                      </div>
                    );
                  })}
                </section>
              </>
            )}
          </>
        ) : (
          <div className="empty-state">
            <h1>ページが見つかりません</h1>
            <Link href="/" className="button">
              公演一覧へ
            </Link>
          </div>
        )}
      </main>
      <footer className="app-footer">
        <span>EVENT CHECKER</span>
        <span>空き状況・販売条件は販売ページでご確認ください。</span>
      </footer>
    </>
  );
}

import { load } from "cheerio";
import { parse as parseDevalue } from "devalue";
import { z } from "zod";
import { addDays, dateKey, monthShift, today } from "./dates";
import type { Availability, ImportedEvent, Session } from "./types";

const timestamp = z
  .string()
  .refine((v) => Number.isFinite(Date.parse(v)), "Invalid date");
const escapeInfoSchema = z.object({
  uid: z.string(),
  eventSlug: z.string(),
  eventName: z.string(),
  estimatedTime: z.string().nullish(),
  organization: z.object({ orgSlug: z.string(), name: z.string() }),
  portraitImageUrl: z.string().nullish(),
  landscapeImageUrl: z.string().nullish(),
  locations: z.array(z.object({ uid: z.string(), name: z.string() })),
  periods: z.array(z.object({ startDate: timestamp, endDate: timestamp })),
});
const escapeSlotsSchema = z.object({
  dates: z.array(
    z.object({
      date: z.string(),
      slots: z.array(
        z.object({
          uuid: z.string(),
          startAt: timestamp,
          endAt: timestamp.nullish(),
          vacancyType: z.string(),
          remaining: z.number().nullish(),
          locationUid: z.string().nullish(),
          customLabel: z.string().nullish(),
        }),
      ),
    }),
  ),
});
const dateOption = z.object({
  event_date: z.string(),
  display_event_date: z.string(),
});
const timeOption = z.object({
  code: z.string(),
  event_time: timestamp,
  display_event_time: z.string(),
});
const scrapSchema = z.object({
  csrfTokenName: z.string(),
  csrfHash: z.string(),
  imgPresignedUrl: z.string().nullish(),
  contentData: z.object({
    id: z.string(),
    name: z.string(),
    place: z.string().nullish(),
  }),
  eventData: z.object({
    event_start_time: timestamp,
    event_end_time: timestamp.nullish(),
  }),
  eventMonthOptions: z.array(z.object({ event_month: z.string() })),
  eventDateOptions: z.array(dateOption),
  eventTimeOptions: z.array(timeOption),
});

export function normalizeSourceUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error("有効な公演URLを入力してください。");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new Error("HTTPSの公演ページURLを入力してください。");
  const isEscape =
    url.hostname === "escape.id" &&
    /^\/[\w-]+-org\/e-[\w-]+\/?$/.test(url.pathname);
  const isScrap =
    url.hostname === "scrapticket.jp" &&
    /^\/events\/show\/[A-Za-z0-9]+\/?$/.test(url.pathname);
  if (!isEscape && !isScrap)
    throw new Error(
      "ESCAPE.IDの公演ページ、またはスクチケの /events/show/ で始まるURLに対応しています。",
    );
  url.search = "";
  url.hash = "";
  url.pathname = isEscape
    ? url.pathname.replace(/\/?$/, "/")
    : url.pathname.replace(/\/$/, "");
  return url;
}

// Astro's HTML props use typed tuples; decode only the JSON-compatible types needed here.
function decodeAstro(value: unknown): unknown {
  if (Array.isArray(value)) {
    const [tag, payload] = value;
    if (tag === 0) return decodeAstro(payload);
    if (tag === 1 && Array.isArray(payload)) return payload.map(decodeAstro);
    if (tag === 3) return payload;
    throw new Error("未対応の公演データ形式です。");
  }
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, decodeAstro(v)]),
    );
  return value;
}

export function parseEscapeInfo(html: string) {
  const $ = load(html);
  const props = $('astro-island[component-export="EventInitializer"]').attr(
    "props",
  );
  if (!props)
    throw new Error(
      "公演情報を読み取れませんでした。サイトの構造が変わった可能性があります。",
    );
  const decoded = z
    .object({ info: escapeInfoSchema })
    .parse(decodeAstro(JSON.parse(props)));
  return decoded.info;
}

export function parseScrapInfo(html: string) {
  const $ = load(html);
  const script = $("script")
    .toArray()
    .map((el) => $(el).html() || "")
    .find((s) => s.trimStart().startsWith("window.__INITIAL_DATA__ ="));
  if (!script)
    throw new Error(
      "スクチケの公演情報を読み取れませんでした。公開中の公演URLをご確認ください。",
    );
  const json = script
    .slice(script.indexOf("=") + 1)
    .trim()
    .replace(/;\s*$/, "");
  return scrapSchema.parse(JSON.parse(json));
}

export function escapeAvailability(
  type: string,
  remaining?: number | null,
): { availability: Availability; rawAvailability: string } {
  const labels: Record<string, [Availability, string]> = {
    MANY: ["available", "空席あり"],
    FEW: ["few", remaining == null ? "残り僅か" : `残り${remaining}席`],
    FULL: ["full", "売り切れ"],
    FULL_PENDING: ["pending", "決済待ち"],
    NONE: ["closed", "予約不可"],
    NOT_IN_SALES_PERIOD: ["closed", "販売期間外"],
  };
  const [availability, rawAvailability] = labels[type] || [
    "unknown",
    `不明 (${type})`,
  ];
  return { availability, rawAvailability };
}

export function scrapAvailability(label: string): {
  availability: Availability;
  rawAvailability: string;
} {
  const rawAvailability =
    label.replace(/\s*\d{1,2}:\d{2}.*$/, "").trim() || "不明";
  let availability: Availability = "unknown";
  if (/[○◯〇]/.test(rawAvailability) || /空席あり/.test(rawAvailability))
    availability = "available";
  else if (/△|残り/.test(rawAvailability)) availability = "few";
  else if (/[×✕]|満員|満席|完売/.test(rawAvailability)) availability = "full";
  else if (/受付|取り扱いなし|取扱なし|－|―/.test(rawAvailability))
    availability = "closed";
  return { availability, rawAvailability };
}

function safeImage(value?: string | null) {
  try {
    const url = new URL(value || "");
    return url.protocol === "https:" &&
      ["static.escape.id", "scrapticket.jp"].includes(url.hostname)
      ? url.href
      : null;
  } catch {
    return null;
  }
}

class SourceClient {
  private deadline = Date.now() + 240_000;
  private cookies = new Map<string, string>();
  constructor(private origin: string) {}
  async request(path: string, body?: object | FormData) {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0)
      throw new Error(
        "日程の取得に時間がかかりすぎたため中止しました。前回のデータは保持されます。",
      );
    const url = new URL(path, this.origin);
    if (url.origin !== this.origin) throw new Error("取得先が変更されました。");
    const headers: Record<string, string> = {
      "User-Agent": "EventChecker/0.1 (personal local event calendar)",
      Accept: "text/html,application/json",
      Origin: this.origin,
    };
    if (this.cookies.size)
      headers.Cookie = [...this.cookies]
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
    if (body && !(body instanceof FormData))
      headers["Content-Type"] = "application/json";
    const response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers,
      cache: "no-store",
      redirect: "error",
      body:
        body instanceof FormData
          ? body
          : body
            ? JSON.stringify(body)
            : undefined,
      signal: AbortSignal.timeout(Math.min(20000, remaining)),
    });
    if (!response.ok)
      throw new Error(
        `取得先がHTTP ${response.status}を返しました。時間をおいて再度お試しください。`,
      );
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0];
      const equals = pair.indexOf("=");
      this.cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("取得先からデータが返りませんでした。");
    const chunks: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 5_000_000) {
        await reader.cancel();
        throw new Error("公演データが大きすぎるため取得を中止しました。");
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 200));

async function importEscape(url: URL): Promise<ImportedEvent> {
  const client = new SourceClient(url.origin);
  const info = parseEscapeInfo(await client.request(url.href));
  const checkedAt = new Date().toISOString();
  const starts = info.periods.map((p) => dateKey(p.startDate)).sort();
  const ends = info.periods.map((p) => dateKey(p.endDate)).sort();
  const periodStart = starts[0] || today();
  const coverageFrom = periodStart < today() ? periodStart : today();
  const requestedTo = ends.at(-1) || addDays(periodStart, 180);
  const coverageTo =
    requestedTo < addDays(periodStart, 366)
      ? requestedTo
      : addDays(periodStart, 366);
  const result = escapeSlotsSchema.parse(
    parseDevalue(
      await client.request("/_actions/getEventSlotList/", {
        orgSlug: info.organization.orgSlug,
        eventSlug: info.eventSlug,
        dateFrom: periodStart,
        dateTo: coverageTo,
        locationUid: null,
        locationAreaUid: null,
      }),
    ),
  );
  const sessions: Session[] = result.dates.flatMap((day) =>
    day.slots.map((slot) => ({
      id: slot.uuid,
      start: new Date(slot.startAt).toISOString(),
      end: slot.endAt ? new Date(slot.endAt).toISOString() : null,
      venue:
        info.locations.find((l) => l.uid === slot.locationUid)?.name ||
        info.locations.map((l) => l.name).join(" / "),
      ...escapeAvailability(slot.vacancyType, slot.remaining),
      url: `${url.href}?u=${encodeURIComponent(slot.uuid)}&d=${day.date}`,
      checkedAt,
      active: true,
      reserved: false,
    })),
  );
  const actualDurations = sessions
    .filter((s) => s.end)
    .map((s) => (Date.parse(s.end!) - Date.parse(s.start)) / 60000)
    .filter((value) => value > 0);
  return {
    source: "escape",
    sourceKey: info.uid,
    url: url.href,
    title: info.eventName,
    organizer: info.organization.name,
    venue: info.locations.map((l) => l.name).join(" / "),
    durationLabel: info.estimatedTime || "未取得",
    durationMinutes: actualDurations.length
      ? Math.max(...actualDurations)
      : null,
    imageUrl: safeImage(info.portraitImageUrl || info.landscapeImageUrl),
    checkedAt,
    warning:
      requestedTo > coverageTo
        ? "開催日程は先頭から366日分を取得しています。"
        : sessions.length
          ? null
          : "公開中の開催回がありません。",
    sessions,
    complete: true,
    coverageFrom,
    coverageTo,
  };
}

async function importScrap(url: URL): Promise<ImportedEvent> {
  const client = new SourceClient(url.origin);
  const info = parseScrapInfo(await client.request(url.href));
  let csrf = info.csrfHash;
  const post = async (path: string, values: Record<string, string>) => {
    await pause();
    const form = new FormData();
    form.set(info.csrfTokenName, csrf);
    for (const [key, value] of Object.entries(values)) form.set(key, value);
    const result = z
      .object({ result: z.string(), csrf_hash: z.string() })
      .passthrough()
      .parse(JSON.parse(await client.request(path, form)));
    csrf = result.csrf_hash;
    if (result.result !== "OK")
      throw new Error("スクチケの日程取得に失敗しました。");
    return result;
  };
  const checkedAt = new Date().toISOString();
  const durationMinutes = info.eventData.event_end_time
    ? Math.round(
        (Date.parse(
          info.eventData.event_end_time.replace(" ", "T") + "+09:00",
        ) -
          Date.parse(
            info.eventData.event_start_time.replace(" ", "T") + "+09:00",
          )) /
          60000,
      )
    : null;
  const months = info.eventMonthOptions.slice(0, 6);
  const options = new Map(
    info.eventDateOptions.map((day) => [day.event_date, day]),
  );
  for (const month of months) {
    if (
      info.eventDateOptions.some((d) =>
        d.event_date.startsWith(month.event_month.slice(0, 7)),
      )
    )
      continue;
    const result = await post("/ajax/event_data/get_event_date_options", {
      content_id: info.contentData.id,
      target_month: month.event_month,
      display_lang: "japanese",
    });
    for (const day of z.array(dateOption).parse(result.event_date_options))
      options.set(day.event_date, day);
  }
  const dates = [...options.keys()].sort().slice(0, 186);
  const times = [...info.eventTimeOptions];
  for (const date of dates) {
    if (info.eventTimeOptions.some((t) => t.event_time.startsWith(date)))
      continue;
    const result = await post("/ajax/event_data/get_event_time_options", {
      content_id: info.contentData.id,
      target_date: date,
    });
    times.push(...z.array(timeOption).parse(result.event_time_options));
  }
  const sessions: Session[] = times.map((slot) => {
    const start = new Date(
      slot.event_time.replace(" ", "T") + "+09:00",
    ).toISOString();
    return {
      id: slot.code,
      start,
      end:
        durationMinutes && durationMinutes > 0
          ? new Date(Date.parse(start) + durationMinutes * 60000).toISOString()
          : null,
      venue: info.contentData.place || "未取得",
      ...scrapAvailability(slot.display_event_time),
      url: `${url.origin}/events/show/${slot.code}`,
      checkedAt,
      active: true,
      reserved: false,
    };
  });
  return {
    source: "scrap",
    sourceKey: info.contentData.id,
    url: url.href,
    title: info.contentData.name,
    organizer: "SCRAP",
    venue: info.contentData.place || "未取得",
    durationMinutes,
    durationLabel:
      durationMinutes && durationMinutes > 0
        ? `約${durationMinutes}分（掲載回の開始・終了時刻から算出）`
        : "未取得",
    imageUrl: safeImage(info.imgPresignedUrl),
    checkedAt,
    sessions,
    warning:
      info.eventMonthOptions.length > 6 || options.size > 186
        ? "日程は最大6か月・186日分を取得しています。"
        : sessions.length
          ? null
          : "公開中の開催回がありません。",
    complete: true,
    coverageFrom:
      months.map((m) => m.event_month).sort()[0] || dates[0] || today(),
    coverageTo:
      options.size > 186
        ? dates.at(-1)!
        : months.length
          ? addDays(
              monthShift(
                months
                  .map((m) => m.event_month)
                  .sort()
                  .at(-1)!,
                1,
              ),
              -1,
            )
          : dates.at(-1) || today(),
  };
}

export async function importEvent(input: string) {
  const url = normalizeSourceUrl(input);
  try {
    return url.hostname === "escape.id"
      ? await importEscape(url)
      : await importScrap(url);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      throw new Error(
        "取得先のデータ形式が変わった可能性があります。既存のデータは保持されます。",
      );
    if (
      error instanceof Error &&
      (error.name === "TimeoutError" || error.message === "fetch failed")
    )
      throw new Error(
        "サイトに接続できませんでした。接続状況を確認し、再度お試しください。",
      );
    throw error;
  }
}

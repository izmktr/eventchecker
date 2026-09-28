import { load } from "cheerio";
import { validDate } from "./dates";
import type { Availability, Session } from "./types";

export function parseMysteryCircusInfo(html: string, productId: string) {
  const $ = load(html);
  const title = $("h1.ty-product-block-title").text().trim();
  if (!title || $("#product_id").val() !== productId)
    throw new Error("東京ミステリーサーカスの公演情報を読み取れませんでした。");
  const dates = [...new Set($(`#option_${productId}_date option[value]`).toArray()
    .filter((el) => $(el).attr("value"))
    .map((el) => $(el).text().trim().replaceAll("/", "-")))].sort();
  if (dates.some((date) => !validDate(date))) throw new Error("開催日の形式が変わっています。");
  if (!$(`#option_${productId}_date`).length) throw new Error("開催日一覧が見つかりません。");
  const description = $('meta[name="description"]').attr("content") || "";
  const minutes = description.match(/所要時間[：:]\s*約?(\d+)分/);
  const room = $(`#opt_${productId} .ty-product-options__item > div`).first().text().trim();
  const image = $('meta[property="og:image"]').attr("content");
  const imageUrl = image && image.startsWith("https://dttj1kl1hn9zl.cloudfront.net/") ? image : null;
  return { title, dates, imageUrl, venue: `東京ミステリーサーカス${room ? ` ${room}` : ""}`,
    durationMinutes: minutes ? Number(minutes[1]) : null };
}

export function parseMysteryCircusSessions(html: string, date: string, productId: string,
  venue: string, durationMinutes: number | null, checkedAt: string): Session[] {
  const $ = load(html);
  if (!$("#list-schedule").length) throw new Error("開催時刻一覧を読み取れませんでした。");
  return $("#list-schedule .schedule-item-event-time-list-item").toArray().map((el) => {
    const item = $(el);
    const href = item.find("a").attr("href");
    const time = item.find("a > p").first().text().match(/^(\d{1,2}):(\d{2})/);
    const rawAvailability = item.find(".svg-icon-text").text().trim() || "不明";
    const closed = /準備中|販売終了|販売期間外|受付終了|Sales ended/i.test(rawAvailability);
    if ((!href && !closed) || !time || Number(time[1]) > 23 || Number(time[2]) > 59)
      throw new Error("開催回の形式が変わっています。");
    const url = new URL(href || `?dispatch=products.view&product_id=${productId}`, "https://ticket.mysterycircus.jp/index.php");
    const timeId = url.searchParams.get("time_id");
    if (url.origin !== "https://ticket.mysterycircus.jp" || url.pathname !== "/index.php" ||
      url.searchParams.get("dispatch") !== "products.view" || url.searchParams.get("product_id") !== productId || (href && (!timeId || !/^\d+$/.test(timeId))))
      throw new Error("開催回のリンクが不正です。");
    let availability: Availability = "unknown";
    if (closed) availability = "closed";
    else if (/残席なし|完売|Sold out/i.test(rawAvailability)) availability = "full";
    else if (/わずか|Only a few/i.test(rawAvailability)) availability = "few";
    else if (/残席あり|Available/i.test(rawAvailability)) availability = "available";
    const start = new Date(`${date}T${time[1].padStart(2, "0")}:${time[2]}:00+09:00`).toISOString();
    // Unreleased slots have no time_id; retain identity when ticket sales open.
    const id = `${productId}:${start}`;
    return { id, start, end: durationMinutes ? new Date(Date.parse(start) + durationMinutes * 60000).toISOString() : null,
      venue, availability, rawAvailability, url: url.href, checkedAt, active: true, reserved: false };
  });
}

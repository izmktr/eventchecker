import { importEvent } from "../lib/sources";
import { getStore } from "../lib/store";

for (const url of [
  "https://escape.id/karakara-org/e-meguru/",
  "https://scrapticket.jp/events/show/P882489650",
]) {
  const event = await importEvent(url);
  const id = getStore().save(event);
  console.log(
    JSON.stringify({
      id,
      title: event.title,
      sessions: event.sessions.length,
      first: event.sessions[0]?.start,
      last: event.sessions.at(-1)?.start,
      warning: event.warning,
    }),
  );
}

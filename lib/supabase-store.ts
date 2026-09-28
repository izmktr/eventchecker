import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventRecord, ImportedEvent, PersonalStatus, Session } from "./types";

export function createSupabaseStore(client: SupabaseClient) {
  const readError = () => new Error("Supabaseでの読み込みに失敗しました。再度お試しください。");
  async function get(id: string): Promise<EventRecord | null> {
    const result = await client.from("eventchecker_events")
      .select("id,data,last_error,eventchecker_user_events(status)").eq("id", id).maybeSingle();
    if (result.error) throw readError();
    if (!result.data) return null;
    const sessions: Session[] = [];
    // PostgREST limits rows per response; never truncate a large event's sessions.
    for (let offset = 0; ; offset += 500) {
      const page = await client.from("eventchecker_sessions")
        .select("data,active,eventchecker_reservations(session_id)")
        .eq("event_id", id).order("id").range(offset, offset + 499);
      if (page.error || !page.data) throw readError();
      sessions.push(...page.data.map(row => ({ ...row.data, active: row.active,
        reserved: Array.isArray(row.eventchecker_reservations)
          ? row.eventchecker_reservations.length > 0 : !!row.eventchecker_reservations } as Session)));
      if (page.data.length < 500) break;
    }
    sessions.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
    const row = result.data;
    const personal = row.eventchecker_user_events as { status: PersonalStatus }[] | { status: PersonalStatus } | null;
    const status = Array.isArray(personal) ? personal[0]?.status : personal?.status;
    return { ...row.data, id: row.id, status: status || "unpurchased",
      warning: row.last_error ?? row.data.warning, sessions };
  }
  async function command<T>(action: string, payload: object = {}): Promise<T> {
    const { data, error } = await client.rpc("eventchecker_command", {
      p_action: action,
      p_payload: payload,
    });
    if (error) {
      if (error.code === "P0001") throw new Error(error.message);
      throw new Error(
        "Supabaseでの保存・読み込みに失敗しました。テーブルとアクセス権の設定を確認してください。",
      );
    }
    return data as T;
  }
  return {
    list: () => command<EventRecord[]>("list"),
    get,
    getSourceUrl: async (id: string): Promise<string | null> => {
      const result = await client.from("eventchecker_events").select("data->>url").eq("id", id).maybeSingle();
      if (result.error) throw readError();
      return result.data?.url ?? null;
    },
    save: (event: ImportedEvent) =>
      command<string>("save", {
        ...event,
        id: createHash("sha256")
          .update(`${event.source}:${event.sourceKey}`)
          .digest("hex")
          .slice(0, 20),
      }),
    setStatus: (id: string, status: PersonalStatus) =>
      command("status", { id, status }),
    reserve: (id: string, sessionId: string, value: boolean) =>
      command("reserve", { id, sessionId, value }),
    remove: (id: string) => command("delete", { id }),
    recordError: (id: string, message: string) =>
      command("error", { id, message }),
    acquire: (url: string, token: string) => command("acquire", { url, token }),
    release: (token: string) => command("release", { token }),
  };
}

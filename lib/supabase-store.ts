import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventRecord, ImportedEvent, PersonalStatus } from "./types";

export function createSupabaseStore(client: SupabaseClient) {
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

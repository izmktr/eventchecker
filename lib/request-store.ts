import { storageMode, isCloudRequest } from "./cloud-config";
import { isLocalRequest } from "./request-policy";
import { supabaseServer } from "./supabase-server";
import { createSupabaseStore } from "./supabase-store";

export class AccessError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export async function requestStore(headers: Headers) {
  const mode = storageMode();
  if (mode === "sqlite") {
    if (!isLocalRequest(headers))
      throw new AccessError("ローカルからのみ利用できます。", 403);
    const { getStore } = await import("./store");
    return { store: getStore(), cloud: null, mode };
  }
  if (!isCloudRequest(headers))
    throw new AccessError(
      "アクセス元を確認できません。APP_ORIGINの設定を確認してください。",
      403,
    );
  const client = await supabaseServer();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new AccessError("ログインしてください。", 401);
  const member = await client
    .from("eventchecker_members")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (member.error)
    throw new AccessError("Supabaseの初期設定を確認してください。", 503);
  if (!member.data)
    throw new AccessError("このアカウントには利用権限がありません。", 403);
  const store = createSupabaseStore(client);
  return { store, cloud: store, mode };
}

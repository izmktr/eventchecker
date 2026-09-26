export function storageMode(
  env: Record<string, string | undefined> = process.env,
): "sqlite" | "supabase" {
  const mode = env.EVENTCHECKER_STORAGE || (env.VERCEL ? "supabase" : "sqlite");
  if (mode !== "sqlite" && mode !== "supabase")
    throw new Error("EVENTCHECKER_STORAGEの設定が不正です。");
  if (env.VERCEL && mode === "sqlite")
    throw new Error("VercelではSupabase保存を設定してください。");
  return mode;
}

export function supabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabaseの接続設定がありません。");
  return { url, key };
}

export function isCloudRequest(
  headers: Headers,
  origin = process.env.APP_ORIGIN,
) {
  if (!origin) return false;
  try {
    const configured = new URL(origin);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(
      configured.hostname,
    );
    if (
      configured.protocol !== "https:" &&
      !(local && configured.protocol === "http:")
    )
      return false;
    if (headers.get("host") !== configured.host) return false;
    const sentOrigin = headers.get("origin");
    if (sentOrigin) return sentOrigin === configured.origin;
    return headers.get("sec-fetch-site") !== "cross-site";
  } catch {
    return false;
  }
}

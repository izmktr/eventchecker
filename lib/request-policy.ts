export function isLocalRequest(headers: Headers) {
  const host = headers.get("host") || "";
  if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host)) return false;
  const origin = headers.get("origin");
  if (!origin) return headers.get("sec-fetch-site") !== "cross-site";
  try {
    const parsed = new URL(origin);
    return (
      ["http:", "https:"].includes(parsed.protocol) && parsed.host === host
    );
  } catch {
    return false;
  }
}

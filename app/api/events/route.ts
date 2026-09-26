import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requestStore, AccessError } from "@/lib/request-store";
import { importEvent, normalizeSourceUrl } from "@/lib/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("import"), url: z.string().max(4000) }),
  z.object({ action: z.literal("refresh"), id: z.string().max(100) }),
  z.object({
    action: z.literal("status"),
    id: z.string().max(100),
    status: z.enum(["unpurchased", "purchased", "ignored"]),
  }),
  z.object({
    action: z.literal("reserve"),
    id: z.string().max(100),
    sessionId: z.string().max(200),
    value: z.boolean(),
  }),
  z.object({ action: z.literal("delete"), id: z.string().max(100) }),
]);
const globals = globalThis as typeof globalThis & {
  sourceBusy?: boolean;
  sourceAttempts?: Map<string, number>;
};

export async function GET(request: NextRequest) {
  try {
    const { store, mode } = await requestStore(request.headers);
    return NextResponse.json(
      { events: await store.list(), mode },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "読み込みに失敗しました。",
      },
      { status: error instanceof AccessError ? error.status : 503 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { store, cloud, mode } = await requestStore(request.headers);
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new Error("JSON形式のリクエストが必要です。");
    const raw = await request.text();
    if (raw.length > 10000) throw new Error("リクエストが大きすぎます。");
    const action = actionSchema.parse(JSON.parse(raw));
    let id = "id" in action ? action.id : undefined;
    if (action.action === "import" || action.action === "refresh") {
      if (!cloud && globals.sourceBusy)
        return NextResponse.json(
          { error: "別の公演を取得中です。完了後にお試しください。" },
          { status: 409 },
        );
      const existing = (await store.list()).find((event) => event.id === id);
      const url = action.action === "import" ? action.url : existing?.url;
      if (!url) throw new Error("公演が見つかりません。");
      const canonical = normalizeSourceUrl(url).href;
      const attempts = (globals.sourceAttempts ??= new Map());
      if (!cloud && Date.now() - (attempts.get(canonical) || 0) < 60_000) {
        return NextResponse.json(
          { error: "同じ公演の再取得は1分ほど間隔をあけてください。" },
          { status: 429 },
        );
      }
      const token = randomUUID();
      if (cloud) await cloud.acquire(canonical, token);
      else {
        attempts.set(canonical, Date.now());
        globals.sourceBusy = true;
      }
      try {
        id = await store.save(await importEvent(url));
      } catch (error) {
        if (existing)
          await store.recordError(
            existing.id,
            error instanceof Error ? error.message : "",
          );
        throw error;
      } finally {
        if (cloud) await cloud.release(token).catch(() => {});
        else globals.sourceBusy = false;
      }
    } else if (action.action === "status")
      await store.setStatus(action.id, action.status);
    else if (action.action === "reserve")
      await store.reserve(action.id, action.sessionId, action.value);
    else if (action.action === "delete") await store.remove(action.id);
    return NextResponse.json({ events: await store.list(), id, mode });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "入力内容を確認してください。"
            : error instanceof Error
              ? error.message
              : "処理に失敗しました。",
      },
      { status: error instanceof AccessError ? error.status : 400 },
    );
  }
}

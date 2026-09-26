import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { storageMode, isCloudRequest } from "@/lib/cloud-config";
import { supabaseServer } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  try {
    if (storageMode() !== "supabase" || !isCloudRequest(request.headers))
      return NextResponse.json(
        { error: "このアクセス元ではログインを利用できません。" },
        { status: 403 },
      );
    if (!request.headers.get("content-type")?.includes("application/json"))
      throw new Error("不正なリクエストです。");
    const text = await request.text();
    if (text.length > 5000) throw new Error("入力が長すぎます。");
    const input = z
      .discriminatedUnion("action", [
        z.object({
          action: z.literal("login"),
          email: z.email(),
          password: z.string().min(1).max(1000),
        }),
        z.object({ action: z.literal("logout") }),
      ])
      .parse(JSON.parse(text));
    const client = await supabaseServer();
    if (input.action === "logout") {
      const { error } = await client.auth.signOut({ scope: "local" });
      if (error)
        throw new Error("ログアウトに失敗しました。再度お試しください。");
      return NextResponse.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const { data, error } = await client.auth.signInWithPassword({
      email: input.email,
      password: input.password,
    });
    if (error || !data.user)
      return NextResponse.json(
        {
          error:
            "ログインできませんでした。メールアドレスとパスワードをご確認ください。",
        },
        { status: 401 },
      );
    const member = await client
      .from("eventchecker_members")
      .select("user_id")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (member.error || !member.data) {
      await client.auth.signOut({ scope: "local" });
      return NextResponse.json(
        {
          error:
            "このアカウントには利用権限がありません。Supabaseの初期設定をご確認ください。",
        },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "ログイン処理に失敗しました。入力内容と接続設定をご確認ください。",
      },
      { status: 400 },
    );
  }
}

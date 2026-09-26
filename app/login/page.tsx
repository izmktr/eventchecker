"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck2, LoaderCircle } from "lucide-react";

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "login",
          email: fields.get("email"),
          password: fields.get("password"),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      router.replace("/");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "ログインに失敗しました。",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-surface">
      <div className="brand">
        <span className="brand-symbol">
          <CalendarCheck2 size={23} />
        </span>
        イベントチェッカー
      </div>
      <h1>ログイン</h1>
      <form onSubmit={login}>
        <label htmlFor="login-email">メールアドレス</label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="username"
          required
          disabled={busy}
        />
        <label htmlFor="login-password">パスワード</label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          disabled={busy}
        />
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <button className="button primary" disabled={busy}>
          {busy && <LoaderCircle size={16} className="spin" />}ログイン
        </button>
      </form>
    </main>
  );
}

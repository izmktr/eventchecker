# Supabase / Vercel セットアップ

対象: Supabaseプロジェクト `eventchecker`。アプリはメールアドレスとパスワードでログインします。Supabase自体の管理画面へのログインとは別のアカウントです。

## 1. テーブルを作る

Supabaseの **SQL Editor** で、このフォルダーの `schema.sql` を実行します。
`eventchecker_` で始まる専用テーブルと関数を作成します。RLSで未ログイン・未許可ユーザー・他ユーザーのデータへのアクセスを制限します。

## 2. 自分のログインを作る

1. **Authentication > Users > Add user > Create new user** で `izmktr@gmail.com` を作成し、アプリ用パスワードを設定します。メール確認済み（Auto Confirm User）にします。
2. SQL Editorで `allow-owner.sql` を実行し、このユーザーだけに利用権限を付与します。
3. Authenticationの設定で新規ユーザーのサインアップを無効にしてください。このアプリに新規登録画面はありません。

パスワードはチャット・ソースコード・環境変数へ記載しません。ログイン画面で直接入力してください。パスワードを忘れた場合はSupabaseの管理画面から対応します。

## 3. ローカルデータを移行する

ローカルでの編集を一時的に止め、最新のデータを次のコマンドで書き出します。

```powershell
npx tsx scripts/export-supabase.ts izmktr@gmail.com
```

作成される `.local/supabase-data.sql` をSQL Editorで実行します。ローカルDBは読み取り専用で開き、変更しません。移行先に同じIDの公演がある場合は公演全体をスキップするため、再実行してもクラウド側の購入記録を上書きしません。移行は一度きりの取り込みで、ローカルとの自動同期ではありません。

移行SQLには個人の購入記録が含まれます。公開リポジトリには追加しないでください（`.local/` はgitignore済み）。

## 4. ローカルでクラウド接続を試す

`.env.local` の `EVENTCHECKER_STORAGE` を `supabase` に変更して開発サーバーを再起動します。
Project URL・Publishable keyは設定済み。`APP_ORIGIN=http://127.0.0.1:3000` なので、このURLで開きます。

```text
EVENTCHECKER_STORAGE=supabase
NEXT_PUBLIC_SUPABASE_URL=https://bcdoqsgrhiurunzdweyg.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SupabaseのPublishable key
APP_ORIGIN=http://127.0.0.1:3000
```

登録済みアカウントでログインし、公演・購入記録が移行されていることを確認します。`sqlite` に戻すと以前のローカルDBを利用します。

## 5. Vercelに設定する

Next.jsプロジェクトとしてインポートし、環境変数に上記4項目を追加します。
`EVENTCHECKER_STORAGE=supabase` とし、`APP_ORIGIN` を実際に使用する本番HTTPS URLに置き換えて再デプロイします。
Preview環境を使う場合は、その環境にも利用するURLに一致したAPP_ORIGINを設定してください。
Secret key・service_roleキーは不要です。Publishable keyは認証とRLSを前提に使います。

Vercel上でSQLite設定のまま起動するとエラーにし、空の一時DBへの保存に切り替わることを防ぎます。
取得APIはNode.jsで最大300秒、外部サイトの取得は約240秒で打ち切り、未完了の更新を保存しません。並行取得のロックと同一URLの再取得間隔はDB上で共有します。

## 確認項目

- ログインなしでは `/api/events` が401になること
- ログイン後に移行した公演と購入記録が表示されること
- 購入状態変更・再読み込み・再取得で状態が維持されること
- ログアウト後にデータを取得できないこと
- 未許可の別アカウントはログイン後もデータにアクセスできないこと

実際のSupabaseプロジェクトへのSQL適用と、本番の販売サイトへの接続確認が終わるまでは、公開環境の動作確認完了とはしません。

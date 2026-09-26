import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "イベントチェッカー",
  description: "謎解き公演の日程・空き状況・購入記録",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}

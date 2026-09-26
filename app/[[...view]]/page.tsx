import { Suspense } from "react";
import EventChecker from "@/components/event-checker";

export default function Page() {
  return (
    <Suspense
      fallback={<div className="loading-screen">公演を読み込んでいます…</div>}
    >
      <EventChecker />
    </Suspense>
  );
}

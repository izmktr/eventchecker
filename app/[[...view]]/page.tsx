import { Suspense } from "react";
import EventChecker from "@/components/event-checker";
import { loadHolidays } from "@/lib/holiday-data";

export default function Page() {
  return (
    <Suspense
      fallback={<div className="loading-screen">公演を読み込んでいます…</div>}
    >
      <EventChecker holidays={loadHolidays()} />
    </Suspense>
  );
}

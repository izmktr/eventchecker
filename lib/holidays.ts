export type Holidays = Record<string, string>;

export function calendarDayClass(day: string, holidays: Holidays) {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  if (holidays[day] || weekday === 0) return "holiday-background";
  return weekday === 6 ? "saturday-background" : "";
}

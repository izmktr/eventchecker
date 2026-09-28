export type Availability =
  | "available"
  | "few"
  | "full"
  | "pending"
  | "closed"
  | "unknown";
export type PersonalStatus = "unpurchased" | "purchased" | "ignored";

export interface Session {
  id: string;
  start: string;
  end: string | null;
  venue: string;
  availability: Availability;
  rawAvailability: string;
  url: string;
  checkedAt: string;
  active: boolean;
  reserved: boolean;
}

export interface EventRecord {
  id: string;
  source: "escape" | "scrap" | "tmc";
  sourceKey: string;
  url: string;
  title: string;
  organizer: string;
  venue: string;
  durationMinutes: number | null;
  durationLabel: string;
  imageUrl: string | null;
  checkedAt: string;
  warning: string | null;
  status: PersonalStatus;
  sessions: Session[];
}

export type ImportedEvent = Omit<EventRecord, "id" | "status"> & {
  complete: boolean;
  coverageFrom: string;
  coverageTo: string;
};

export const availabilityLabels: Record<Availability, string> = {
  available: "空席あり",
  few: "残りわずか",
  full: "満席",
  pending: "決済待ち",
  closed: "受付期間外・予約不可",
  unknown: "不明",
};
export const availabilitySymbols: Record<Availability, string> = {
  available: "○",
  few: "△",
  full: "×",
  pending: "待",
  closed: "－",
  unknown: "?",
};
export const statusLabels: Record<PersonalStatus, string> = {
  unpurchased: "未購入",
  purchased: "購入済み",
  ignored: "興味なし",
};

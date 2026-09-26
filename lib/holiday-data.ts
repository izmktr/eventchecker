import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import type { Holidays } from "./holidays";

export function loadHolidays(): Holidays {
  const bytes = readFileSync(path.join(process.cwd(), "assets", "syukujitsu.csv"));
  const rows: string[][] = parse(new TextDecoder("shift_jis").decode(bytes), {
    from_line: 2,
    skip_empty_lines: true,
    trim: true,
  });
  return Object.fromEntries(rows.map(([date, name]) => {
    const [year, month, day] = date.split("/");
    return [`${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`, name];
  }));
}

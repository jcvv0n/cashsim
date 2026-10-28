import type { Month } from "./types";

export function isMonth(value: unknown): value is Month {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function parseMonth(month: Month): { year: number; month: number } {
  const [year, m] = month.split("-").map(Number);
  return { year, month: m };
}

export function formatMonth(year: number, month: number): Month {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function addMonths(month: Month, n: number): Month {
  const { year, month: m } = parseMonth(month);
  const total = year * 12 + (m - 1) + n;
  const nextYear = Math.floor(total / 12);
  const nextMonth = ((total % 12) + 12) % 12 + 1;
  return formatMonth(nextYear, nextMonth);
}

export function monthRange(start: Month, count: number): Month[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => addMonths(start, i));
}

export function currentMonth(): Month {
  const now = new Date();
  return formatMonth(now.getFullYear(), now.getMonth() + 1);
}

export function displayMonth(month: Month): string {
  const { year, month: m } = parseMonth(month);
  return `${year}年${m}月`;
}

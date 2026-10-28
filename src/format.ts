export function formatMoney(
  cents: number,
  options: { signed?: boolean; zeroDash?: boolean } = {},
): string {
  if (options.zeroDash && cents === 0) return "—";

  const absolute = Math.abs(cents) / 100;
  const formatted = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(absolute);

  if (cents < 0) return `-¥${formatted}`;
  if (options.signed && cents > 0) return `+¥${formatted}`;
  return `¥${formatted}`;
}

export function parseYuanToCents(raw: string): number | null {
  const cleaned = raw.replace(/[,¥\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}

export function centsToInput(cents: number): string {
  return String(cents / 100);
}

export function formatMonthShort(month: string): string {
  const [year, m] = month.split("-");
  return `${year.slice(2)}-${m}`;
}

export function formatMonthLong(month: string): string {
  const [year, m] = month.split("-");
  return `${year}年${Number(m)}月`;
}

export function todayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

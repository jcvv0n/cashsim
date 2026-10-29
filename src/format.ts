/** 分 → 整数元；负数按绝对值四舍五入，避免 -22.5 变成 -22。 */
export function centsToYuan(cents: number): number {
  return Math.sign(cents) * Math.round(Math.abs(cents) / 100);
}

export function formatMoney(
  cents: number,
  options: { signed?: boolean; zeroDash?: boolean } = {},
): string {
  const yuan = centsToYuan(cents);
  if (options.zeroDash && yuan === 0) return "—";

  const formatted = new Intl.NumberFormat("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(yuan));

  if (yuan < 0) return `-¥${formatted}`;
  if (options.signed && yuan > 0) return `+¥${formatted}`;
  return `¥${formatted}`;
}

/** 金额以整数元录入，返回内部使用的“分”。 */
export function parseYuanToCents(raw: string): number | null {
  const cleaned = raw.replace(/[,¥\s]/g, "");
  if (cleaned === "" || cleaned === "-") return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;

  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  return rounded * 100;
}

export function centsToInput(cents: number): string {
  return String(centsToYuan(cents));
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

import type {
  AppState,
  Month,
  MonthRow,
  Projection,
  RecurringItem,
  RowStatus,
  Settings,
} from "./types";
import { addMonths, monthRange } from "./months";

export function effectiveEndMonth(item: RecurringItem): Month | undefined {
  if (item.remainingMonths && item.remainingMonths > 0) {
    return addMonths(item.startMonth, item.remainingMonths - 1);
  }
  return item.endMonth;
}

export function isActive(item: RecurringItem, month: Month): boolean {
  const end = effectiveEndMonth(item);
  return month >= item.startMonth && (!end || month <= end);
}

export function statusOf(balance: number, safetyFloor: number): RowStatus {
  if (balance < 0) return "danger";
  if (balance < safetyFloor) return "warning";
  return "normal";
}

export function project(state: AppState): Projection {
  const { settings } = state;
  const rows: MonthRow[] = [];
  let balance = settings.openingCash;
  let outflowTotal = 0;
  let netTotal = 0;

  for (const month of monthRange(settings.startMonth, settings.horizonMonths)) {
    const incomeItems = state.items.filter(
      (item) => item.type === "income" && isActive(item, month),
    );
    const income = incomeItems.reduce((sum, item) => sum + item.amount, 0);

    const fixedItems = state.items.filter(
      (item) => item.type === "fixed" && isActive(item, month),
    );
    const fixed = fixedItems.reduce((sum, item) => sum + item.amount, 0);

    const monthBills = state.bills.filter((bill) => bill.month === month);
    const hasActualBills = monthBills.length > 0;
    const living = hasActualBills
      ? monthBills.reduce((sum, bill) => sum + bill.amount, 0)
      : month >= settings.budgetStartMonth
        ? settings.monthlyBudget
        : 0;
    const livingSource = hasActualBills
      ? "actual"
      : month >= settings.budgetStartMonth
        ? "budget"
        : "none";

    const oneOffItems = state.oneOffs.filter(
      (event) => event.enabled && event.month === month,
    );
    const oneOff = oneOffItems.reduce((sum, event) => sum + event.amount, 0);

    const net = income - fixed - living + oneOff;
    balance += net;

    rows.push({
      month,
      income,
      fixed,
      living,
      livingSource,
      oneOff,
      incomeCount: incomeItems.length,
      fixedCount: fixedItems.length,
      billCount: monthBills.length,
      oneOffCount: oneOffItems.length,
      net,
      balance,
      status: statusOf(balance, settings.safetyFloor),
    });

    outflowTotal += fixed + living;
    netTotal += net;
  }

  const minRow =
    rows.length > 0
      ? rows.reduce((min, row) => (row.balance < min.balance ? row : min), rows[0])
      : undefined;
  const avgOutflow = rows.length > 0 ? Math.round(outflowTotal / rows.length) : 0;
  const minBalance = minRow?.balance ?? settings.openingCash;

  return {
    rows,
    metrics: {
      firstBelowFloor: rows.find((row) => row.balance < settings.safetyFloor)?.month,
      firstNegative: rows.find((row) => row.balance < 0)?.month,
      minBalance,
      minBalanceMonth: minRow?.month,
      maxGap: Math.max(0, settings.safetyFloor - minBalance),
      avgOutflow,
      avgNet: rows.length > 0 ? Math.round(netTotal / rows.length) : 0,
      runwayMonths:
        avgOutflow > 0 ? Math.max(0, settings.openingCash) / avgOutflow : null,
    },
  };
}

export function normalizeSettings(settings: Settings): Settings {
  const next = { ...settings };
  if (next.budgetStartMonth < next.startMonth) {
    next.budgetStartMonth = addMonths(next.startMonth, 1);
  }
  next.horizonMonths = Math.min(120, Math.max(1, Math.round(next.horizonMonths)));
  return next;
}

import type {
  AppState,
  CardBill,
  OneOffItem,
  RecurringItem,
  Settings,
} from "./engine/types";
import { addMonths, currentMonth, isMonth } from "./engine/months";
import { normalizeSettings } from "./engine/project";
import { centsToYuan } from "./format";

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 10);
}

export function sampleState(): AppState {
  const start = currentMonth();
  const next = addMonths(start, 1);

  return {
    schemaVersion: 1,
    settings: {
      startMonth: start,
      openingCash: 6_000_000,
      safetyFloor: 3_000_000,
      horizonMonths: 24,
      monthlyBudget: 1_000_000,
      budgetStartMonth: next,
    },
    items: [
      {
        id: uid(),
        name: "工资",
        amount: 2_500_000,
        type: "income",
        startMonth: start,
        enabled: true,
      },
      {
        id: uid(),
        name: "房贷",
        amount: 1_400_000,
        type: "fixed",
        startMonth: start,
        remainingMonths: 216,
        enabled: true,
      },
      {
        id: uid(),
        name: "车贷",
        amount: 400_000,
        type: "fixed",
        startMonth: start,
        remainingMonths: 8,
        enabled: true,
      },
    ],
    bills: [
      {
        id: uid(),
        month: start,
        cardName: "招行信用卡",
        amount: 900_000,
        enabled: true,
      },
      {
        id: uid(),
        month: start,
        cardName: "中信信用卡",
        amount: 600_000,
        enabled: true,
      },
    ],
    oneOffs: [
      {
        id: uid(),
        month: addMonths(start, 2),
        name: "装修",
        amount: -2_000_000,
        enabled: true,
      },
    ],
  };
}

/** 统一按整数元保存：内部仍以“分”为单位，值总是 100 的倍数。 */
function roundToWholeYuan(cents: number): number {
  return centsToYuan(cents) * 100;
}

export function normalizeState(state: AppState): AppState {
  const settings = normalizeSettings(state.settings);
  const fixedIds = new Set(
    state.items.filter((item) => item.type === "fixed").map((item) => item.id),
  );

  return {
    schemaVersion: 1,
    settings: {
      ...settings,
      openingCash: roundToWholeYuan(settings.openingCash),
      safetyFloor: roundToWholeYuan(settings.safetyFloor),
      monthlyBudget: roundToWholeYuan(settings.monthlyBudget),
    },
    items: state.items.map((item) => ({
      ...item,
      enabled: item.enabled !== false,
      amount: roundToWholeYuan(item.amount),
    })),
    bills: state.bills.map((bill) => {
      const includedFixedIds = (bill.includedFixedIds ?? []).filter(
        (id, index, list) => fixedIds.has(id) && list.indexOf(id) === index,
      );
      return {
        ...bill,
        enabled: bill.enabled !== false,
        amount: roundToWholeYuan(bill.amount),
        ...(includedFixedIds.length > 0 ? { includedFixedIds } : {}),
      };
    }),
    oneOffs: state.oneOffs.map((item) => ({
      ...item,
      amount: roundToWholeYuan(item.amount),
    })),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSettings(value: unknown): value is Settings {
  if (!isObject(value)) return false;
  return (
    isMonth(value.startMonth) &&
    isFiniteNumber(value.openingCash) &&
    isFiniteNumber(value.safetyFloor) &&
    isFiniteNumber(value.horizonMonths) &&
    isFiniteNumber(value.monthlyBudget) &&
    isMonth(value.budgetStartMonth)
  );
}

function isRecurringItem(value: unknown): value is RecurringItem {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    isFiniteNumber(value.amount) &&
    (value.type === "income" || value.type === "fixed") &&
    isMonth(value.startMonth) &&
    (value.endMonth === undefined || isMonth(value.endMonth)) &&
    (value.remainingMonths === undefined ||
      (isFiniteNumber(value.remainingMonths) && value.remainingMonths > 0)) &&
    (value.enabled === undefined || typeof value.enabled === "boolean")
  );
}

function isCardBill(value: unknown): value is CardBill {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    isMonth(value.month) &&
    typeof value.cardName === "string" &&
    isFiniteNumber(value.amount) &&
    (value.note === undefined || typeof value.note === "string") &&
    (value.enabled === undefined || typeof value.enabled === "boolean") &&
    (value.includedFixedIds === undefined ||
      (Array.isArray(value.includedFixedIds) &&
        value.includedFixedIds.every((id) => typeof id === "string")))
  );
}

function isOneOffItem(value: unknown): value is OneOffItem {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    isMonth(value.month) &&
    typeof value.name === "string" &&
    isFiniteNumber(value.amount) &&
    typeof value.enabled === "boolean"
  );
}

export function isAppState(value: unknown): value is AppState {
  if (!isObject(value)) return false;
  // 兼容旧版把数据结构版本写成 version: 1 的数据
  const schemaOk = value.schemaVersion === 1 || value.version === 1;
  return (
    schemaOk &&
    isSettings(value.settings) &&
    Array.isArray(value.items) &&
    value.items.every(isRecurringItem) &&
    Array.isArray(value.bills) &&
    value.bills.every(isCardBill) &&
    Array.isArray(value.oneOffs) &&
    value.oneOffs.every(isOneOffItem)
  );
}

import type {
  AppState,
  CardBill,
  OneOffItem,
  RecurringItem,
  Settings,
} from "./engine/types";
import { addMonths, currentMonth, isMonth } from "./engine/months";
import { normalizeSettings } from "./engine/project";

const STORAGE_KEY = "cashsim:v1";
const LEGACY_STORAGE_KEYS = ["cash-runway:v1"];

function readStoredState(): string | null {
  const current = localStorage.getItem(STORAGE_KEY);
  if (current) return current;

  for (const key of LEGACY_STORAGE_KEYS) {
    const legacy = localStorage.getItem(key);
    if (legacy) return legacy;
  }
  return null;
}

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
    version: 1,
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
      },
      {
        id: uid(),
        name: "房贷",
        amount: 1_400_000,
        type: "fixed",
        startMonth: start,
        remainingMonths: 216,
      },
      {
        id: uid(),
        name: "车贷",
        amount: 400_000,
        type: "fixed",
        startMonth: start,
        remainingMonths: 8,
      },
    ],
    bills: [
      {
        id: uid(),
        month: start,
        cardName: "招行信用卡",
        amount: 900_000,
      },
      {
        id: uid(),
        month: start,
        cardName: "中信信用卡",
        amount: 600_000,
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

export function loadState(): AppState {
  try {
    const raw = readStoredState();
    if (!raw) return sampleState();

    const parsed: unknown = JSON.parse(raw);
    if (!isAppState(parsed)) return sampleState();

    const normalized = normalizeState(parsed);
    saveState(normalized);
    return normalized;
  } catch {
    return sampleState();
  }
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage may be unavailable (private mode, quota). The app still works in memory.
  }
}

export function clearLocalState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    for (const key of LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

export function normalizeState(state: AppState): AppState {
  return {
    ...state,
    version: 1,
    settings: normalizeSettings(state.settings),
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
      (isFiniteNumber(value.remainingMonths) && value.remainingMonths > 0))
  );
}

function isCardBill(value: unknown): value is CardBill {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "string" &&
    isMonth(value.month) &&
    typeof value.cardName === "string" &&
    isFiniteNumber(value.amount) &&
    (value.note === undefined || typeof value.note === "string")
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
  return (
    isSettings(value.settings) &&
    Array.isArray(value.items) &&
    value.items.every(isRecurringItem) &&
    Array.isArray(value.bills) &&
    value.bills.every(isCardBill) &&
    Array.isArray(value.oneOffs) &&
    value.oneOffs.every(isOneOffItem)
  );
}

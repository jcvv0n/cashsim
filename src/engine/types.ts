export type Cents = number;
export type Month = string; // "YYYY-MM"

export type ItemType = "income" | "fixed";

export interface Settings {
  startMonth: Month;
  openingCash: Cents;
  safetyFloor: Cents;
  horizonMonths: number;
  monthlyBudget: Cents;
  budgetStartMonth: Month;
}

export interface RecurringItem {
  id: string;
  name: string;
  amount: Cents; // 正数，方向由 type 决定
  type: ItemType;
  startMonth: Month;
  endMonth?: Month; // 含本月
  remainingMonths?: number; // 优先于 endMonth
}

export interface CardBill {
  id: string;
  month: Month; // 还款月份，不是消费月份
  cardName: string;
  amount: Cents;
  note?: string;
}

export interface OneOffItem {
  id: string;
  month: Month;
  name: string;
  amount: Cents; // 正=收入，负=支出
  enabled: boolean;
}

export interface AppState {
  version: 1;
  settings: Settings;
  items: RecurringItem[];
  bills: CardBill[];
  oneOffs: OneOffItem[];
}

export type RowStatus = "normal" | "warning" | "danger";
export type LivingSource = "actual" | "budget" | "none";

export interface MonthRow {
  month: Month;
  income: Cents;
  fixed: Cents;
  living: Cents;
  livingSource: LivingSource;
  oneOff: Cents;
  incomeCount: number;
  fixedCount: number;
  billCount: number;
  oneOffCount: number;
  net: Cents;
  balance: Cents;
  status: RowStatus;
}

export interface Metrics {
  firstBelowFloor?: Month;
  firstNegative?: Month;
  minBalance: Cents;
  minBalanceMonth?: Month;
  maxGap: Cents;
  avgOutflow: Cents;
  avgNet: Cents;
  runwayMonths: number | null;
}

export interface Projection {
  rows: MonthRow[];
  metrics: Metrics;
}

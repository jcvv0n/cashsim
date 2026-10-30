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
  enabled?: boolean; // 缺省视为启用；禁用后不参与计算
}

export interface CardBill {
  id: string;
  month: Month; // 还款月份，不是消费月份
  cardName: string;
  amount: Cents;
  note?: string;
  enabled?: boolean; // 缺省视为启用；禁用后不参与计算
  /** 已包含在本账单金额里的固定还款（分期）id，这些分期在该月不再重复计入 */
  includedFixedIds?: string[];
}

export interface OneOffItem {
  id: string;
  month: Month;
  name: string;
  amount: Cents; // 正=收入，负=支出
  enabled: boolean;
}

export interface AppState {
  /** 数据结构版本；沙盘数据的毫秒时间戳版本号存放在 WorkspaceRecord.version */
  schemaVersion: 1;
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

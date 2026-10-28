import { describe, expect, it } from "vitest";
import type {
  AppState,
  CardBill,
  OneOffItem,
  RecurringItem,
  Settings,
} from "./types";
import { addMonths, monthRange } from "./months";
import { effectiveEndMonth, project } from "./project";

function makeState(
  partial: {
    settings?: Partial<Settings>;
    items?: RecurringItem[];
    bills?: CardBill[];
    oneOffs?: OneOffItem[];
  } = {},
): AppState {
  return {
    version: 1,
    settings: {
      startMonth: "2026-01",
      openingCash: 0,
      safetyFloor: 0,
      horizonMonths: 3,
      monthlyBudget: 0,
      budgetStartMonth: "2026-02",
      ...partial.settings,
    },
    items: partial.items ?? [],
    bills: partial.bills ?? [],
    oneOffs: partial.oneOffs ?? [],
  };
}

describe("months", () => {
  it("adds months across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-01", 12)).toBe("2027-01");
    expect(addMonths("2026-01", 0)).toBe("2026-01");
  });

  it("builds a month range", () => {
    expect(monthRange("2026-11", 3)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });
});

describe("project", () => {
  it("calculates income, fixed payments, budget and balance", () => {
    const state = makeState({
      settings: {
        openingCash: 100_000,
        monthlyBudget: 50_000,
        budgetStartMonth: "2026-01",
      },
      items: [
        {
          id: "i1",
          name: "工资",
          amount: 200_000,
          type: "income",
          startMonth: "2026-01",
        },
        {
          id: "f1",
          name: "房贷",
          amount: 80_000,
          type: "fixed",
          startMonth: "2026-01",
        },
      ],
    });

    const { rows } = project(state);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      income: 200_000,
      fixed: 80_000,
      living: 50_000,
      net: 70_000,
      balance: 170_000,
      incomeCount: 1,
      fixedCount: 1,
      billCount: 0,
      oneOffCount: 0,
    });
    expect(rows[1].balance).toBe(240_000);
    expect(rows[2].balance).toBe(310_000);
  });

  it("starts the living budget from budgetStartMonth", () => {
    const state = makeState({
      settings: { monthlyBudget: 50_000, budgetStartMonth: "2026-02" },
    });
    const { rows } = project(state);

    expect(rows[0].living).toBe(0);
    expect(rows[0].livingSource).toBe("none");
    expect(rows[1].living).toBe(50_000);
    expect(rows[1].livingSource).toBe("budget");
  });

  it("uses actual bills instead of the budget in the same month", () => {
    const state = makeState({
      settings: { monthlyBudget: 90_000, budgetStartMonth: "2026-01" },
      bills: [
        { id: "b1", month: "2026-01", cardName: "招行", amount: 30_000 },
        { id: "b2", month: "2026-01", cardName: "中信", amount: 20_000 },
      ],
    });
    const { rows } = project(state);

    expect(rows[0].living).toBe(50_000);
    expect(rows[0].livingSource).toBe("actual");
    expect(rows[0].billCount).toBe(2);
    expect(rows[1].living).toBe(90_000);
    expect(rows[1].livingSource).toBe("budget");
  });

  it("honors an inclusive endMonth", () => {
    const state = makeState({
      items: [
        {
          id: "f1",
          name: "车贷",
          amount: 10_000,
          type: "fixed",
          startMonth: "2026-01",
          endMonth: "2026-02",
        },
      ],
    });
    const { rows } = project(state);

    expect(rows.map((row) => row.fixed)).toEqual([10_000, 10_000, 0]);
  });

  it("converts remainingMonths to an end month and gives it priority", () => {
    const item: RecurringItem = {
      id: "f1",
      name: "分期",
      amount: 10_000,
      type: "fixed",
      startMonth: "2026-01",
      remainingMonths: 2,
      endMonth: "2026-03",
    };
    expect(effectiveEndMonth(item)).toBe("2026-02");

    const state = makeState({
      settings: { horizonMonths: 4 },
      items: [item],
    });
    const { rows } = project(state);
    expect(rows.map((row) => row.fixed)).toEqual([10_000, 10_000, 0, 0]);
  });

  it("applies signed one-off events and respects the enabled flag", () => {
    const state = makeState({
      settings: { openingCash: 100_000 },
      oneOffs: [
        {
          id: "o1",
          month: "2026-02",
          name: "装修",
          amount: -40_000,
          enabled: true,
        },
        {
          id: "o2",
          month: "2026-02",
          name: "年终奖",
          amount: 50_000,
          enabled: false,
        },
      ],
    });
    const { rows } = project(state);

    expect(rows[1].oneOff).toBe(-40_000);
    expect(rows[1].oneOffCount).toBe(1);
    expect(rows[1].balance).toBe(60_000);
  });

  it("marks warning and danger rows relative to the safety floor", () => {
    const warning = project(
      makeState({
        settings: { openingCash: 0, safetyFloor: 50_000 },
      }),
    );
    expect(warning.rows[0].balance).toBe(0);
    expect(warning.rows[0].status).toBe("warning");

    const danger = project(
      makeState({
        settings: { openingCash: 0, safetyFloor: 50_000 },
        items: [
          {
            id: "f1",
            name: "房贷",
            amount: 10_000,
            type: "fixed",
            startMonth: "2026-01",
          },
        ],
      }),
    );
    expect(danger.rows[0].balance).toBe(-10_000);
    expect(danger.rows[0].status).toBe("danger");

    const normal = project(
      makeState({
        settings: { openingCash: 100_000, safetyFloor: 50_000 },
      }),
    );
    expect(normal.rows[0].status).toBe("normal");
  });

  it("calculates metrics from the projected rows", () => {
    const state = makeState({
      settings: {
        openingCash: 100_000,
        safetyFloor: 50_000,
        horizonMonths: 3,
      },
      items: [
        {
          id: "f1",
          name: "房贷",
          amount: 60_000,
          type: "fixed",
          startMonth: "2026-01",
        },
      ],
    });
    const { rows, metrics } = project(state);

    expect(rows.map((row) => row.balance)).toEqual([40_000, -20_000, -80_000]);
    expect(metrics.firstBelowFloor).toBe("2026-01");
    expect(metrics.firstNegative).toBe("2026-02");
    expect(metrics.minBalance).toBe(-80_000);
    expect(metrics.minBalanceMonth).toBe("2026-03");
    expect(metrics.maxGap).toBe(130_000);
    expect(metrics.avgOutflow).toBe(60_000);
    expect(metrics.avgNet).toBe(-60_000);
    expect(metrics.runwayMonths).toBeCloseTo(1.6667, 3);
  });

  it("returns a null runway when there is no recurring outflow", () => {
    const { metrics } = project(
      makeState({ settings: { openingCash: 100_000 } }),
    );
    expect(metrics.runwayMonths).toBeNull();
  });
});

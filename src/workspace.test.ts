import { describe, expect, it } from "vitest";
import {
  formatSavedAt,
  makeWorkspace,
  nextVersion,
  normalizeWorkspaceName,
  shouldAdoptRemote,
  sortedWorkspaces,
  uniqueWorkspaceName,
} from "./workspace";
import { isAppState, normalizeState, sampleState } from "./state";
import type { AppState } from "./engine/types";

describe("workspace versions", () => {
  it("always moves forward by at least 1ms", () => {
    const future = Date.now() + 60_000;
    expect(nextVersion(future)).toBe(future + 1);
    expect(nextVersion(0)).toBeGreaterThanOrEqual(Date.now());
  });

  it("adopts remote data when its version is larger or local is provisional", () => {
    expect(shouldAdoptRemote({ version: 10 }, { version: 11 })).toBe(true);
    expect(shouldAdoptRemote({ version: 11 }, { version: 10 })).toBe(false);
    expect(
      shouldAdoptRemote({ version: 11, provisional: true }, { version: 10 }),
    ).toBe(true);
  });
});

describe("state compatibility", () => {
  it("rounds every amount to whole yuan", () => {
    const state = sampleState();
    state.settings.openingCash = 123_456;
    state.settings.safetyFloor = 4_949;
    state.settings.monthlyBudget = 1_050;
    state.items[0].amount = 9_999;
    state.bills[0].amount = 1_050;
    state.oneOffs[0].amount = -2_250;

    const normalized = normalizeState(state);
    expect(normalized.settings.openingCash).toBe(123_500);
    expect(normalized.settings.safetyFloor).toBe(4_900);
    expect(normalized.settings.monthlyBudget).toBe(1_100);
    expect(normalized.items[0].amount).toBe(10_000);
    expect(normalized.bills[0].amount).toBe(1_100);
    expect(normalized.oneOffs[0].amount).toBe(-2_300);
  });

  it("accepts legacy version:1 and normalizes it to schemaVersion:1", () => {
    const legacy = JSON.parse(JSON.stringify(sampleState())) as Record<
      string,
      unknown
    >;
    delete legacy.schemaVersion;
    legacy.version = 1;

    expect(isAppState(legacy)).toBe(true);
    const normalized = normalizeState(legacy as unknown as AppState);
    expect(normalized.schemaVersion).toBe(1);
    expect("version" in normalized).toBe(false);
  });
});

describe("workspace names", () => {
  it("normalizes and validates names", () => {
    expect(normalizeWorkspaceName("  我的推演  ")).toBe("我的推演");
    expect(normalizeWorkspaceName("   ")).toBeNull();
    expect(normalizeWorkspaceName("x".repeat(41))).toBeNull();
  });

  it("generates unique names", () => {
    const first = makeWorkspace("新沙盘", sampleState());
    const second = makeWorkspace("新沙盘 2", sampleState());
    expect(uniqueWorkspaceName("新沙盘", [first, second])).toBe("新沙盘 3");
  });
});

describe("formatSavedAt", () => {
  const now = new Date(2026, 9, 29, 20, 0, 0);

  it("shows time only for today", () => {
    const iso = new Date(2026, 9, 29, 14, 3, 5).toISOString();
    expect(formatSavedAt(iso, now)).toBe("保存于 14:03:05");
  });

  it("includes the date for other days and years", () => {
    expect(formatSavedAt(new Date(2026, 9, 28, 9, 5, 1).toISOString(), now)).toBe(
      "保存于 10月28日 09:05:01",
    );
    expect(formatSavedAt(new Date(2025, 11, 31, 23, 59, 0).toISOString(), now)).toBe(
      "保存于 2025年12月31日",
    );
  });

  it("handles missing timestamps", () => {
    expect(formatSavedAt("", now)).toBe("尚未保存");
    expect(formatSavedAt("not-a-date", now)).toBe("尚未保存");
  });
});

describe("sortedWorkspaces", () => {
  it("orders by last saved time descending", () => {
    const older = makeWorkspace("旧", sampleState(), {
      updatedAt: "2026-10-01T00:00:00.000Z",
    });
    const newer = makeWorkspace("新", sampleState(), {
      updatedAt: "2026-10-02T00:00:00.000Z",
    });

    const sorted = sortedWorkspaces({
      schema: 2,
      currentId: older.id,
      workspaces: [older, newer],
    });
    expect(sorted.map((item) => item.name)).toEqual(["新", "旧"]);
  });
});

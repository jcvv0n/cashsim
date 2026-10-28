import "./style.css";
import type {
  AppState,
  CardBill,
  OneOffItem,
  RecurringItem,
} from "./engine/types";
import { addMonths } from "./engine/months";
import { effectiveEndMonth, isActive, project } from "./engine/project";
import {
  centsToInput,
  formatMonthLong,
  parseYuanToCents,
  todayISO,
} from "./format";
import {
  clearLocalState,
  isAppState,
  loadState,
  normalizeState,
  sampleState,
  saveState as saveLocalState,
  uid,
} from "./state";
import {
  ConflictError,
  fetchState,
  login,
  logout,
  saveState as saveRemoteState,
  UnauthorizedError,
  type StateResponse,
} from "./api";
import {
  billListHtml,
  initChart,
  oneOffListHtml,
  recurringListHtml,
  renderChart,
  renderKpis,
  renderTable,
} from "./render";
import { openEditorDialog } from "./dialog";
import {
  closeDetailPopover,
  initDetailPopover,
  openDetailPopover,
  type DetailColumn,
  type DetailData,
  type DetailItem,
} from "./detail";

type ListKind = "income" | "fixed" | "bill" | "oneoff";
type SyncStatus =
  | "connecting"
  | "synced"
  | "saving"
  | "local"
  | "error"
  | "auth";

let state: AppState = loadState();
let rev = 0;
let syncMode: "remote" | "local" = "local";
let saveTimer: number | undefined;

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const kpisElement = byId("kpis");
const tableBody = byId("projection-body");
const dialog = byId<HTMLDialogElement>("edit-dialog");
const fileInput = byId<HTMLInputElement>("file-input");
const bootScreen = byId("boot-screen");
const authScreen = byId("auth-screen");
const loginForm = byId<HTMLFormElement>("login-form");
const passcodeInput = byId<HTMLInputElement>("login-passcode");
const loginError = byId("login-error");
const syncStatus = byId("sync-status");
const logoutButton = byId<HTMLButtonElement>("btn-logout");

function refresh(): void {
  renderAll();
  saveLocalState(state);
  scheduleRemoteSave();
}

function renderAll(): void {
  closeDetailPopover();
  const projection = project(state);
  renderKpis(kpisElement, projection, state.settings);
  renderTable(tableBody, projection);
  renderChart(projection, state.settings);
  renderLists();
  syncSettings();
}

function scheduleRemoteSave(): void {
  if (syncMode !== "remote") return;

  window.clearTimeout(saveTimer);
  setSyncStatus("saving");

  saveTimer = window.setTimeout(async () => {
    try {
      const result = await saveRemoteState(state, rev);
      rev = result.rev;
      setSyncStatus("synced");
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        syncMode = "local";
        logoutButton.hidden = true;
        setSyncStatus("auth");
        showAuthScreen();
        return;
      }

      if (error instanceof ConflictError) {
        applyRemoteState(error.current);
        setSyncStatus("synced");
        window.alert("数据已在另一个页面更新，已加载最新版本。");
        return;
      }

      setSyncStatus("error");
    }
  }, 400);
}

function applyRemoteState(remote: StateResponse): void {
  if (!remote.data) return;
  state = normalizeState(remote.data);
  rev = remote.rev;
  saveLocalState(state);
  renderAll();
}

function setSyncStatus(status: SyncStatus): void {
  const labels: Record<SyncStatus, string> = {
    connecting: "连接中…",
    synced: "已同步",
    saving: "同步中…",
    local: "本地模式",
    error: "同步失败",
    auth: "未登录",
  };

  syncStatus.textContent = labels[status];
  syncStatus.className = `sync-status ${status}`;
}

function showAuthScreen(): void {
  authScreen.hidden = false;
  passcodeInput.value = "";
  loginError.textContent = "";
  window.setTimeout(() => passcodeInput.focus(), 0);
}

function hideAuthScreen(): void {
  authScreen.hidden = true;
}

function hideBootScreen(): void {
  bootScreen.hidden = true;
}

async function boot(): Promise<void> {
  setSyncStatus("connecting");

  try {
    const remote = await fetchState();

    if (remote.data) {
      state = normalizeState(remote.data);
      rev = remote.rev;
      saveLocalState(state);
    } else {
      // 首次部署：把本地缓存或示例数据迁移到 D1
      state = loadState();
      const saved = await saveRemoteState(state, remote.rev);
      rev = saved.rev;
      saveLocalState(state);
    }

    syncMode = "remote";
    logoutButton.hidden = false;
    setSyncStatus("synced");
    hideAuthScreen();
    hideBootScreen();
    renderAll();
  } catch (error) {
    if (error instanceof ConflictError) {
      applyRemoteState(error.current);
      syncMode = "remote";
      logoutButton.hidden = false;
      setSyncStatus("synced");
      hideAuthScreen();
      hideBootScreen();
      return;
    }

    if (error instanceof UnauthorizedError) {
      syncMode = "local";
      logoutButton.hidden = true;
      setSyncStatus("auth");
      hideBootScreen();
      showAuthScreen();
      return;
    }

    syncMode = "local";
    logoutButton.hidden = true;
    hideBootScreen();

    if (!authScreen.hidden) {
      // 登录成功但接口出错：在登录页显示原因，避免看起来毫无反应
      loginError.textContent = `登录成功，但加载数据失败：${
        error instanceof Error ? error.message : "未知错误"
      }`;
      setSyncStatus("error");
      return;
    }

    setSyncStatus("local");
    state = loadState();
    renderAll();
  }
}

function renderLists(): void {
  byId("income-list").innerHTML = recurringListHtml(
    state.items.filter((item) => item.type === "income"),
  );
  byId("fixed-list").innerHTML = recurringListHtml(
    state.items.filter((item) => item.type === "fixed"),
  );
  byId("bill-list").innerHTML = billListHtml(state.bills);
  byId("oneoff-list").innerHTML = oneOffListHtml(state.oneOffs);
}

function syncSettings(): void {
  setInputValue("set-start-month", state.settings.startMonth);
  setInputValue("set-opening-cash", centsToInput(state.settings.openingCash));
  setInputValue("set-safety-floor", centsToInput(state.settings.safetyFloor));
  setInputValue("set-budget", centsToInput(state.settings.monthlyBudget));
  setInputValue("set-budget-start", state.settings.budgetStartMonth);

  const horizon = byId<HTMLSelectElement>("set-horizon");
  const value = String(state.settings.horizonMonths);
  if (!Array.from(horizon.options).some((option) => option.value === value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${state.settings.horizonMonths} 个月`;
    horizon.append(option);
  }
  if (document.activeElement !== horizon) horizon.value = value;
}

function setInputValue(id: string, value: string): void {
  const element = document.getElementById(id);
  if (
    element instanceof HTMLInputElement &&
    document.activeElement !== element
  ) {
    element.value = value;
  }
}

byId<HTMLFormElement>("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
});

byId<HTMLFormElement>("settings-form").addEventListener("change", (event) => {
  const target = event.target;
  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLSelectElement)
  ) {
    return;
  }

  switch (target.id) {
    case "set-start-month": {
      if (!target.value) {
        syncSettings();
        return;
      }
      state.settings.startMonth = target.value;
      if (state.settings.budgetStartMonth < target.value) {
        state.settings.budgetStartMonth = addMonths(target.value, 1);
      }
      break;
    }
    case "set-opening-cash": {
      const cents = parseYuanToCents(target.value);
      if (cents === null || cents < 0) {
        syncSettings();
        return;
      }
      state.settings.openingCash = cents;
      break;
    }
    case "set-safety-floor": {
      const cents = parseYuanToCents(target.value);
      if (cents === null || cents < 0) {
        syncSettings();
        return;
      }
      state.settings.safetyFloor = cents;
      break;
    }
    case "set-budget": {
      const cents = parseYuanToCents(target.value);
      if (cents === null || cents < 0) {
        syncSettings();
        return;
      }
      state.settings.monthlyBudget = cents;
      break;
    }
    case "set-budget-start": {
      if (!target.value) {
        syncSettings();
        return;
      }
      state.settings.budgetStartMonth =
        target.value < state.settings.startMonth
          ? addMonths(state.settings.startMonth, 1)
          : target.value;
      break;
    }
    case "set-horizon": {
      const months = Number(target.value);
      if (!Number.isFinite(months) || months < 1) {
        syncSettings();
        return;
      }
      state.settings.horizonMonths = months;
      break;
    }
    default:
      return;
  }

  refresh();
});

byId("add-income").addEventListener("click", () =>
  openRecurringDialog("income"),
);
byId("add-fixed").addEventListener("click", () =>
  openRecurringDialog("fixed"),
);
byId("add-bill").addEventListener("click", () => openBillDialog());
byId("add-oneoff").addEventListener("click", () => openOneOffDialog());

function openRecurringDialog(
  kind: "income" | "fixed",
  item?: RecurringItem,
): void {
  const initial: Record<string, string> = item
    ? {
        id: item.id,
        name: item.name,
        amount: centsToInput(item.amount),
        startMonth: item.startMonth,
        endMonth: item.endMonth ?? "",
        remainingMonths: item.remainingMonths
          ? String(item.remainingMonths)
          : "",
      }
    : {
        name: "",
        amount: "",
        startMonth: state.settings.startMonth,
        endMonth: "",
        remainingMonths: "",
      };

  openEditorDialog(dialog, kind, initial, (form) => {
    const name = stringField(form, "name").trim();
    const amount = parseYuanToCents(stringField(form, "amount"));
    const startMonth = stringField(form, "startMonth");
    const endMonth = stringField(form, "endMonth");
    const remainingRaw = stringField(form, "remainingMonths").trim();
    const remainingMonths = remainingRaw ? Number(remainingRaw) : undefined;

    if (!name) return "请填写名称";
    if (amount === null || amount <= 0) return "金额必须大于 0";
    if (!startMonth) return "请选择起始月";
    if (endMonth && endMonth < startMonth) return "结束月不能早于起始月";
    if (
      remainingMonths !== undefined &&
      (!Number.isInteger(remainingMonths) || remainingMonths <= 0)
    ) {
      return "剩余期数必须是正整数";
    }

    const next: RecurringItem = {
      id: item?.id ?? uid(),
      name,
      amount,
      type: kind,
      startMonth,
      ...(endMonth ? { endMonth } : {}),
      ...(remainingMonths ? { remainingMonths } : {}),
    };

    if (item) {
      const index = state.items.findIndex((entry) => entry.id === item.id);
      if (index >= 0) state.items[index] = next;
    } else {
      state.items.push(next);
    }

    refresh();
    return null;
  });
}

function openBillDialog(bill?: CardBill): void {
  const initial: Record<string, string> = bill
    ? {
        id: bill.id,
        month: bill.month,
        cardName: bill.cardName,
        amount: centsToInput(bill.amount),
        note: bill.note ?? "",
      }
    : {
        month: state.settings.startMonth,
        cardName: "",
        amount: "",
        note: "",
      };

  openEditorDialog(dialog, "bill", initial, (form) => {
    const month = stringField(form, "month");
    const cardName = stringField(form, "cardName").trim();
    const amount = parseYuanToCents(stringField(form, "amount"));
    const note = stringField(form, "note").trim();

    if (!month) return "请选择还款月份";
    if (!cardName) return "请填写卡片名称";
    if (amount === null || amount <= 0) return "金额必须大于 0";

    const next: CardBill = {
      id: bill?.id ?? uid(),
      month,
      cardName,
      amount,
      ...(note ? { note } : {}),
    };

    if (bill) {
      const index = state.bills.findIndex((entry) => entry.id === bill.id);
      if (index >= 0) state.bills[index] = next;
    } else {
      state.bills.push(next);
    }

    refresh();
    return null;
  });
}

function openOneOffDialog(item?: OneOffItem): void {
  const initial: Record<string, string> = item
    ? {
        id: item.id,
        month: item.month,
        name: item.name,
        amount: centsToInput(item.amount),
        enabled: item.enabled ? "1" : "",
      }
    : {
        month: state.settings.startMonth,
        name: "",
        amount: "",
        enabled: "1",
      };

  openEditorDialog(dialog, "oneoff", initial, (form) => {
    const month = stringField(form, "month");
    const name = stringField(form, "name").trim();
    const amount = parseYuanToCents(stringField(form, "amount"));
    const enabled = form.get("enabled") !== null;

    if (!month) return "请选择月份";
    if (!name) return "请填写名称";
    if (amount === null || amount === 0) return "金额不能为 0";

    const next: OneOffItem = {
      id: item?.id ?? uid(),
      month,
      name,
      amount,
      enabled,
    };

    if (item) {
      const index = state.oneOffs.findIndex((entry) => entry.id === item.id);
      if (index >= 0) state.oneOffs[index] = next;
    } else {
      state.oneOffs.push(next);
    }

    refresh();
    return null;
  });
}

function buildDetail(
  month: string,
  column: DetailColumn,
): DetailData | null {
  const monthLabel = formatMonthLong(month);

  if (column === "income" || column === "fixed") {
    const type = column === "income" ? "income" : "fixed";
    const items = state.items.filter(
      (item) => item.type === type && isActive(item, month),
    );
    if (items.length === 0) return null;

    const detailItems: DetailItem[] = items.map((item) => ({
      name: item.name,
      meta: periodLabel(item),
      amount: type === "income" ? item.amount : -item.amount,
    }));

    return {
      title: type === "income" ? "收入明细" : "固定还款明细",
      subtitle: `${monthLabel} · ${items.length} 笔`,
      items: detailItems,
      total: detailItems.reduce((sum, item) => sum + item.amount, 0),
    };
  }

  if (column === "bills") {
    const bills = state.bills.filter((bill) => bill.month === month);
    if (bills.length === 0) return null;

    const items: DetailItem[] = bills.map((bill) => ({
      name: bill.cardName,
      meta: bill.note || "信用卡还款",
      amount: -bill.amount,
    }));

    return {
      title: "信用卡账单明细",
      subtitle: `${monthLabel} · ${bills.length} 笔`,
      items,
      total: items.reduce((sum, item) => sum + item.amount, 0),
    };
  }

  if (column === "living") {
    if (
      state.settings.monthlyBudget <= 0 ||
      month < state.settings.budgetStartMonth
    ) {
      return null;
    }

    return {
      title: "生活估算明细",
      subtitle: monthLabel,
      items: [
        {
          name: "每月生活费",
          meta: `从 ${formatMonthLong(state.settings.budgetStartMonth)} 起`,
          amount: -state.settings.monthlyBudget,
        },
      ],
      total: -state.settings.monthlyBudget,
    };
  }

  const events = state.oneOffs.filter(
    (event) => event.enabled && event.month === month,
  );
  if (events.length === 0) return null;

  const items: DetailItem[] = events.map((event) => ({
    name: event.name,
    meta: event.amount >= 0 ? "收入" : "支出",
    amount: event.amount,
  }));

  return {
    title: "一次性事件明细",
    subtitle: `${monthLabel} · ${events.length} 笔`,
    items,
    total: items.reduce((sum, item) => sum + item.amount, 0),
  };
}

function periodLabel(item: RecurringItem): string {
  const start = `自 ${formatMonthLong(item.startMonth)}`;
  if (item.remainingMonths) {
    return `${start} · 共 ${item.remainingMonths} 期`;
  }
  const end = effectiveEndMonth(item);
  if (end) return `${start} · 至 ${formatMonthLong(end)}`;
  return `${start} · 持续`;
}

function openDetailFromCell(cell: HTMLElement): void {
  const month = cell.dataset.month;
  const column = cell.dataset.column as DetailColumn | undefined;
  if (!month || !column) return;

  const detail = buildDetail(month, column);
  if (detail) openDetailPopover(cell, detail);
}

function bindList(listId: string, kind: ListKind): void {
  const list = byId(listId);

  list.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const button = target.closest<HTMLButtonElement>("button[data-action]");
    if (!button) return;

    const id = button.dataset.id;
    if (!id) return;

    if (button.dataset.action === "edit") {
      if (kind === "income" || kind === "fixed") {
        const item = state.items.find((entry) => entry.id === id);
        if (item) openRecurringDialog(kind, item);
      } else if (kind === "bill") {
        const bill = state.bills.find((entry) => entry.id === id);
        if (bill) openBillDialog(bill);
      } else {
        const item = state.oneOffs.find((entry) => entry.id === id);
        if (item) openOneOffDialog(item);
      }
      return;
    }

    if (button.dataset.action === "delete") {
      deleteEntry(kind, id);
    }
  });

  if (kind === "oneoff") {
    list.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (target.dataset.action !== "toggle") return;

      const item = state.oneOffs.find(
        (entry) => entry.id === target.dataset.id,
      );
      if (!item) return;

      item.enabled = target.checked;
      refresh();
    });
  }
}

function deleteEntry(kind: ListKind, id: string): void {
  if (kind === "income" || kind === "fixed") {
    const item = state.items.find((entry) => entry.id === id);
    if (!item || !confirm(`删除「${item.name}」？`)) return;
    state.items = state.items.filter((entry) => entry.id !== id);
  } else if (kind === "bill") {
    const bill = state.bills.find((entry) => entry.id === id);
    if (!bill || !confirm(`删除「${bill.cardName}」这笔账单？`)) return;
    state.bills = state.bills.filter((entry) => entry.id !== id);
  } else {
    const item = state.oneOffs.find((entry) => entry.id === id);
    if (!item || !confirm(`删除「${item.name}」？`)) return;
    state.oneOffs = state.oneOffs.filter((entry) => entry.id !== id);
  }
  refresh();
}

function stringField(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const passcode = passcodeInput.value;
  if (!passcode) return;

  const submitButton = loginForm.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  );
  if (submitButton) submitButton.disabled = true;
  loginError.textContent = "";

  try {
    const result = await login(passcode);
    if (!result.ok) {
      loginError.textContent = result.error ?? "密码不正确";
      passcodeInput.select();
      return;
    }
    passcodeInput.value = "";
    await boot();
  } catch {
    loginError.textContent = "网络错误，请稍后重试";
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
});

logoutButton.addEventListener("click", async () => {
  if (!confirm("退出登录？本地缓存也会被清除。")) return;
  await logout();
  clearLocalState();
  window.location.reload();
});

byId("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cashsim-${todayISO()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

byId("btn-import").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);
    if (!isAppState(parsed)) throw new Error("文件格式不正确");
    state = normalizeState(parsed);
    refresh();
  } catch (error) {
    alert(error instanceof Error ? error.message : "导入失败");
  } finally {
    fileInput.value = "";
  }
});

byId("btn-reset").addEventListener("click", () => {
  if (!confirm("重置为示例数据？当前数据会被覆盖。")) return;
  state = sampleState();
  refresh();
});

bindList("income-list", "income");
bindList("fixed-list", "fixed");
bindList("bill-list", "bill");
bindList("oneoff-list", "oneoff");

tableBody.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const cell = target.closest<HTMLElement>("[data-detail]");
  if (cell) openDetailFromCell(cell);
});

tableBody.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const cell = target.closest<HTMLElement>("[data-detail]");
  if (!cell) return;
  event.preventDefault();
  openDetailFromCell(cell);
});

initDetailPopover();
initChart(byId("chart"));
boot();

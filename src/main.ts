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
import { isAppState, normalizeState, sampleState, uid } from "./state";
import {
  clearWorkspaceStore,
  currentWorkspace,
  formatSavedAt,
  loadWorkspaceStore,
  makeWorkspace,
  nextVersion,
  normalizeWorkspaceName,
  saveWorkspaceStore,
  shouldAdoptRemote,
  sortedWorkspaces,
  uniqueWorkspaceName,
  type WorkspaceRecord,
  type WorkspaceStore,
} from "./workspace";
import {
  ConflictError,
  deleteWorkspace as apiDeleteWorkspace,
  fetchWorkspace,
  listWorkspaces,
  login,
  logout,
  NotFoundError,
  renameWorkspace as apiRenameWorkspace,
  saveWorkspace as apiSaveWorkspace,
  UnauthorizedError,
  type WorkspacePayload,
  type WorkspaceSummary,
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
import { openEditorDialog, openNameDialog } from "./dialog";
import { MonthPickerElement } from "./month-picker";
import {
  closeDetailPopover,
  initDetailPopover,
  openDetailPopover,
  type DetailColumn,
  type DetailData,
  type DetailItem,
} from "./detail";
import { escapeHtml } from "./html";

type ListKind = "income" | "fixed" | "bill" | "oneoff";
type SyncStatus =
  | "connecting"
  | "synced"
  | "saving"
  | "local"
  | "error"
  | "auth";

let store: WorkspaceStore = loadWorkspaceStore();
const initialRecord = initialCurrent(store);
let current: WorkspaceRecord = initialRecord;
let state: AppState = initialRecord.data ?? sampleState();
initialRecord.data = state;

let syncMode: "remote" | "local" = "local";
let syncStatusValue: SyncStatus = "connecting";
let saveTimer: number | undefined;
let refreshTimer: number | undefined;
let toastTimer: number | undefined;
let refreshing = false;
let lastRefreshAt = 0;
let autoRefreshStarted = false;
let switchToken = 0;

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
}

const kpisElement = byId("kpis");
const tableBody = byId("projection-body");
const dialog = byId<HTMLDialogElement>("edit-dialog");
const nameDialog = byId<HTMLDialogElement>("name-dialog");
const fileInput = byId<HTMLInputElement>("file-input");
const bootScreen = byId("boot-screen");
const authScreen = byId("auth-screen");
const loginForm = byId<HTMLFormElement>("login-form");
const passcodeInput = byId<HTMLInputElement>("login-passcode");
const loginError = byId("login-error");
const syncStatus = byId("sync-status");
const logoutButton = byId<HTMLButtonElement>("btn-logout");
const toastElement = byId("toast");

const workspaceMenu = byId("workspace-menu");
const workspaceButton = byId<HTMLButtonElement>("btn-workspace");
const workspaceNameElement = byId("workspace-name");
const workspacePopover = byId("workspace-popover");
const workspaceList = byId("workspace-list");
const newWorkspaceButton = byId<HTMLButtonElement>("btn-new-workspace");
const moreMenu = byId("more-menu");
const moreButton = byId<HTMLButtonElement>("btn-more");
const morePopover = byId("more-popover");

function initialCurrent(fromStore: WorkspaceStore): WorkspaceRecord {
  const record = currentWorkspace(fromStore);
  if (record.data) return record;

  const fallback = fromStore.workspaces.find((item) => item.data);
  if (fallback) {
    fromStore.currentId = fallback.id;
    return fallback;
  }

  record.data = sampleState();
  record.updatedAt = "";
  return record;
}

function requireData(record: WorkspaceRecord): AppState {
  if (!record.data) throw new Error("沙盘数据尚未加载");
  return record.data;
}

function persistLocal(): void {
  saveWorkspaceStore(store);
}

function refresh(): void {
  current.data = state;
  current.version = nextVersion(current.version);
  current.updatedAt = new Date().toISOString();
  persistLocal();
  renderAll();
  renderWorkspaceChrome();

  if (syncMode === "remote") {
    scheduleRemoteSave();
  } else {
    setSyncStatus("local");
  }
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

function renderWorkspaceChrome(): void {
  workspaceNameElement.textContent = current.name;
  workspaceButton.title = `当前沙盘：${current.name}`;
  renderSyncPill();
  renderWorkspaceList();
}

function renderSyncPill(): void {
  const saved = formatSavedAt(current.updatedAt);
  const labels: Record<SyncStatus, string> = {
    connecting: "连接中…",
    synced: current.updatedAt ? saved : "已同步",
    saving: "保存中…",
    local: current.updatedAt ? `本地${saved}` : "尚未保存",
    error: "同步失败 · 已存本地",
    auth: "未登录",
  };

  syncStatus.textContent = labels[syncStatusValue];
  syncStatus.className = `sync-status ${syncStatusValue}`;

  const exact = current.updatedAt ? new Date(current.updatedAt) : null;
  syncStatus.title =
    exact && !Number.isNaN(exact.getTime())
      ? `最后保存：${exact.toLocaleString("zh-CN")}`
      : "尚未保存";
}

function renderWorkspaceList(): void {
  const records = sortedWorkspaces(store);
  if (records.length === 0) {
    workspaceList.innerHTML = '<div class="item-empty">还没有沙盘</div>';
    return;
  }

  workspaceList.innerHTML = records
    .map((record) => {
      const isCurrent = record.id === current.id;
      return `
        <div class="workspace-row ${isCurrent ? "is-current" : ""}">
          <button type="button" class="workspace-row-main" data-action="switch" data-id="${escapeHtml(record.id)}">
            <span class="workspace-row-name">
              <span class="workspace-row-title">${escapeHtml(record.name)}</span>
              ${isCurrent ? '<span class="current-badge">当前</span>' : ""}
            </span>
            <span class="workspace-row-time">${escapeHtml(formatSavedAt(record.updatedAt))}</span>
          </button>
          <div class="workspace-row-actions">
            <button type="button" data-action="rename" data-id="${escapeHtml(record.id)}">重命名</button>
            <button type="button" data-action="delete" data-id="${escapeHtml(record.id)}" class="danger">删除</button>
          </div>
        </div>
      `;
    })
    .join("");
}

function setSyncStatus(status: SyncStatus): void {
  syncStatusValue = status;
  renderSyncPill();
}

function showToast(message: string): void {
  toastElement.textContent = message;
  toastElement.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastElement.hidden = true;
  }, 3600);
}

function setWorkspaceMenuOpen(open: boolean): void {
  workspacePopover.hidden = !open;
  workspaceButton.setAttribute("aria-expanded", String(open));
  if (open) renderWorkspaceList();
}

function setMoreMenuOpen(open: boolean): void {
  morePopover.hidden = !open;
  moreButton.setAttribute("aria-expanded", String(open));
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

function handleUnauthorized(): void {
  syncMode = "local";
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  logoutButton.hidden = true;
  setSyncStatus("auth");
  showAuthScreen();
}

/* ---------- 同步 ---------- */

function scheduleRemoteSave(delay = 500): void {
  if (syncMode !== "remote") return;

  window.clearTimeout(saveTimer);
  setSyncStatus("saving");
  saveTimer = window.setTimeout(() => {
    void saveCurrent();
  }, delay);
}

async function saveCurrent(): Promise<void> {
  if (syncMode !== "remote") return;
  const record = current;
  if (!record.data) return;
  saveTimer = undefined;

  const version = record.version;
  const data = record.data;

  try {
    const summary = await apiSaveWorkspace(record.id, {
      name: record.name,
      data,
      version,
    });

    record.synced = true;
    record.provisional = false;
    if (record.version <= version) {
      record.version = version;
      record.updatedAt = summary.updatedAt;
    }
    if (summary.name === record.name) record.nameDirty = false;

    persistLocal();

    if (record === current) {
      renderSyncPill();
      if (record.version > version) {
        scheduleRemoteSave(50);
      } else {
        setSyncStatus("synced");
      }
      if (record.nameDirty) void syncName(record);
    }
  } catch (error) {
    handleSyncError(error);
  }
}

async function pushWorkspace(record: WorkspaceRecord): Promise<void> {
  if (syncMode !== "remote" || !record.data) return;

  const version = nextVersion(record.version);
  try {
    const summary = await apiSaveWorkspace(record.id, {
      name: record.name,
      data: record.data,
      version,
    });

    record.synced = true;
    record.provisional = false;
    if (record.version <= version) {
      record.version = version;
      record.updatedAt = summary.updatedAt;
    }
    if (summary.name === record.name) record.nameDirty = false;

    persistLocal();

    if (record === current) {
      renderWorkspaceChrome();
      if (record.version > version) scheduleRemoteSave(50);
      else setSyncStatus("synced");
    }
    if (record.nameDirty) void syncName(record);
  } catch (error) {
    handleSyncError(error);
  }
}

async function syncName(record: WorkspaceRecord): Promise<void> {
  if (!record.nameDirty || syncMode !== "remote" || !record.synced) return;

  const name = record.name;
  try {
    const summary = await apiRenameWorkspace(record.id, name);
    record.name = summary.name;
    if (record.name === name) record.nameDirty = false;
    persistLocal();
    renderWorkspaceChrome();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      handleUnauthorized();
    }
    // 网络失败时保留 nameDirty，下次保存或刷新时重试
  }
}

function handleSyncError(error: unknown): void {
  if (error instanceof UnauthorizedError) {
    handleUnauthorized();
    return;
  }

  if (error instanceof ConflictError) {
    const remote = error.current;
    const record = store.workspaces.find((item) => item.id === remote.id);
    if (!record) return;

    if (remote.version >= record.version) {
      applyPayloadToRecord(record, remote);
      persistLocal();
      if (record === current) {
        state = requireData(record);
        renderAll();
        renderWorkspaceChrome();
        setSyncStatus("synced");
        showToast("其他设备保存了更新版本，已加载最新数据");
      } else {
        renderWorkspaceChrome();
      }
    } else {
      record.version = nextVersion(Math.max(record.version, remote.version));
      persistLocal();
      if (record === current) scheduleRemoteSave(200);
    }
    return;
  }

  setSyncStatus("error");
}

function applyPayloadToRecord(
  record: WorkspaceRecord,
  payload: WorkspacePayload,
): void {
  if (!record.nameDirty) record.name = payload.name;
  record.version = payload.version;
  record.updatedAt = payload.updatedAt;
  record.data = normalizeState(payload.data);
  record.synced = true;
  record.provisional = false;
}

/* ---------- 启动与版本对比 ---------- */

async function boot(): Promise<void> {
  setSyncStatus("connecting");

  try {
    const remoteList = await listWorkspaces();
    await reconcile(remoteList);
    syncMode = "remote";
    logoutButton.hidden = false;
    hideAuthScreen();
    hideBootScreen();

    renderAll();
    renderWorkspaceChrome();
    persistLocal();

    if (!current.synced) {
      await pushWorkspace(current);
    }
    await flushUnsyncedWorkspaces();
    if (current.nameDirty) await syncName(current);

    if (syncStatusValue !== "error") setSyncStatus("synced");
    startAutoRefresh();
  } catch (error) {
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
      loginError.textContent = `登录成功，但加载数据失败：${
        error instanceof Error ? error.message : "未知错误"
      }`;
      setSyncStatus("error");
      return;
    }

    ensureUsableCurrent();
    persistLocal();
    setSyncStatus("local");
    renderAll();
    renderWorkspaceChrome();
    showToast("无法连接服务端，已进入本地模式");
  }
}

function ensureUsableCurrent(): void {
  if (current.data) {
    state = current.data;
    return;
  }

  const fallback = store.workspaces.find((item) => item.data);
  if (fallback) {
    current = fallback;
    store.currentId = fallback.id;
    state = requireData(current);
    return;
  }

  // 当前沙盘只存在于云端且加载失败：新建一份本地数据，
  // 避免把示例数据挂到云端记录上、随后覆盖云端数据。
  const record = makeWorkspace(
    uniqueWorkspaceName("新沙盘", store.workspaces),
    sampleState(),
    {
      id: uid(),
      version: nextVersion(0),
      updatedAt: new Date().toISOString(),
    },
  );
  store.workspaces.push(record);
  current = record;
  store.currentId = record.id;
  state = requireData(record);
}

/**
 * 把远端列表与本地缓存合并。
 * 规则：版本号（毫秒时间戳）更大的数据为准；示例/旧版数据遇到云端数据时让位。
 * 返回当前沙盘是否被替换。
 */
async function reconcile(remoteList: WorkspaceSummary[]): Promise<boolean> {
  const remoteMap = new Map(remoteList.map((item) => [item.id, item]));
  let currentChanged = false;

  if (remoteList.length === 0) {
    // 云端为空：仅保留本地有数据的沙盘，并准备重新上传
    store.workspaces = store.workspaces.filter((item) => item.data !== null);
    for (const record of store.workspaces) record.synced = false;
  }

  // ---- 当前沙盘 ----
  const currentRemote = remoteMap.get(current.id);
  if (currentRemote) {
    if (shouldAdoptRemote(current, currentRemote)) {
      window.clearTimeout(saveTimer);
      saveTimer = undefined;
      const payload = await fetchWorkspace(current.id);
      applyPayloadToRecord(current, payload);
      state = requireData(current);
      currentChanged = true;
    } else {
      current.provisional = false;
      current.synced = current.version <= currentRemote.version;
      if (currentRemote.version === current.version) {
        if (!current.updatedAt) current.updatedAt = currentRemote.updatedAt;
        if (!current.nameDirty) current.name = currentRemote.name;
      }
    }
  } else if (remoteList.length > 0 && current.provisional) {
    // 旧版本地数据或首次示例数据，云端已有其他沙盘：放弃这份副本
    store.workspaces = store.workspaces.filter((item) => item !== current);
    currentChanged = true;
  } else if (remoteList.length > 0) {
    // 云端已删除当前沙盘：保留本地数据，稍后重新创建
    current.synced = false;
  }

  // ---- 其他本地沙盘 ----
  for (const record of [...store.workspaces]) {
    if (record === current) continue;

    const remote = remoteMap.get(record.id);
    if (!remote) {
      if (record.synced || (record.provisional && remoteList.length > 0)) {
        store.workspaces = store.workspaces.filter((item) => item !== record);
      }
      continue;
    }

    const wasProvisional = record.provisional === true;
    record.provisional = false;

    if (wasProvisional || remote.version > record.version) {
      record.version = remote.version;
      record.updatedAt = remote.updatedAt;
      record.data = null; // 切换过去时再拉取，避免一次下载全部沙盘
      record.synced = true;
      if (!record.nameDirty) record.name = remote.name;
    } else if (remote.version === record.version) {
      record.synced = true;
      if (!record.updatedAt) record.updatedAt = remote.updatedAt;
      if (!record.nameDirty) record.name = remote.name;
    } else {
      // 本地版本更新，等待上传
      record.synced = false;
      if (!record.nameDirty) record.name = remote.name;
    }
  }

  // ---- 云端新增沙盘 ----
  for (const remote of remoteList) {
    if (store.workspaces.some((item) => item.id === remote.id)) continue;
    store.workspaces.push({
      id: remote.id,
      name: remote.name,
      version: remote.version,
      updatedAt: remote.updatedAt,
      data: null,
      synced: true,
      provisional: false,
    });
  }

  // ---- 确保有一个可用的当前沙盘 ----
  let record = store.workspaces.find((item) => item.id === store.currentId);
  if (!record && store.workspaces.length > 0) {
    record = sortedWorkspaces(store)[0];
  }
  if (!record) {
    record = makeWorkspace(
      uniqueWorkspaceName("新沙盘", []),
      sampleState(),
      {
        id: uid(),
        version: nextVersion(0),
        updatedAt: new Date().toISOString(),
      },
    );
    store.workspaces.push(record);
  }

  if (record !== current) {
    current = record;
    store.currentId = record.id;
    currentChanged = true;
  }

  if (!current.data) {
    const remote = remoteMap.get(current.id);
    if (remote) {
      try {
        const payload = await fetchWorkspace(remote.id);
        applyPayloadToRecord(current, payload);
        currentChanged = true;
      } catch (error) {
        if (error instanceof UnauthorizedError) throw error;
        ensureUsableCurrent();
        return true;
      }
    } else {
      ensureUsableCurrent();
      return true;
    }
  }

  state = requireData(current);
  return currentChanged;
}

async function flushUnsyncedWorkspaces(): Promise<void> {
  for (const record of [...store.workspaces]) {
    if (record === current || record.synced || !record.data) continue;
    await pushWorkspace(record);
    if (syncMode !== "remote") return;
  }
}

async function refreshFromRemote(silent: boolean): Promise<void> {
  if (syncMode !== "remote" || refreshing) return;
  refreshing = true;

  try {
    const remoteList = await listWorkspaces();
    const changed = await reconcile(remoteList);
    lastRefreshAt = Date.now();
    persistLocal();

    if (changed) {
      renderAll();
      renderWorkspaceChrome();
      if (silent) showToast("已加载其他设备保存的最新版本");
    } else {
      renderWorkspaceChrome();
    }

    if (current.nameDirty) void syncName(current);

    const remoteCurrent = remoteList.find((item) => item.id === current.id);
    if (remoteCurrent) {
      if (current.version > remoteCurrent.version) {
        scheduleRemoteSave(100);
      } else if (syncStatusValue !== "saving") {
        setSyncStatus("synced");
      }
    } else if (!current.synced) {
      scheduleRemoteSave(100);
    }
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      handleUnauthorized();
    } else if (!silent) {
      setSyncStatus("error");
    }
  } finally {
    refreshing = false;
  }
}

function startAutoRefresh(): void {
  if (!autoRefreshStarted) {
    autoRefreshStarted = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void refreshFromRemote(true);
      }
    });
    window.addEventListener("focus", () => {
      if (Date.now() - lastRefreshAt > 20_000) {
        void refreshFromRemote(true);
      }
    });
  }

  window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") {
      void refreshFromRemote(true);
    }
  }, 60_000);
}

/* ---------- 沙盘操作 ---------- */

async function switchWorkspace(id: string): Promise<void> {
  if (id === current.id) {
    setWorkspaceMenuOpen(false);
    return;
  }

  const target = store.workspaces.find((item) => item.id === id);
  if (!target) return;

  const token = ++switchToken;

  if (!target.data) {
    if (syncMode !== "remote") {
      showToast("这个沙盘保存在云端，需要连接服务端后才能打开");
      return;
    }
    try {
      const payload = await fetchWorkspace(id);
      applyPayloadToRecord(target, payload);
    } catch (error) {
      if (error instanceof UnauthorizedError) handleUnauthorized();
      else showToast(error instanceof Error ? error.message : "加载沙盘失败");
      return;
    }
  } else if (syncMode === "remote" && target.synced) {
    // 切换前对比一次版本，避免打开旧数据
    try {
      const payload = await fetchWorkspace(id);
      if (payload.version > target.version) {
        applyPayloadToRecord(target, payload);
      } else if (payload.version < target.version) {
        target.synced = false;
      } else if (!target.nameDirty) {
        target.name = payload.name;
        target.updatedAt = payload.updatedAt;
      }
    } catch (error) {
      if (error instanceof NotFoundError) {
        target.synced = false;
      } else if (error instanceof UnauthorizedError) {
        handleUnauthorized();
        return;
      }
      // 网络失败时继续使用本地缓存
    }
  }

  if (token !== switchToken) return;

  current = target;
  store.currentId = target.id;
  state = requireData(target);
  persistLocal();
  renderAll();
  renderWorkspaceChrome();
  setWorkspaceMenuOpen(false);

  if (syncMode !== "remote") {
    setSyncStatus("local");
  } else if (!target.synced) {
    setSyncStatus("saving");
    void pushWorkspace(target);
  } else {
    setSyncStatus("synced");
  }

  if (syncMode === "remote" && target.nameDirty) void syncName(target);
}

function cloneState(value: AppState): AppState {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as AppState;
}

function createWorkspace(name: string, copyCurrent: boolean): void {
  const data =
    copyCurrent && current.data ? cloneState(current.data) : sampleState();
  const record = makeWorkspace(name, data, {
    id: uid(),
    version: nextVersion(0),
    updatedAt: new Date().toISOString(),
    provisional: false,
  });

  store.workspaces.push(record);
  current = record;
  store.currentId = record.id;
  state = data;

  persistLocal();
  renderAll();
  renderWorkspaceChrome();
  setWorkspaceMenuOpen(false);
  showToast(`已创建沙盘「${name}」`);

  if (syncMode === "remote") {
    setSyncStatus("saving");
    void pushWorkspace(record);
  } else {
    setSyncStatus("local");
  }
}

function renameRecord(record: WorkspaceRecord, name: string): void {
  record.name = name;
  record.nameDirty = true;
  persistLocal();
  renderWorkspaceChrome();
  if (syncMode === "remote" && record.synced) void syncName(record);
}

async function deleteRecord(record: WorkspaceRecord): Promise<void> {
  if (!confirm(`删除沙盘「${record.name}」？其中的数据和记录会一并删除，无法恢复。`)) {
    return;
  }

  if (syncMode === "remote" && record.synced) {
    try {
      await apiDeleteWorkspace(record.id);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        handleUnauthorized();
        return;
      }
      showToast(error instanceof Error ? error.message : "删除失败");
      return;
    }
  }

  const wasCurrent = record === current;
  store.workspaces = store.workspaces.filter((item) => item.id !== record.id);

  if (wasCurrent) {
    let next = store.workspaces.find((item) => item.data) ?? null;

    if (!next && syncMode === "remote") {
      const candidate = sortedWorkspaces(store)[0];
      if (candidate) {
        try {
          const payload = await fetchWorkspace(candidate.id);
          applyPayloadToRecord(candidate, payload);
          next = candidate;
        } catch (error) {
          if (error instanceof UnauthorizedError) handleUnauthorized();
        }
      }
    }

    if (!next) {
      next = makeWorkspace(
        uniqueWorkspaceName("新沙盘", store.workspaces),
        sampleState(),
        {
          id: uid(),
          version: nextVersion(0),
          updatedAt: new Date().toISOString(),
        },
      );
      store.workspaces.push(next);
      if (syncMode === "remote") void pushWorkspace(next);
    }

    current = next;
    store.currentId = next.id;
    state = requireData(next);
  }

  persistLocal();
  renderAll();
  renderWorkspaceChrome();

  if (wasCurrent) {
    if (syncMode !== "remote") setSyncStatus("local");
    else if (!current.synced) setSyncStatus("saving");
    else setSyncStatus("synced");
  }

  showToast(`已删除沙盘「${record.name}」`);
}

function openNewWorkspaceDialog(): void {
  openNameDialog(
    nameDialog,
    {
      title: "新建沙盘",
      initialName: uniqueWorkspaceName("新沙盘", store.workspaces),
      submitLabel: "创建",
      showCopy: true,
      copyLabel: "以当前沙盘的数据为起点",
      copyChecked: true,
    },
    (raw, copy) => {
      const name = normalizeWorkspaceName(raw);
      if (!name) return "请输入 1-40 个字符的名称";
      if (store.workspaces.some((item) => item.name === name)) {
        return "已有同名沙盘";
      }
      createWorkspace(name, copy);
      return null;
    },
  );
}

function openRenameDialog(record: WorkspaceRecord): void {
  openNameDialog(
    nameDialog,
    {
      title: "重命名沙盘",
      initialName: record.name,
      submitLabel: "保存",
    },
    (raw) => {
      const name = normalizeWorkspaceName(raw);
      if (!name) return "请输入 1-40 个字符的名称";
      if (
        store.workspaces.some(
          (item) => item.id !== record.id && item.name === name,
        )
      ) {
        return "已有同名沙盘";
      }
      renameRecord(record, name);
      return null;
    },
  );
}

/* ---------- 列表编辑 ---------- */

byId<HTMLFormElement>("settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
});

byId<HTMLFormElement>("settings-form").addEventListener("change", (event) => {
  const target = event.target;
  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLSelectElement) &&
    !(target instanceof MonthPickerElement)
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
  options: { item?: RecurringItem; copy?: boolean } = {},
): void {
  const { item, copy = false } = options;
  const editing = Boolean(item) && !copy;
  const initial: Record<string, string> = item
    ? {
        ...(editing ? { id: item.id } : {}),
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

  openEditorDialog(
    dialog,
    kind,
    initial,
    (form) => {
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
        id: editing && item ? item.id : uid(),
        name,
        amount,
        type: kind,
        startMonth,
        ...(endMonth ? { endMonth } : {}),
        ...(remainingMonths ? { remainingMonths } : {}),
      };

      if (editing && item) {
        const index = state.items.findIndex((entry) => entry.id === item.id);
        if (index >= 0) state.items[index] = next;
      } else {
        state.items.push(next);
      }

      refresh();
      return null;
    },
    copy ? "已填入原条目的数据，保存后会新增一条。" : undefined,
  );
}

function openBillDialog(
  options: { bill?: CardBill; copy?: boolean } = {},
): void {
  const { bill, copy = false } = options;
  const editing = Boolean(bill) && !copy;
  const initial: Record<string, string> = bill
    ? {
        ...(editing ? { id: bill.id } : {}),
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

  openEditorDialog(
    dialog,
    "bill",
    initial,
    (form) => {
      const month = stringField(form, "month");
      const cardName = stringField(form, "cardName").trim();
      const amount = parseYuanToCents(stringField(form, "amount"));
      const note = stringField(form, "note").trim();

      if (!month) return "请选择还款月份";
      if (!cardName) return "请填写卡片名称";
      if (amount === null || amount <= 0) return "金额必须大于 0";

      const next: CardBill = {
        id: editing && bill ? bill.id : uid(),
        month,
        cardName,
        amount,
        ...(note ? { note } : {}),
      };

      if (editing && bill) {
        const index = state.bills.findIndex((entry) => entry.id === bill.id);
        if (index >= 0) state.bills[index] = next;
      } else {
        state.bills.push(next);
      }

      refresh();
      return null;
    },
    copy ? "已填入原账单的数据，保存后会新增一条。" : undefined,
  );
}

function openOneOffDialog(
  options: { item?: OneOffItem; copy?: boolean } = {},
): void {
  const { item, copy = false } = options;
  const editing = Boolean(item) && !copy;
  const initial: Record<string, string> = item
    ? {
        ...(editing ? { id: item.id } : {}),
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

  openEditorDialog(
    dialog,
    "oneoff",
    initial,
    (form) => {
      const month = stringField(form, "month");
      const name = stringField(form, "name").trim();
      const amount = parseYuanToCents(stringField(form, "amount"));
      const enabled = form.get("enabled") !== null;

      if (!month) return "请选择月份";
      if (!name) return "请填写名称";
      if (amount === null || amount === 0) return "金额不能为 0";

      const next: OneOffItem = {
        id: editing && item ? item.id : uid(),
        month,
        name,
        amount,
        enabled,
      };

      if (editing && item) {
        const index = state.oneOffs.findIndex((entry) => entry.id === item.id);
        if (index >= 0) state.oneOffs[index] = next;
      } else {
        state.oneOffs.push(next);
      }

      refresh();
      return null;
    },
    copy ? "已填入原事件的数据，保存后会新增一条。" : undefined,
  );
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

  if (element instanceof MonthPickerElement) {
    if (element.value !== value) element.value = value;
    return;
  }

  if (
    element instanceof HTMLInputElement &&
    document.activeElement !== element
  ) {
    element.value = value;
  }
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

    if (button.dataset.action === "duplicate") {
      if (kind === "income" || kind === "fixed") {
        const item = state.items.find((entry) => entry.id === id);
        if (item) openRecurringDialog(kind, { item, copy: true });
      } else if (kind === "bill") {
        const bill = state.bills.find((entry) => entry.id === id);
        if (bill) openBillDialog({ bill, copy: true });
      } else {
        const item = state.oneOffs.find((entry) => entry.id === id);
        if (item) openOneOffDialog({ item, copy: true });
      }
      return;
    }

    if (button.dataset.action === "edit") {
      if (kind === "income" || kind === "fixed") {
        const item = state.items.find((entry) => entry.id === id);
        if (item) openRecurringDialog(kind, { item });
      } else if (kind === "bill") {
        const bill = state.bills.find((entry) => entry.id === id);
        if (bill) openBillDialog({ bill });
      } else {
        const item = state.oneOffs.find((entry) => entry.id === id);
        if (item) openOneOffDialog({ item });
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

/* ---------- 登录、导入导出 ---------- */

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
  setMoreMenuOpen(false);
  if (!confirm("退出登录？本地缓存也会被清除。")) return;

  try {
    await logout();
  } catch {
    // 网络失败也继续清除本地缓存
  }
  clearWorkspaceStore();
  window.location.reload();
});

function safeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\s]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "workspace"
  );
}

byId("btn-export").addEventListener("click", () => {
  setMoreMenuOpen(false);

  const payload = {
    format: "cashsim.workspace",
    schema: 2,
    id: current.id,
    name: current.name,
    version: current.version,
    updatedAt: current.updatedAt,
    data: state,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `cashsim-${safeFileName(current.name)}-${todayISO()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
});

byId("btn-import").addEventListener("click", () => {
  setMoreMenuOpen(false);
  fileInput.click();
});

interface ImportedWorkspace {
  name: string;
  version: number;
  data: AppState;
}

function parseImported(value: unknown, filename: string): ImportedWorkspace {
  if (isAppState(value)) {
    return {
      name: filename.replace(/\.json$/i, "") || "导入的沙盘",
      version: 0,
      data: normalizeState(value),
    };
  }

  if (typeof value === "object" && value !== null) {
    const candidate = value as Record<string, unknown>;
    if (isAppState(candidate.data)) {
      return {
        name:
          typeof candidate.name === "string" && candidate.name.trim()
            ? candidate.name
            : filename.replace(/\.json$/i, "") || "导入的沙盘",
        version:
          typeof candidate.version === "number" &&
          Number.isFinite(candidate.version)
            ? candidate.version
            : 0,
        data: normalizeState(candidate.data),
      };
    }
  }

  throw new Error("文件格式不正确");
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed: unknown = JSON.parse(text);
    const imported = parseImported(parsed, file.name);

    const name = uniqueWorkspaceName(
      normalizeWorkspaceName(imported.name) ?? "导入的沙盘",
      store.workspaces,
    );
    const record = makeWorkspace(name, imported.data, {
      id: uid(),
      version: nextVersion(Math.max(Date.now(), imported.version)),
      updatedAt: new Date().toISOString(),
      provisional: false,
    });

    store.workspaces.push(record);
    current = record;
    store.currentId = record.id;
    state = requireData(record);

    persistLocal();
    renderAll();
    renderWorkspaceChrome();

    if (syncMode === "remote") {
      setSyncStatus("saving");
      void pushWorkspace(record);
    } else {
      setSyncStatus("local");
    }
    showToast(`已导入为沙盘「${name}」`);
  } catch (error) {
    alert(error instanceof Error ? error.message : "导入失败");
  } finally {
    fileInput.value = "";
  }
});

byId("btn-reset").addEventListener("click", () => {
  setMoreMenuOpen(false);
  if (!confirm(`重置沙盘「${current.name}」为示例数据？当前沙盘的修改会被覆盖。`)) {
    return;
  }
  state = sampleState();
  refresh();
  showToast("当前沙盘已重置");
});

/* ---------- 沙盘菜单 ---------- */

workspaceButton.addEventListener("click", () => {
  setMoreMenuOpen(false);
  setWorkspaceMenuOpen(workspacePopover.hidden === true);
});

newWorkspaceButton.addEventListener("click", openNewWorkspaceDialog);

workspaceList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const button = target.closest<HTMLButtonElement>("button[data-action]");
  if (!button) return;

  const id = button.dataset.id;
  if (!id) return;
  const record = store.workspaces.find((item) => item.id === id);
  if (!record) return;

  if (button.dataset.action === "switch") {
    void switchWorkspace(id);
  } else if (button.dataset.action === "rename") {
    openRenameDialog(record);
  } else if (button.dataset.action === "delete") {
    void deleteRecord(record);
  }
});

moreButton.addEventListener("click", () => {
  setWorkspaceMenuOpen(false);
  setMoreMenuOpen(morePopover.hidden === true);
});

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Node)) return;

  if (!workspacePopover.hidden && !workspaceMenu.contains(target)) {
    setWorkspaceMenuOpen(false);
  }
  if (!morePopover.hidden && !moreMenu.contains(target)) {
    setMoreMenuOpen(false);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!workspacePopover.hidden) setWorkspaceMenuOpen(false);
  if (!morePopover.hidden) setMoreMenuOpen(false);
});

/* ---------- 表格明细与启动 ---------- */

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
renderWorkspaceChrome();
boot();

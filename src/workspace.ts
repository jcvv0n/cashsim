import type { AppState } from "./engine/types";
import { isAppState, normalizeState, sampleState, uid } from "./state";

const STORAGE_KEY = "cashsim:workspaces:v2";
const LEGACY_STORAGE_KEYS = ["cashsim:v1", "cash-runway:v1"];

export const DEFAULT_WORKSPACE_ID = "default";
export const DEFAULT_WORKSPACE_NAME = "默认沙盘";
export const MAX_WORKSPACE_NAME_LENGTH = 40;

/**
 * 一个沙盘（独立的推演场景）。version 是毫秒时间戳版本号：
 * 时间越大代表数据越新，同步时总是保留版本号更大的一份。
 */
export interface WorkspaceRecord {
  id: string;
  name: string;
  version: number;
  updatedAt: string; // ISO 时间；空字符串表示尚未保存过
  data: AppState | null; // 仅存在于云端的列表项在加载前为 null
  synced: boolean; // 是否已经存在于服务端
  provisional?: boolean; // 本地示例或旧版数据，遇到远端数据时让位
  nameDirty?: boolean; // 改名尚未同步到服务端
}

export interface WorkspaceStore {
  schema: 2;
  currentId: string;
  workspaces: WorkspaceRecord[];
}

export interface RemoteWorkspaceSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
}

export function nextVersion(previous: number): number {
  const base = Number.isFinite(previous) ? Math.floor(previous) : 0;
  return Math.max(Date.now(), base + 1);
}

export function normalizeWorkspaceName(raw: string): string | null {
  const name = raw.trim();
  if (!name || name.length > MAX_WORKSPACE_NAME_LENGTH) return null;
  return name;
}

export function uniqueWorkspaceName(
  base: string,
  existing: WorkspaceRecord[],
  ignoreId?: string,
): string {
  const names = new Set(
    existing.filter((item) => item.id !== ignoreId).map((item) => item.name),
  );
  if (!names.has(base)) return base;

  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

export function makeWorkspace(
  name: string,
  data: AppState,
  options: {
    id?: string;
    version?: number;
    updatedAt?: string;
    provisional?: boolean;
    synced?: boolean;
  } = {},
): WorkspaceRecord {
  return {
    id: options.id ?? uid(),
    name,
    version: options.version ?? Date.now(),
    updatedAt: options.updatedAt ?? "",
    data,
    synced: options.synced ?? false,
    ...(options.provisional ? { provisional: true } : {}),
  };
}

/** 远端版本是否应当覆盖本地记录。 */
export function shouldAdoptRemote(
  local: Pick<WorkspaceRecord, "version" | "provisional">,
  remote: Pick<RemoteWorkspaceSummary, "version">,
): boolean {
  return Boolean(local.provisional) || remote.version > local.version;
}

export function sortedWorkspaces(store: WorkspaceStore): WorkspaceRecord[] {
  return [...store.workspaces].sort((a, b) => {
    const timeDiff = timeOf(b.updatedAt) - timeOf(a.updatedAt);
    if (timeDiff !== 0) return timeDiff;
    return a.name.localeCompare(b.name, "zh-CN");
  });
}

function timeOf(iso: string): number {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
}

export function currentWorkspace(store: WorkspaceStore): WorkspaceRecord {
  return (
    store.workspaces.find((item) => item.id === store.currentId) ??
    store.workspaces[0] ??
    createInitialWorkspace()
  );
}

export function loadWorkspaceStore(): WorkspaceStore {
  const stored = readStore();
  if (stored) return stored;

  const legacy = readLegacyState();
  if (legacy) {
    return {
      schema: 2,
      currentId: DEFAULT_WORKSPACE_ID,
      workspaces: [
        makeWorkspace(DEFAULT_WORKSPACE_NAME, legacy, {
          id: DEFAULT_WORKSPACE_ID,
          version: 0,
          provisional: true,
        }),
      ],
    };
  }

  const workspace = createInitialWorkspace();
  return { schema: 2, currentId: workspace.id, workspaces: [workspace] };
}

function createInitialWorkspace(): WorkspaceRecord {
  return makeWorkspace(DEFAULT_WORKSPACE_NAME, sampleState(), {
    id: DEFAULT_WORKSPACE_ID,
    provisional: true,
  });
}

export function saveWorkspaceStore(store: WorkspaceStore): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage 可能不可用（隐私模式、配额）。应用仍可在内存中工作。
  }
}

export function clearWorkspaceStore(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    for (const key of LEGACY_STORAGE_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }
}

function readLegacyState(): AppState | null {
  for (const key of LEGACY_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (isAppState(parsed)) return normalizeState(parsed);
    } catch {
      // 尝试下一个旧 key
    }
  }
  return null;
}

function readStore(): WorkspaceStore | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || parsed.schema !== 2) return null;
    if (!Array.isArray(parsed.workspaces)) return null;

    const workspaces: WorkspaceRecord[] = [];
    for (const entry of parsed.workspaces) {
      if (!isObject(entry)) continue;
      if (typeof entry.id !== "string" || !entry.id) continue;
      if (typeof entry.name !== "string" || !entry.name.trim()) continue;
      if (typeof entry.version !== "number" || !Number.isFinite(entry.version)) {
        continue;
      }

      const data = isAppState(entry.data) ? normalizeState(entry.data) : null;
      workspaces.push({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
        data,
        synced: entry.synced === true,
        ...(entry.provisional === true ? { provisional: true } : {}),
        ...(entry.nameDirty === true ? { nameDirty: true } : {}),
      });
    }

    if (workspaces.length === 0) return null;

    const currentId =
      typeof parsed.currentId === "string" &&
      workspaces.some((item) => item.id === parsed.currentId)
        ? parsed.currentId
        : sortedWorkspaces({ schema: 2, currentId: "", workspaces })[0].id;

    return { schema: 2, currentId, workspaces };
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 面板与列表统一使用的“最后保存时间”文案。 */
export function formatSavedAt(iso: string, now = new Date()): string {
  if (!iso) return "尚未保存";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "尚未保存";

  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  if (date.toDateString() === now.toDateString()) {
    return `保存于 ${time}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `保存于 ${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
  }
  return `保存于 ${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

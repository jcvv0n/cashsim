import type { AppState } from "./engine/types";

export interface StateResponse {
  data: AppState | null;
  rev: number;
  updatedAt: string | null;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("未登录");
    this.name = "UnauthorizedError";
  }
}

export class ConflictError extends Error {
  constructor(public current: StateResponse) {
    super("数据已在别处更新");
    this.name = "ConflictError";
  }
}

export async function fetchState(): Promise<StateResponse> {
  const response = await fetch("/api/state", { credentials: "same-origin" });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error(`加载失败：${response.status}`);
  return response.json() as Promise<StateResponse>;
}

export async function saveState(
  data: AppState,
  rev: number,
): Promise<{ rev: number; updatedAt: string }> {
  const response = await fetch("/api/state", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ data, rev }),
  });

  if (response.status === 401) throw new UnauthorizedError();

  if (response.status === 409) {
    const current = (await response.json()) as StateResponse;
    throw new ConflictError(current);
  }

  if (!response.ok) throw new Error(`保存失败：${response.status}`);
  return response.json() as Promise<{ rev: number; updatedAt: string }>;
}

export async function login(
  passcode: string,
): Promise<{ ok: boolean; error?: string }> {
  const response = await fetch("/api/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode }),
  });

  if (response.ok) return { ok: true };

  try {
    const body = (await response.json()) as { error?: string };
    return { ok: false, error: body.error ?? "登录失败" };
  } catch {
    return { ok: false, error: `登录失败：${response.status}` };
  }
}

export async function logout(): Promise<void> {
  await fetch("/api/logout", {
    method: "POST",
    credentials: "same-origin",
  });
}

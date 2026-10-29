import type { AppState } from "./engine/types";

export interface WorkspaceSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface WorkspacePayload extends WorkspaceSummary {
  data: AppState;
}

export class UnauthorizedError extends Error {
  constructor() {
    super("未登录");
    this.name = "UnauthorizedError";
  }
}

export class NotFoundError extends Error {
  constructor() {
    super("沙盘不存在");
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(public current: WorkspacePayload) {
    super("数据版本较旧");
    this.name = "ConflictError";
  }
}

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const response = await fetch("/api/workspaces", {
    credentials: "same-origin",
  });
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    throw new Error(await errorMessage(response, "加载沙盘列表失败"));
  }

  const body = (await response.json()) as { workspaces?: unknown };
  if (!Array.isArray(body.workspaces)) return [];
  return body.workspaces as WorkspaceSummary[];
}

export async function fetchWorkspace(id: string): Promise<WorkspacePayload> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(id)}`,
    { credentials: "same-origin" },
  );
  if (response.status === 401) throw new UnauthorizedError();
  if (response.status === 404) throw new NotFoundError();
  if (!response.ok) {
    throw new Error(await errorMessage(response, "加载沙盘失败"));
  }

  const body = (await response.json()) as { workspace?: WorkspacePayload };
  if (!body.workspace) throw new Error("服务端返回的数据格式不正确");
  return body.workspace;
}

export async function saveWorkspace(
  id: string,
  payload: { name: string; data: AppState; version: number },
): Promise<WorkspaceSummary> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  if (response.status === 401) throw new UnauthorizedError();

  if (response.status === 409) {
    const body = (await response.json()) as {
      workspace?: WorkspacePayload;
      error?: string;
    };
    if (body.workspace) throw new ConflictError(body.workspace);
    throw new Error(body.error ?? "数据版本冲突");
  }

  if (!response.ok) {
    throw new Error(await errorMessage(response, "保存失败"));
  }

  const body = (await response.json()) as { workspace?: WorkspaceSummary };
  if (!body.workspace) throw new Error("服务端返回的数据格式不正确");
  return body.workspace;
}

export async function renameWorkspace(
  id: string,
  name: string,
): Promise<WorkspaceSummary> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    },
  );

  if (response.status === 401) throw new UnauthorizedError();
  if (response.status === 404) throw new NotFoundError();
  if (!response.ok) {
    throw new Error(await errorMessage(response, "重命名失败"));
  }

  const body = (await response.json()) as { workspace?: WorkspaceSummary };
  if (!body.workspace) throw new Error("服务端返回的数据格式不正确");
  return body.workspace;
}

export async function deleteWorkspace(id: string): Promise<void> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      credentials: "same-origin",
    },
  );

  if (response.status === 401) throw new UnauthorizedError();
  if (response.status === 404) return;
  if (!response.ok) {
    throw new Error(await errorMessage(response, "删除失败"));
  }
}

async function errorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // 响应不是 JSON 时退回状态码
  }
  return `${fallback}：${response.status}`;
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

import type { AppState } from "../src/engine/types";

interface Env {
  DB?: D1Database;
  ASSETS: Fetcher;
  APP_PASSCODE?: string;
  SESSION_SECRET?: string;
  COOKIE_NAME?: string;
  SESSION_TTL_SECONDS?: string;
}

const LEGACY_STATE_ID = "default";
const LEGACY_WORKSPACE_ID = "default";
const LEGACY_WORKSPACE_NAME = "默认沙盘";
const DEFAULT_COOKIE_NAME = "cashsim_session";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_BODY_BYTES = 1_000_000;
const MAX_NAME_LENGTH = 60;

// 与 migrations/*.sql 保持一致；首次访问时自动建表
const INIT_LEGACY_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS app_state (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
)`;

const INIT_WORKSPACES_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const INIT_WORKSPACES_INDEX_SQL =
  "CREATE INDEX IF NOT EXISTS idx_workspaces_updated_at ON workspaces (updated_at DESC)";

interface WorkspaceRow {
  id: string;
  name: string;
  data: string;
  version: number;
  created_at: string;
  updated_at: string;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  version: number;
  updatedAt: string;
  createdAt: string;
}

interface WorkspacePayload extends WorkspaceSummary {
  data: AppState;
}

// 每个 Worker isolate 最多执行一次建表；失败后清空以便下次重试
let schemaReady: Promise<void> | undefined;

function cookieName(env: Env): string {
  return env.COOKIE_NAME || DEFAULT_COOKIE_NAME;
}

function sessionTtl(env: Env): number {
  const value = Number(env.SESSION_TTL_SECONDS);
  return Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_SESSION_TTL_SECONDS;
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleApi(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  try {
    if (url.pathname === "/api/health") {
      return await handleHealth(env);
    }

    if (!env.APP_PASSCODE || !env.SESSION_SECRET) {
      return json(
        { error: "服务端未配置 APP_PASSCODE / SESSION_SECRET" },
        500,
      );
    }

    if (url.pathname === "/api/login" && request.method === "POST") {
      return await handleLogin(request, env);
    }

    if (url.pathname === "/api/logout" && request.method === "POST") {
      return handleLogout(request, env);
    }

    if (
      url.pathname === "/api/workspaces" ||
      url.pathname.startsWith("/api/workspaces/")
    ) {
      if (
        !(await isAuthenticated(
          request,
          env.SESSION_SECRET,
          cookieName(env),
        ))
      ) {
        return json({ error: "未登录" }, 401);
      }

      return await handleWorkspaces(request, env, url);
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status);
    }

    console.error("API error", error);

    if (isMissingTableError(error)) {
      return json(
        {
          error:
            "数据库未初始化，自动建表失败。请检查 D1 绑定，或手动执行 migrations 下的 SQL",
        },
        500,
      );
    }

    return json({ error: "服务器错误" }, 500);
  }
}

async function handleWorkspaces(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  if (url.pathname === "/api/workspaces") {
    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
    }
    return json({ workspaces: await listWorkspaces(env) });
  }

  let id: string;
  try {
    id = decodeURIComponent(url.pathname.slice("/api/workspaces/".length));
  } catch {
    return json({ error: "沙盘 ID 不正确" }, 400);
  }

  if (!isValidWorkspaceId(id)) {
    return json({ error: "沙盘 ID 不正确" }, 400);
  }

  switch (request.method) {
    case "GET":
      return await handleGetWorkspace(env, id);
    case "PUT":
      return await handlePutWorkspace(request, env, id);
    case "PATCH":
      return await handleRenameWorkspace(request, env, id);
    case "DELETE":
      return await handleDeleteWorkspace(env, id);
    default:
      return json({ error: "Method not allowed" }, 405, {
        Allow: "GET, PUT, PATCH, DELETE",
      });
  }
}

async function handleHealth(env: Env): Promise<Response> {
  if (!env.DB) {
    return json(
      {
        ok: false,
        db: "missing_binding",
        error: "服务端未配置 D1 数据库绑定（变量名 DB）",
      },
      500,
    );
  }

  try {
    await env.DB.prepare("SELECT 1 FROM workspaces LIMIT 1").first();
    return json({ ok: true, db: "ok" });
  } catch (error) {
    console.error("Health check DB error", error);

    if (isMissingTableError(error)) {
      return json(
        {
          ok: false,
          db: "missing_table",
          error:
            "数据库未初始化：缺少 workspaces 表。首次打开应用会自动建表；若仍失败请手动执行 migrations 下的 SQL",
        },
        500,
      );
    }

    return json({ ok: false, db: "error", error: "数据库访问失败" }, 500);
  }
}

function isMissingTableError(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message);
}

function requireDb(env: Env): D1Database {
  if (!env.DB) {
    throw new HttpError(500, "服务端未配置 D1 数据库绑定（变量名 DB）");
  }
  return env.DB;
}

function ensureSchema(env: Env): Promise<void> {
  if (!schemaReady) {
    const db = requireDb(env);
    schemaReady = (async () => {
      await db.prepare(INIT_LEGACY_SCHEMA_SQL).run();
      await db.prepare(INIT_WORKSPACES_SCHEMA_SQL).run();
      await db.prepare(INIT_WORKSPACES_INDEX_SQL).run();
      await migrateLegacyState(db);
    })().catch((error: unknown) => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

/** 旧版只有一个 app_state 行；首次升级时把它迁成“默认沙盘”。 */
async function migrateLegacyState(db: D1Database): Promise<void> {
  const count = await db
    .prepare("SELECT COUNT(*) AS n FROM workspaces")
    .first<{ n: number }>();
  if ((count?.n ?? 0) > 0) return;

  const legacy = await db
    .prepare("SELECT data, updated_at FROM app_state WHERE id = ?")
    .bind(LEGACY_STATE_ID)
    .first<{ data: string; updated_at: string }>();
  if (!legacy) return;

  const updatedAt = legacy.updated_at || new Date().toISOString();
  const parsed = Date.parse(updatedAt);
  const version =
    Number.isFinite(parsed) && parsed > 0 ? parsed : Date.now();

  await db
    .prepare(
      `INSERT OR IGNORE INTO workspaces
        (id, name, data, version, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      LEGACY_WORKSPACE_ID,
      LEGACY_WORKSPACE_NAME,
      legacy.data,
      version,
      updatedAt,
      updatedAt,
    )
    .run();

  // 迁移完成后移除旧行，避免删除全部沙盘后旧数据又被迁移回来
  await db
    .prepare("DELETE FROM app_state WHERE id = ?")
    .bind(LEGACY_STATE_ID)
    .run();
}

async function listWorkspaces(env: Env): Promise<WorkspaceSummary[]> {
  await ensureSchema(env);
  const { results } = await requireDb(env)
    .prepare(
      `SELECT id, name, version, created_at, updated_at
       FROM workspaces
       ORDER BY updated_at DESC, name ASC`,
    )
    .all<Omit<WorkspaceRow, "data">>();

  return results.map(summaryOf);
}

async function handleGetWorkspace(env: Env, id: string): Promise<Response> {
  await ensureSchema(env);
  const row = await getWorkspaceRow(requireDb(env), id);
  if (!row) return json({ error: "沙盘不存在" }, 404);
  return json({ workspace: payloadOf(row) });
}

async function handlePutWorkspace(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const body = await readJsonBody<{
    name?: unknown;
    data?: unknown;
    version?: unknown;
  }>(request);

  if (!isAppState(body.data)) {
    throw new HttpError(400, "数据结构不正确");
  }

  if (
    typeof body.version !== "number" ||
    !Number.isSafeInteger(body.version) ||
    body.version <= 0
  ) {
    throw new HttpError(400, "版本号必须是毫秒时间戳");
  }

  const name =
    typeof body.name === "string"
      ? normalizeName(body.name)
      : LEGACY_WORKSPACE_NAME;
  if (!name) {
    throw new HttpError(400, `沙盘名称需为 1-${MAX_NAME_LENGTH} 个字符`);
  }

  await ensureSchema(env);
  const db = requireDb(env);
  const now = new Date().toISOString();
  const dataJson = JSON.stringify(body.data);
  const existing = await getWorkspaceRow(db, id);

  if (!existing) {
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO workspaces
          (id, name, data, version, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, name, dataJson, body.version, now, now)
      .run();

    if (result.meta.changes > 0) {
      return json({
        workspace: {
          id,
          name,
          version: body.version,
          updatedAt: now,
          createdAt: now,
        } satisfies WorkspaceSummary,
      });
    }

    // 并发创建：退回到版本比较
    const current = await getWorkspaceRow(db, id);
    if (!current) throw new HttpError(500, "保存失败");
    return await compareAndUpdate(db, current, dataJson, body.version);
  }

  return await compareAndUpdate(db, existing, dataJson, body.version);
}

/**
 * 只有版本号更大的写入才会生效。版本号相同视为同一次保存（幂等），
 * 否则返回 409 和服务器上的最新数据，让客户端采用更大的版本。
 */
async function compareAndUpdate(
  db: D1Database,
  existing: WorkspaceRow,
  dataJson: string,
  version: number,
): Promise<Response> {
  if (version <= existing.version) {
    if (version === existing.version && existing.data === dataJson) {
      return json({ workspace: summaryOf(existing) });
    }
    return conflictResponse(existing);
  }

  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `UPDATE workspaces
       SET data = ?, version = ?, updated_at = ?
       WHERE id = ? AND version = ?`,
    )
    .bind(dataJson, version, now, existing.id, existing.version)
    .run();

  if (result.meta.changes === 0) {
    const current = await getWorkspaceRow(db, existing.id);
    if (!current) throw new HttpError(409, "沙盘已被删除");
    return conflictResponse(current);
  }

  return json({
    workspace: summaryOf({
      id: existing.id,
      name: existing.name,
      version,
      created_at: existing.created_at,
      updated_at: now,
    }),
  });
}

async function handleRenameWorkspace(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const body = await readJsonBody<{ name?: unknown }>(request);
  const name = typeof body.name === "string" ? normalizeName(body.name) : null;
  if (!name) {
    throw new HttpError(400, `沙盘名称需为 1-${MAX_NAME_LENGTH} 个字符`);
  }

  await ensureSchema(env);
  const db = requireDb(env);
  const existing = await getWorkspaceRow(db, id);
  if (!existing) return json({ error: "沙盘不存在" }, 404);

  if (existing.name !== name) {
    await db
      .prepare("UPDATE workspaces SET name = ? WHERE id = ?")
      .bind(name, id)
      .run();
  }

  return json({
    workspace: summaryOf({ ...existing, name }),
  });
}

async function handleDeleteWorkspace(env: Env, id: string): Promise<Response> {
  await ensureSchema(env);
  await requireDb(env)
    .prepare("DELETE FROM workspaces WHERE id = ?")
    .bind(id)
    .run();
  return json({ ok: true });
}

async function getWorkspaceRow(
  db: D1Database,
  id: string,
): Promise<WorkspaceRow | null> {
  return await db
    .prepare(
      `SELECT id, name, data, version, created_at, updated_at
       FROM workspaces WHERE id = ?`,
    )
    .bind(id)
    .first<WorkspaceRow>();
}

function summaryOf(row: Omit<WorkspaceRow, "data">): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function payloadOf(row: WorkspaceRow): WorkspacePayload {
  return {
    ...summaryOf(row),
    data: JSON.parse(row.data) as AppState,
  };
}

async function conflictResponse(row: WorkspaceRow): Promise<Response> {
  return json(
    {
      error: "数据版本较旧，已返回服务器上的最新版本",
      workspace: payloadOf(row),
    },
    409,
  );
}

function normalizeName(raw: string): string | null {
  const name = raw.trim();
  if (!name || name.length > MAX_NAME_LENGTH) return null;
  return name;
}

function isValidWorkspaceId(id: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

async function handleLogin(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJsonBody<{ passcode?: unknown }>(request);
  if (typeof body.passcode !== "string") {
    throw new HttpError(400, "请求格式不正确");
  }

  if (!timingSafeEqual(body.passcode, env.APP_PASSCODE ?? "")) {
    return json({ error: "密码不正确" }, 401);
  }

  const token = await createSession(env.SESSION_SECRET ?? "", sessionTtl(env));
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";

  return json({ ok: true }, 200, {
    "Set-Cookie": `${cookieName(env)}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionTtl(env)}${secure}`,
  });
}

function handleLogout(request: Request, env: Env): Response {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return json({ ok: true }, 200, {
    "Set-Cookie": `${cookieName(env)}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`,
  });
}

async function readJsonBody<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    throw new HttpError(413, "数据太大");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "JSON 格式不正确");
  }
}

function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  return (
    (candidate.schemaVersion === 1 || candidate.version === 1) &&
    typeof candidate.settings === "object" &&
    candidate.settings !== null &&
    Array.isArray(candidate.items) &&
    Array.isArray(candidate.bills) &&
    Array.isArray(candidate.oneOffs)
  );
}

async function isAuthenticated(
  request: Request,
  secret: string,
  name: string,
): Promise<boolean> {
  const cookies = parseCookies(request.headers.get("Cookie") ?? "");
  const token = cookies[name];
  if (!token) return false;

  const [expiresRaw, signature] = token.split(".");
  if (!expiresRaw || !signature) return false;

  const expires = Number(expiresRaw);
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) {
    return false;
  }

  const expected = await hmac(secret, expiresRaw);
  return timingSafeEqual(signature, expected);
}

async function createSession(
  secret: string,
  ttlSeconds: number,
): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = String(expires);
  return `${payload}.${await hmac(secret, payload)}`;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return toBase64Url(new Uint8Array(signature));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }

  return cookies;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

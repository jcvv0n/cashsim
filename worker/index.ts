import type { AppState } from "../src/engine/types";

interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_PASSCODE?: string;
  SESSION_SECRET?: string;
  COOKIE_NAME?: string;
  SESSION_TTL_SECONDS?: string;
}

const STATE_ID = "default";
const DEFAULT_COOKIE_NAME = "cashsim_session";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_BODY_BYTES = 1_000_000;

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
      return json({ ok: true });
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

    if (url.pathname === "/api/state") {
      if (
        !(await isAuthenticated(
          request,
          env.SESSION_SECRET,
          cookieName(env),
        ))
      ) {
        return json({ error: "未登录" }, 401);
      }

      if (request.method === "GET") {
        return json(await readState(env));
      }
      if (request.method === "PUT") {
        return await handlePutState(request, env);
      }

      return json({ error: "Method not allowed" }, 405, {
        Allow: "GET, PUT",
      });
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof HttpError) {
      return json({ error: error.message }, error.status);
    }
    console.error("API error", error);
    return json({ error: "服务器错误" }, 500);
  }
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

async function handlePutState(
  request: Request,
  env: Env,
): Promise<Response> {
  const body = await readJsonBody<{ data?: unknown; rev?: unknown }>(request);

  if (!isAppState(body.data) || typeof body.rev !== "number") {
    throw new HttpError(400, "数据格式不正确");
  }

  const now = new Date().toISOString();
  const existing = await env.DB.prepare(
    "SELECT rev FROM app_state WHERE id = ?",
  )
    .bind(STATE_ID)
    .first<{ rev: number }>();

  if (!existing) {
    await env.DB.prepare(
      "INSERT INTO app_state (id, data, rev, updated_at) VALUES (?, ?, 1, ?)",
    )
      .bind(STATE_ID, JSON.stringify(body.data), now)
      .run();

    return json({ rev: 1, updatedAt: now });
  }

  if (existing.rev !== body.rev) {
    return conflict(env);
  }

  const nextRev = existing.rev + 1;
  const result = await env.DB.prepare(
    "UPDATE app_state SET data = ?, rev = ?, updated_at = ? WHERE id = ? AND rev = ?",
  )
    .bind(JSON.stringify(body.data), nextRev, now, STATE_ID, body.rev)
    .run();

  if (result.meta.changes === 0) {
    return conflict(env);
  }

  return json({ rev: nextRev, updatedAt: now });
}

async function conflict(env: Env): Promise<Response> {
  const current = await readState(env);
  return json({ error: "数据已在别处更新", ...current }, 409);
}

async function readState(env: Env): Promise<{
  data: unknown;
  rev: number;
  updatedAt: string | null;
}> {
  const row = await env.DB.prepare(
    "SELECT data, rev, updated_at FROM app_state WHERE id = ?",
  )
    .bind(STATE_ID)
    .first<{ data: string; rev: number; updated_at: string }>();

  if (!row) {
    return { data: null, rev: 0, updatedAt: null };
  }

  return {
    data: JSON.parse(row.data),
    rev: row.rev,
    updatedAt: row.updated_at,
  };
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
    candidate.version === 1 &&
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

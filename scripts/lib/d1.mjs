import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const databaseName = "cashsim-db";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wrangler(args, options = {}) {
  return execFileSync("npx", ["wrangler", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    ...options,
  });
}

function parseJsonOutput(raw) {
  const start = raw.search(/[\[{]/);
  if (start === -1) throw new Error("无法解析 wrangler 输出");
  return JSON.parse(raw.slice(start));
}

function listDatabases() {
  const parsed = parseJsonOutput(wrangler(["d1", "list", "--json"]));
  if (Array.isArray(parsed)) return parsed;
  return parsed.result ?? parsed.databases ?? parsed.d1_databases ?? [];
}

function getDatabaseId(database) {
  if (!database) return undefined;
  const id = database.uuid ?? database.database_id ?? database.id;
  return typeof id === "string" && uuidPattern.test(id) ? id : undefined;
}

export function ensureD1() {
  const fromEnv = (process.env.DATABASE_ID || "").trim();
  if (fromEnv) {
    if (!uuidPattern.test(fromEnv)) {
      throw new Error("DATABASE_ID 不是合法 UUID");
    }
    return fromEnv;
  }

  const existing = listDatabases().find((db) => db.name === databaseName);
  const existingId = getDatabaseId(existing);
  if (existingId) return existingId;

  console.log(`D1 数据库 ${databaseName} 不存在，正在创建...`);
  const createOutput = wrangler(["d1", "create", databaseName], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  process.stdout.write(createOutput);

  const parsedId = createOutput.match(
    /database_id\s*[=:]\s*"([0-9a-f-]{36})"/i,
  )?.[1];
  if (parsedId && uuidPattern.test(parsedId)) return parsedId;

  const created = listDatabases().find((db) => db.name === databaseName);
  const createdId = getDatabaseId(created);
  if (!createdId) {
    throw new Error(`D1 数据库 ${databaseName} 创建后仍未找到 database_id`);
  }
  return createdId;
}

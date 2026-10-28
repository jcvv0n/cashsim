import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const templatePath = resolve(root, "wrangler.template.jsonc");
const outputPath = resolve(root, "wrangler.generated.jsonc");
const requireDatabaseId = process.argv.includes("--require");

const databaseId = (process.env.DATABASE_ID || "").trim();
const placeholder = "00000000-0000-0000-0000-000000000000";

if (requireDatabaseId && !databaseId) {
  console.error("DATABASE_ID is required for this command.");
  process.exit(1);
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (databaseId && !uuidPattern.test(databaseId)) {
  console.error("DATABASE_ID must be a valid UUID.");
  process.exit(1);
}

const template = readFileSync(templatePath, "utf8");
const rendered = template.replace(
  "__DATABASE_ID__",
  databaseId || placeholder,
);

writeFileSync(outputPath, rendered);

console.log(
  `wrangler.generated.jsonc written (database_id: ${
    databaseId ? "from DATABASE_ID" : "local placeholder"
  })`,
);

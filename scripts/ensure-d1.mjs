import { ensureD1 } from "./lib/d1.mjs";

try {
  const databaseId = ensureD1();
  console.log(databaseId);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(
    "提示：先运行 npx wrangler login，或设置 CLOUDFLARE_API_TOKEN。",
  );
  process.exit(1);
}

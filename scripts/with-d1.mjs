import { execFileSync } from "node:child_process";
import { delimiter, resolve } from "node:path";
import { ensureD1 } from "./lib/d1.mjs";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);

if (args[0] === "--") args.shift();
if (args.length === 0) {
  console.error("Usage: node scripts/with-d1.mjs -- <command> [...args]");
  process.exit(1);
}

const databaseId = (() => {
  try {
    return ensureD1();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(
      "提示：先运行 npx wrangler login，或设置 CLOUDFLARE_API_TOKEN。",
    );
    process.exit(1);
  }
})();
const env = {
  ...process.env,
  DATABASE_ID: databaseId,
  PATH: `${resolve(root, "node_modules/.bin")}${delimiter}${
    process.env.PATH ?? ""
  }`,
};

execFileSync(
  process.execPath,
  [resolve(root, "scripts/render-wrangler.mjs"), "--require"],
  { cwd: root, stdio: "inherit", env },
);

const [command, ...commandArgs] = args;
execFileSync(command, commandArgs, {
  cwd: root,
  stdio: "inherit",
  env,
});

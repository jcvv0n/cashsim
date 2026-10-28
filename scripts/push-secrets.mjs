import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const config = resolve(root, "wrangler.generated.jsonc");

const passcode = process.env.APP_PASSCODE;
const sessionSecret = process.env.SESSION_SECRET;

if (!passcode || !sessionSecret) {
  console.error("APP_PASSCODE and SESSION_SECRET are required.");
  process.exit(1);
}

for (const [name, value] of [
  ["APP_PASSCODE", passcode],
  ["SESSION_SECRET", sessionSecret],
]) {
  console.log(`Uploading ${name}...`);
  execFileSync(
    "npx",
    ["wrangler", "secret", "put", name, "--config", config],
    {
      cwd: root,
      input: `${value}\n`,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
}

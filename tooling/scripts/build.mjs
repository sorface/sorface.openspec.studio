import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const node = process.execPath;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const frontendRoot = resolve(repositoryRoot, "openspec.frontend");
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error?.code === "ENOENT") throw new Error(`${command} не найден`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(npm, ["run", "build:web"], frontendRoot);
run(node, [resolve(repositoryRoot, "tooling/scripts/build-backend.mjs")], repositoryRoot);

import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const goCommand = process.platform === "win32" ? "go.exe" : "go";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error?.code === "ENOENT") {
    throw new Error(`${command} не найден. Установите Go с https://go.dev/dl/`);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await mkdir("bin", { recursive: true });
run(npmCommand, ["run", "build:web"]);
run(goCommand, ["build", "-trimpath", "-o", process.platform === "win32" ? "bin/openspec-studio.exe" : "bin/openspec-studio", "./backend/cmd/openspec-studio"]);

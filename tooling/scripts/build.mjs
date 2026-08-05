import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const goCommand = process.platform === "win32" ? "go.exe" : "go";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const frontendRoot = resolve(repositoryRoot, "openspec.frontend");
const backendRoot = resolve(repositoryRoot, "openspec.backend");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error?.code === "ENOENT") {
    throw new Error(`${command} не найден. Установите Go с https://go.dev/dl/`);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const executable = resolve(repositoryRoot, process.platform === "win32" ? "out/bin/openspec-studio.exe" : "out/bin/openspec-studio");
await mkdir(resolve(repositoryRoot, "out/bin"), { recursive: true });
run(npmCommand, ["run", "build:web"], { cwd: frontendRoot });
run(goCommand, ["build", "-trimpath", "-o", executable, "./cmd/openspec-studio"], { cwd: backendRoot });

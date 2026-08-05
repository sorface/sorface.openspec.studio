import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const goCommand = process.platform === "win32" ? "go.exe" : "go";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const backendRoot = resolve(repositoryRoot, "openspec.backend");
const executable = resolve(repositoryRoot, process.platform === "win32"
  ? "out/bin/openspec-studio.exe"
  : "out/bin/openspec-studio");

await mkdir(resolve(repositoryRoot, "out/bin"), { recursive: true });

const result = spawnSync(
  goCommand,
  ["build", "-trimpath", "-o", executable, "./cmd/openspec-studio"],
  { stdio: "inherit", cwd: backendRoot },
);

if (result.error?.code === "ENOENT") {
  throw new Error(`${goCommand} не найден. Установите Go с https://go.dev/dl/`);
}
if (result.status !== 0) process.exit(result.status ?? 1);

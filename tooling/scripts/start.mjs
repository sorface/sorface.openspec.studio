import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const executable = resolve(repositoryRoot, process.platform === "win32" ? "out/bin/openspec-studio.exe" : "out/bin/openspec-studio");

try {
  await access(executable);
} catch {
  console.error("Приложение ещё не собрано. Выполните npm --prefix openspec.frontend run build.");
  process.exit(1);
}

const child = spawn(executable, [], { stdio: "inherit" });
child.once("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

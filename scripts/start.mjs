import { access } from "node:fs/promises";
import { spawn } from "node:child_process";

const executable = process.platform === "win32" ? "bin/openspec-studio.exe" : "bin/openspec-studio";

try {
  await access(executable);
} catch {
  console.error("Приложение ещё не собрано. Выполните npm run build.");
  process.exit(1);
}

const child = spawn(executable, [], { stdio: "inherit" });
child.once("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

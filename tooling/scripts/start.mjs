import { access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const artifact = resolve(repositoryRoot, "out/bin/openspec-studio.jar");
try { await access(artifact); } catch { console.error("Приложение ещё не собрано. Выполните npm --prefix openspec.frontend run build."); process.exit(1); }
const java = process.platform === "win32" ? "java.exe" : "java";
const child = spawn(java, ["-jar", artifact], { stdio: "inherit" });
child.once("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

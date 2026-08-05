import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const backendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../openspec.backend");
const maven = process.platform === "win32" ? "mvn.cmd" : "mvn";
const child = spawn(maven, ["spring-boot:run", "-Dspring-boot.run.arguments=--no-browser --address 127.0.0.1:8787"], { cwd: backendRoot, stdio: "inherit" });
child.once("error", (error) => { if (error.code === "ENOENT") console.error("Maven не найден. Установите Maven 3.9+ и JDK 21+."); process.exit(1); });
child.once("exit", (code) => process.exit(code ?? 0));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));

import { copyFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const backendRoot = resolve(repositoryRoot, "openspec.backend");
const maven = process.platform === "win32" ? "mvn.cmd" : "mvn";
const result = spawnSync(maven, ["-q", "-DskipTests", "package"], { cwd: backendRoot, stdio: "inherit" });
if (result.error?.code === "ENOENT") throw new Error("Maven не найден. Установите Maven 3.9+ и JDK 21+.");
if (result.status !== 0) process.exit(result.status ?? 1);
await mkdir(resolve(repositoryRoot, "out/bin"), { recursive: true });
await copyFile(resolve(backendRoot, "target/openspec-studio-backend-0.1.0-SNAPSHOT.jar"), resolve(repositoryRoot, "out/bin/openspec-studio.jar"));

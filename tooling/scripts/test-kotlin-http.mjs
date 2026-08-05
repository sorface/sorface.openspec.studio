import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const backendRoot = resolve(repositoryRoot, "openspec.backend");
const jar = resolve(backendRoot, "target/openspec-studio-backend-0.1.0-SNAPSHOT.jar");
const maven = process.platform === "win32" ? "mvn.cmd" : "mvn";
const built = spawnSync(maven, ["-q", "-DskipTests", "package"], { cwd: backendRoot, stdio: "inherit" });
if (built.status !== 0) process.exit(built.status ?? 1);
const dataDir = await mkdtemp(resolve(tmpdir(), "openspec-kotlin-http-"));
const port = 18787 + Math.floor(Math.random() * 1000);
const java = process.platform === "win32" ? "java.exe" : "java";
const server = spawn(java, ["-jar", jar, "--no-browser", "--address", `127.0.0.1:${port}`, "--data-dir", dataDir], { stdio: ["ignore", "pipe", "pipe"] });
let diagnostics = "";
server.stdout.on("data", (chunk) => { diagnostics += chunk.toString(); });
server.stderr.on("data", (chunk) => { diagnostics += chunk.toString(); });
try {
  const base = `http://127.0.0.1:${port}`;
  let health;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try { const response = await fetch(`${base}/api/v1/system/health`); if (response.ok) { health = await response.json(); break; } } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(health?.status, "ready", `Kotlin HTTP server did not become ready\n${diagnostics.slice(-4000)}`);
  const sessionResponse = await fetch(`${base}/api/v1/system/session`);
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  assert.ok(session.csrfToken);
  const projects = await fetch(`${base}/api/v1/projects`);
  assert.equal(projects.status, 200);
  assert.deepEqual(await projects.json(), { items: [] });
  console.log("Kotlin HTTP integration: health, session и projects API доступны");
} finally {
  server.kill("SIGTERM");
  await new Promise((resolve) => { server.once("exit", resolve); setTimeout(resolve, 3000); });
  await rm(dataDir, { recursive: true, force: true });
}

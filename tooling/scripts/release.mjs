import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const targets = [
  ["darwin", "arm64"],
  ["darwin", "amd64"],
  ["linux", "amd64"],
  ["linux", "arm64"],
  ["windows", "amd64"],
];
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

run(npmCommand, ["run", "build:web"], { cwd: frontendRoot });
await mkdir(resolve(repositoryRoot, "out/release"), { recursive: true });

for (const [goos, goarch] of targets) {
  const suffix = goos === "windows" ? ".exe" : "";
  const output = resolve(repositoryRoot, `out/release/openspec-studio-${goos}-${goarch}${suffix}`);
  run(goCommand, ["build", "-trimpath", "-ldflags=-s -w", "-o", output, "./cmd/openspec-studio"], {
    cwd: backendRoot,
    env: { ...process.env, CGO_ENABLED: "0", GOOS: goos, GOARCH: goarch },
  });
}

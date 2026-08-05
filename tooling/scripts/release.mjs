import { mkdir, rm, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { arch, platform } from "node:process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const frontendRoot = resolve(repositoryRoot, "openspec.frontend");
const backendRoot = resolve(repositoryRoot, "openspec.backend");
const npm = platform === "win32" ? "npm.cmd" : "npm";
const maven = platform === "win32" ? "mvn.cmd" : "mvn";
const jpackage = platform === "win32" ? "jpackage.exe" : "jpackage";
const osName = { darwin: "darwin", linux: "linux", win32: "windows" }[platform];
const archName = { arm64: "arm64", x64: "amd64" }[arch];
if (!osName || !archName) throw new Error(`Неподдерживаемая release platform: ${platform}/${arch}`);
const asset = `openspec-studio-${osName}-${archName}`;
const releaseRoot = resolve(repositoryRoot, "out/release");
const destination = resolve(releaseRoot, asset);
const input = resolve(backendRoot, "target/jpackage-input");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error?.code === "ENOENT") throw new Error(`${command} не найден. Требуется JDK 21+ с jpackage.`);
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(npm, ["run", "build:web"], frontendRoot);
run(maven, ["-q", "-DskipTests", "package"], backendRoot);
await rm(input, { recursive: true, force: true });
await rm(destination, { recursive: true, force: true });
await mkdir(input, { recursive: true });
await mkdir(destination, { recursive: true });
await copyFile(resolve(backendRoot, "target/openspec-studio-backend-0.1.0-SNAPSHOT.jar"), resolve(input, "openspec-studio.jar"));
run(jpackage, ["--type", "app-image", "--name", "openspec-studio", "--app-version", "1.0.0",
  "--input", input, "--main-jar", "openspec-studio.jar", "--dest", destination,
  "--java-options", "-Dfile.encoding=UTF-8"], repositoryRoot);
console.log(`Self-contained application image: ${destination}`);

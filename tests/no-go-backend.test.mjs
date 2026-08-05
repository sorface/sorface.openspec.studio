import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]))).flat();
}

test("backend не содержит Go sources или module manifests", async () => {
  const backendFiles = await files(path.join(root, "openspec.backend"));
  const forbidden = backendFiles.filter((file) => file.endsWith(".go") || /[/\\]go\.(mod|sum)$/.test(file));
  assert.deepEqual(forbidden, []);
});

test("активные build, start и release команды используют только Kotlin JVM", async () => {
  const targets = ["openspec.frontend/package.json", "tooling/scripts/build.mjs", "tooling/scripts/build-backend.mjs", "tooling/scripts/dev-backend.mjs", "tooling/scripts/start.mjs", "tooling/scripts/release.mjs", ".github/workflows/release.yml"];
  for (const target of targets) {
    const source = await readFile(path.join(root, target), "utf8");
    assert.doesNotMatch(source, /setup-go|go-version-file|go\.mod|go\.sum|\bgo\s+-C\b|\bgo\s+build\b|GOOS|GOARCH/i, target);
  }
});

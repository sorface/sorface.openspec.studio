import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendRoot = path.join(root, "openspec.backend");
const frontendRoot = path.join(root, "openspec.frontend");
const fixture = JSON.parse(await readFile(path.join(root, "tests/fixtures/backend-contract.json"), "utf8"));
const sorted = (values) => [...values].sort((a, b) => String(a).localeCompare(String(b)));

async function walk(directory, suffix) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target, suffix) : target.endsWith(suffix) ? [target] : [];
  }))).flat();
}

test("Kotlin controllers сохраняют полный legacy HTTP contract", async () => {
  const files = await walk(path.join(backendRoot, "src/main/kotlin/com/sorface/openspecstudio/api"), ".kt");
  const routes = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const base = source.match(/@RequestMapping\("([^"]+)"\)/)?.[1];
    if (!base) continue;
    for (const match of source.matchAll(/@(Get|Post|Put|Patch|Delete)Mapping(?:\("([^"]*)"[^)]*\))?/g)) {
      routes.push(`${match[1].toUpperCase()} ${base}${match[2] ?? ""}`);
    }
  }
  assert.deepEqual(sorted(routes), sorted(fixture.routes));
  assert.equal(new Set(routes).size, routes.length, "API не должен содержать дублирующиеся method/path");
});

test("legacy JSON DTO inventory сохранён как migration fixture, Kotlin DTO объявлены явно", async () => {
  assert.ok(fixture.jsonDtos.length > 50);
  const files = await walk(path.join(backendRoot, "src/main/kotlin/com/sorface/openspecstudio/domain"), ".kt");
  const source = (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
  for (const required of ["Project", "CloneOperation", "ContextManifest", "OpenSpecOverview", "PublicationPreview"]) {
    assert.match(source, new RegExp(`data class ${required}\\b`));
  }
});

test("Liquibase сохраняет SQLite tables, indexes и migration versions", async () => {
  const source = await readFile(path.join(backendRoot, "src/main/resources/db/changelog/db.changelog-master.yaml"), "utf8");
  const tables = [...source.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)].map((match) => match[1]);
  const indexes = [...source.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-z_]+)/g)].map((match) => match[1]);
  const versions = [...source.matchAll(/VALUES \((\d+), strftime/g)].map((match) => Number(match[1]));
  assert.deepEqual(sorted(tables), sorted(fixture.sqlite.tables));
  assert.deepEqual(sorted(indexes), sorted(fixture.sqlite.indexes));
  assert.deepEqual(sorted(new Set(versions)), sorted(fixture.sqlite.schemaVersions));
});

test("inventory включает все frontend API clients", async () => {
  const files = await walk(path.join(frontendRoot, "src/features"), ".ts");
  const clients = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    if (source.includes("/api/v1") || source.includes("apiRequest")) clients.push(path.relative(frontendRoot, file));
  }
  assert.deepEqual(sorted(clients), sorted(fixture.frontendApiClients));
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("release workflow проверяет Kotlin coverage и собирает self-contained matrix", async () => {
  const workflow = await readFile(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
  const release = await readFile(new URL("../tooling/scripts/release.mjs", import.meta.url), "utf8");
  assert.match(workflow, /tags: \["v\*"\]/);
  assert.match(workflow, /actions\/setup-java@v5/);
  assert.match(workflow, /npm --prefix openspec\.frontend run check/);
  assert.match(workflow, /needs: verify/);
  assert.match(workflow, /Smoke-test application image/);
  assert.doesNotMatch(workflow, /setup-go|go-version-file|go\.mod/);
  for (const asset of ["openspec-studio-darwin-amd64", "openspec-studio-darwin-arm64", "openspec-studio-linux-amd64", "openspec-studio-linux-arm64", "openspec-studio-windows-amd64"]) assert.match(workflow, new RegExp(asset));
  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /--clobber/);
  assert.match(release, /jpackage/);
  assert.match(release, /--type", "app-image/);
  assert.match(release, /openspec-studio\.jar/);
  assert.doesNotMatch(release, /goCommand|GOOS|GOARCH/);
});

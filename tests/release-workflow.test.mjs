import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/release.yml", import.meta.url);

test("release workflow проверяет, собирает и публикует все поддерживаемые платформы", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /tags:\s*\n\s+- "v\*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /permissions:\s*\n\s+contents: write/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /actions\/setup-go@v6/);
  assert.match(workflow, /npm ci/);
  assert.match(workflow, /npm run check/);
  assert.match(workflow, /npm run release/);
  assert.match(workflow, /refs\/tags\/\$\{release_tag\}/);

  for (const asset of [
    "openspec-studio-darwin-amd64",
    "openspec-studio-darwin-arm64",
    "openspec-studio-linux-amd64",
    "openspec-studio-linux-arm64",
    "openspec-studio-windows-amd64",
  ]) {
    assert.match(workflow, new RegExp(asset));
  }

  assert.match(workflow, /sha256sum/);
  assert.match(workflow, /gh release create/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /--clobber/);
});

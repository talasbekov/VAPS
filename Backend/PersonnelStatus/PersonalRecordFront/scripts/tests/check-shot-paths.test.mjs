import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { test } from "node:test";
import { inspectShotPaths } from "../check-shot-paths.mjs";

function fixture(t, files) {
  const prefix = join(resolve(tmpdir()), "josparlau-shot-check-");
  const root = mkdtempSync(prefix);
  t.after(() => {
    const target = resolve(root);
    if (!target.startsWith(prefix) || target.slice(prefix.length).includes(sep)) {
      throw new Error("Fixture cleanup path is outside the temporary test directory.");
    }
    rmSync(target, { recursive: true });
  });
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split("/");
    mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
    writeFileSync(join(root, ...parts), content);
  }
  return root;
}

test("offline tests are checked when e2e is absent", (t) => {
  const root = fixture(t, { "tests/check.spec.ts": 'await page.screenshot({ path: "test-results/check.png" });' });
  const result = inspectShotPaths(root);
  assert.equal(result.files.length, 1);
  assert.deepEqual(result.offenders, []);
});

test("unsafe screenshots are found in both test directories", (t) => {
  const root = fixture(t, {
    "tests/check.spec.ts": 'await page.screenshot({ path: "root.png" });',
    "e2e/check.spec.ts": 'await page.screenshot({ path: "../outside.png" });',
  });
  assert.equal(inspectShotPaths(root).offenders.length, 2);
});

test("ordinary path properties are not mistaken for screenshots", (t) => {
  const root = fixture(t, { "tests/check.spec.ts": 'const route = { path: "/dashboard/" };' });
  assert.deepEqual(inspectShotPaths(root).offenders, []);
});

test("an empty export cannot report a successful screenshot check", (t) => {
  const root = fixture(t, {});
  assert.throws(() => inspectShotPaths(root), /Нет файлов проверок/);
});

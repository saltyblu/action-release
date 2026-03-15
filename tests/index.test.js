const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const actionYmlPath = path.resolve(__dirname, "..", "action.yml");

function readActionYml() {
  return fs.readFileSync(actionYmlPath, "utf8");
}

test("action.yml uses composite runtime", () => {
  const yaml = readActionYml();
  assert.match(yaml, /runs:\n\s+using: composite/);
});

test("action.yml wires version-next action", () => {
  const yaml = readActionYml();
  assert.match(yaml, /id: version-next/);
  assert.match(yaml, /uses: saltyblu\/action-release-version-next@main/);
});

test("action.yml wires changelog and version-bump actions", () => {
  const yaml = readActionYml();
  assert.match(yaml, /id: changelog/);
  assert.match(yaml, /uses: saltyblu\/action-release-changelog@main/);
  assert.match(yaml, /id: version-bump/);
  assert.match(yaml, /uses: saltyblu\/action-release-version-bump@main/);
});

test("action.yml wires release-create action", () => {
  const yaml = readActionYml();
  assert.match(yaml, /id: release-create/);
  assert.match(yaml, /uses: saltyblu\/action-release-create@main/);
});

test("action.yml contains auto-commit controls", () => {
  const yaml = readActionYml();
  assert.match(yaml, /auto-commit:/);
  assert.match(yaml, /commit-message:/);
  assert.match(yaml, /commit-skip-ci:/);
});

test("auto-commit step is conditional for tag and dry-run", () => {
  const yaml = readActionYml();
  assert.match(yaml, /id: auto-commit/);
  assert.match(yaml, /inputs\.run-tag == 'true'/);
  assert.match(yaml, /inputs\.auto-commit == 'true'/);
  assert.match(yaml, /inputs\.dry-run != 'true'/);
});

test("auto-commit appends skip ci when enabled", () => {
  const yaml = readActionYml();
  assert.match(yaml, /\[skip ci\]/);
  assert.match(yaml, /if \[ "\$INPUT_COMMIT_SKIP_CI" = "true" \]/);
});

test("outputs are mapped from resolve and release-create steps", () => {
  const yaml = readActionYml();
  assert.match(yaml, /next-version:\n\s+description:[\s\S]*?value: \$\{\{ steps\.resolve-version\.outputs\.next-version \}\}/);
  assert.match(yaml, /tag:\n\s+description:[\s\S]*?value: \$\{\{ steps\.release-create\.outputs\.tag \}\}/);
});

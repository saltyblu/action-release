const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseVersion,
  stringifyVersion,
  determineRange,
  detectCommitBump,
  computeNextVersion,
  normalizeMarkdownBody,
  replaceMarkedLine,
  getBooleanInput,
} = require("../index.js");

test("parseVersion parses semver", () => {
  assert.deepEqual(parseVersion("1.2.3"), { major: 1, minor: 2, patch: 3 });
  assert.equal(parseVersion("v1.2.3"), null);
});

test("stringifyVersion formats semver", () => {
  assert.equal(stringifyVersion({ major: 3, minor: 1, patch: 4 }), "3.1.4");
});

test("determineRange prefers pull_request payload", () => {
  const payload = {
    pull_request: {
      base: { sha: "aaa" },
      head: { sha: "bbb" },
    },
  };

  assert.deepEqual(determineRange("pull_request", payload, null), {
    range: "aaa..bbb",
    mode: "pull_request",
  });
});

test("detectCommitBump covers conventional commits", () => {
  assert.equal(detectCommitBump({ subject: "feat: add", body: "" }), "minor");
  assert.equal(detectCommitBump({ subject: "fix: bug", body: "" }), "patch");
  assert.equal(detectCommitBump({ subject: "feat!: break", body: "" }), "major");
});

test("computeNextVersion increments correctly", () => {
  assert.deepEqual(computeNextVersion({ major: 1, minor: 2, patch: 3 }, "patch"), { major: 1, minor: 2, patch: 4 });
  assert.deepEqual(computeNextVersion({ major: 1, minor: 2, patch: 3 }, "minor"), { major: 1, minor: 3, patch: 0 });
  assert.deepEqual(computeNextVersion({ major: 1, minor: 2, patch: 3 }, "major"), { major: 2, minor: 0, patch: 0 });
});

test("normalizeMarkdownBody strips unreleased heading", () => {
  const text = "## Unreleased\n\n- feat: entry\n";
  assert.equal(normalizeMarkdownBody(text), "- feat: entry");
});

test("replaceMarkedLine swaps the marked version", () => {
  const line = "image: app:v0.1.0 # update-automation:version";
  assert.equal(
    replaceMarkedLine(line, "update-automation:version", "v0.2.0"),
    "image: app:v0.2.0 # update-automation:version"
  );
});

test("getBooleanInput interprets true/false text", () => {
  const previous = process.env.INPUT_RUN_TAG;
  process.env.INPUT_RUN_TAG = "true";
  assert.equal(getBooleanInput("run-tag", false), true);
  process.env.INPUT_RUN_TAG = "false";
  assert.equal(getBooleanInput("run-tag", true), false);

  if (typeof previous === "undefined") {
    delete process.env.INPUT_RUN_TAG;
  } else {
    process.env.INPUT_RUN_TAG = previous;
  }
});

#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_HEADER = [
  "# Changelog",
  "",
  "All notable changes to this project will be documented in this file.",
  "",
  "The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),",
  "and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).",
  "",
].join("\n");

const DEFAULT_UNRELEASED = [
  "## Unreleased",
  "",
  "- _No unreleased changes yet._",
  "",
].join("\n");

function getInput(name, fallback = "") {
  const githubActionsKey = `INPUT_${name.toUpperCase().replace(/ /g, "_")}`;
  const legacyKey = `INPUT_${name.toUpperCase().replace(/[- ]/g, "_")}`;
  const value = process.env[githubActionsKey] ?? process.env[legacyKey] ?? fallback;
  return value.trim();
}

function getBooleanInput(name, fallback = false) {
  const value = getInput(name, fallback ? "true" : "false").toLowerCase();
  return value === "true";
}

function setOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) {
    throw new Error("GITHUB_OUTPUT is not set");
  }
  fs.appendFileSync(outputFile, `${name}=${value}\n`, "utf8");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    throw new Error(`${command} ${args.join(" ")} failed${stderr ? `: ${stderr}` : ""}`);
  }

  return (result.stdout || "").trim();
}

function git(args, options = {}) {
  return run("git", args, options);
}

function parseVersion(versionText) {
  const match = versionText.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function stringifyVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function compareVersions(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findLatestTag(cwd, tagPrefix) {
  const allTags = git(["tag", "--list"], { cwd })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const rx = new RegExp(`^${escapeRegex(tagPrefix)}(\\d+\\.\\d+\\.\\d+)$`);

  const parsed = allTags
    .map((tag) => {
      const match = tag.match(rx);
      if (!match) return null;
      const parsedVersion = parseVersion(match[1]);
      if (!parsedVersion) return null;
      return { tag, version: parsedVersion };
    })
    .filter(Boolean);

  if (parsed.length === 0) {
    return null;
  }

  parsed.sort((left, right) => compareVersions(right.version, left.version));
  return parsed[0];
}

function parseEventPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(eventPath, "utf8"));
  } catch {
    return null;
  }
}

function determineRange(eventName, payload, latestTag) {
  if (eventName === "pull_request" && payload?.pull_request?.base?.sha && payload?.pull_request?.head?.sha) {
    return {
      range: `${payload.pull_request.base.sha}..${payload.pull_request.head.sha}`,
      mode: "pull_request",
    };
  }

  if (eventName === "push" && payload?.before && payload?.after && payload.before !== "0000000000000000000000000000000000000000") {
    return {
      range: `${payload.before}..${payload.after}`,
      mode: "push",
    };
  }

  if (latestTag?.tag) {
    return {
      range: `${latestTag.tag}..HEAD`,
      mode: "since_latest_tag",
    };
  }

  return {
    range: "HEAD",
    mode: "head_only",
  };
}

function getCommitPathFilter(cwd) {
  const repoRoot = git(["rev-parse", "--show-toplevel"], { cwd });
  const relativePath = path.relative(repoRoot, cwd);
  if (!relativePath || relativePath === ".") {
    return null;
  }
  return relativePath.split(path.sep).join("/");
}

function collectCommits(cwd, range, commitPathFilter) {
  const separatorCommit = "\u001e";
  const separatorField = "\u001f";

  const args = ["log", "--format=%H%x1f%s%x1f%b%x1e", "--no-merges", range];
  if (commitPathFilter) {
    args.push("--", commitPathFilter);
  }

  const raw = git(args, { cwd });
  if (!raw) {
    return [];
  }

  return raw
    .split(separatorCommit)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha = "", subject = "", body = ""] = entry.split(separatorField);
      return { sha, subject: subject.trim(), body: body.trim() };
    });
}

function bumpPriority(bump) {
  if (bump === "major") return 3;
  if (bump === "minor") return 2;
  return 1;
}

function detectCommitBump(commit) {
  const subject = commit.subject;
  const body = commit.body || "";

  const conventional = subject.match(/^([a-z]+)(\([^)]+\))?(!)?:\s.+$/i);
  const isBreaking = Boolean(conventional?.[3]) || /BREAKING CHANGE:/i.test(body);

  if (isBreaking) {
    return "major";
  }

  if (conventional) {
    return conventional[1].toLowerCase() === "feat" ? "minor" : "patch";
  }

  return "patch";
}

function computeNextVersion(base, bump) {
  const next = { ...base };
  if (bump === "major") {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
    return next;
  }
  if (bump === "minor") {
    next.minor += 1;
    next.patch = 0;
    return next;
  }
  next.patch += 1;
  return next;
}

function normalizeMarkdownBody(content) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && /^#{1,6}\s*unreleased\s*$/i.test(lines[0].trim())) {
    lines.shift();
    while (lines.length > 0 && lines[0].trim() === "") {
      lines.shift();
    }
  }
  return lines.join("\n").trim();
}

function replaceMarkedLine(line, marker, replacementValue) {
  const markerIndex = line.indexOf(marker);
  if (markerIndex < 0) {
    return line;
  }

  const beforeMarker = line.slice(0, markerIndex);
  const afterMarker = line.slice(markerIndex);
  const tokenPattern = /v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/g;
  const matches = [...beforeMarker.matchAll(tokenPattern)];
  if (matches.length === 0) {
    return line;
  }

  const last = matches[matches.length - 1];
  const start = last.index;
  const end = start + last[0].length;
  const updatedBefore = `${beforeMarker.slice(0, start)}${replacementValue}${beforeMarker.slice(end)}`;
  return `${updatedBefore}${afterMarker}`;
}

function updateFileIfChanged(filePath, content, dryRun, updatedFiles, cwd) {
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  if (existing === content) {
    return;
  }
  if (!dryRun) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
  updatedFiles.push(path.relative(cwd, filePath).split(path.sep).join("/"));
}

function runChangelogPhase({ cwd, version, tagPrefix, changelogDirInput, unreleasedFileInput, dryRun, updatedFiles }) {
  const changelogDir = path.resolve(cwd, changelogDirInput);
  const headerPath = path.join(changelogDir, "_header.md");
  const versionTag = `${tagPrefix}${version}`;
  const versionPath = path.join(changelogDir, `${versionTag}.md`);
  const unreleasedPath = path.resolve(cwd, unreleasedFileInput);
  const changelogPath = path.resolve(cwd, "CHANGELOG.md");

  if (!dryRun) {
    fs.mkdirSync(changelogDir, { recursive: true });
  }

  const header = fs.existsSync(headerPath) ? fs.readFileSync(headerPath, "utf8") : DEFAULT_HEADER;
  updateFileIfChanged(headerPath, `${header.trim()}\n`, dryRun, updatedFiles, cwd);

  const unreleasedRaw = fs.existsSync(unreleasedPath) ? fs.readFileSync(unreleasedPath, "utf8") : DEFAULT_UNRELEASED;
  const body = normalizeMarkdownBody(unreleasedRaw);
  const hasChanges = body && body.toLowerCase() !== "- _no unreleased changes yet._";

  if (hasChanges) {
    const date = new Date().toISOString().slice(0, 10);
    const versionContent = `## ${versionTag} - ${date}\n\n${body}\n`;
    updateFileIfChanged(versionPath, versionContent, dryRun, updatedFiles, cwd);
  }

  updateFileIfChanged(unreleasedPath, DEFAULT_UNRELEASED, dryRun, updatedFiles, cwd);

  const fragments = fs.existsSync(changelogDir)
    ? fs.readdirSync(changelogDir)
      .filter((name) => name.endsWith(".md") && name !== "_header.md")
      .sort()
      .reverse()
      .map((name) => fs.readFileSync(path.join(changelogDir, name), "utf8").trim())
      .filter(Boolean)
    : [];

  const aggregate = `${header.trim()}\n\n${fragments.join("\n\n")}\n`;
  updateFileIfChanged(changelogPath, aggregate, dryRun, updatedFiles, cwd);

  return {
    changelogPath: path.relative(cwd, versionPath).split(path.sep).join("/"),
    releaseBody: hasChanges ? body : "",
  };
}

function runBumpPhase({ cwd, marker, replacementValue, dryRun, updatedFiles }) {
  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") {
          continue;
        }
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const original = fs.readFileSync(absolutePath, "utf8");
      if (!original.includes(marker)) {
        continue;
      }
      const hasCrlf = original.includes("\r\n");
      const eol = hasCrlf ? "\r\n" : "\n";
      let changed = false;
      const lines = original.replace(/\r\n/g, "\n").split("\n").map((line) => {
        const updated = replaceMarkedLine(line, marker, replacementValue);
        if (updated !== line) {
          changed = true;
        }
        return updated;
      });
      if (!changed) {
        continue;
      }
      const content = lines.join(eol);
      if (!dryRun) {
        fs.writeFileSync(absolutePath, content, "utf8");
      }
      updatedFiles.push(path.relative(cwd, absolutePath).split(path.sep).join("/"));
    }
  }

  walk(cwd);
}

function resolveRepository(inputValue) {
  const value = inputValue || process.env.GITHUB_REPOSITORY || "";
  if (!/^[^/]+\/[^/]+$/.test(value)) {
    throw new Error("Repository must be in owner/name format or available in GITHUB_REPOSITORY");
  }
  return value;
}

async function createGitHubRelease(repository, token, tag, targetBranch, body) {
  if (!token) {
    throw new Error("A github-token (or release-token) is required to create a GitHub release");
  }

  const response = await fetch(`https://api.github.com/repos/${repository}/releases`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "action-release",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: targetBranch,
      name: tag,
      body,
      draft: false,
      prerelease: false,
      generate_release_notes: false,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub release creation failed (${response.status}): ${details}`);
  }

  const data = await response.json();
  return {
    id: String(data.id),
    htmlUrl: data.html_url || "",
  };
}

function gitHasChanges(cwd) {
  return git(["status", "--porcelain"], { cwd }).trim().length > 0;
}

async function main() {
  const providedVersion = getInput("version", "");
  const tagPrefix = getInput("tag-prefix", "v");
  const workingDirectoryInput = getInput("working-directory", ".");
  const dryRun = getBooleanInput("dry-run", false);

  const runNextVersion = getBooleanInput("run-next-version", true);
  const runChangelog = getBooleanInput("run-changelog", true);
  const runBumpVersion = getBooleanInput("run-bump-version", true);
  const runTag = getBooleanInput("run-tag", true);

  const marker = getInput("marker", "update-automation:version");
  const repositoryInput = getInput("repository", "");
  const targetBranch = getInput("target-branch", "main");
  const githubToken = getInput("github-token", "");
  const releaseToken = getInput("release-token", "") || githubToken;
  const releaseBodyOverride = getInput("release-body", "");
  const changelogDirInput = getInput("changelog-dir", ".changelog");
  const unreleasedFileInput = getInput("unreleased-file", "unreleased.md");

  const cwd = path.resolve(process.cwd(), workingDirectoryInput);
  const updatedFiles = [];

  let nextVersion = providedVersion;
  let bumpType = "patch";
  let commitCount = "0";

  if (runNextVersion) {
    const eventName = process.env.GITHUB_EVENT_NAME || "";
    const payload = parseEventPayload();
    const latestTag = findLatestTag(cwd, tagPrefix);
    const baseVersion = latestTag?.version || { major: 0, minor: 0, patch: 0 };
    const { range } = determineRange(eventName, payload, latestTag);
    const commitPathFilter = getCommitPathFilter(cwd);
    const commits = collectCommits(cwd, range, commitPathFilter);

    for (const commit of commits) {
      const candidate = detectCommitBump(commit);
      if (bumpPriority(candidate) > bumpPriority(bumpType)) {
        bumpType = candidate;
      }
    }

    const nextVersionObj = computeNextVersion(baseVersion, bumpType);
    nextVersion = stringifyVersion(nextVersionObj);
    commitCount = String(commits.length);
  }

  if (!nextVersion || !parseVersion(nextVersion)) {
    throw new Error("A valid version is required. Set input version or enable run-next-version.");
  }

  const nextTag = `${tagPrefix}${nextVersion}`;
  let changelogPath = "";
  let releaseBody = releaseBodyOverride;

  if (runChangelog) {
    const changelogResult = runChangelogPhase({
      cwd,
      version: nextVersion,
      tagPrefix,
      changelogDirInput,
      unreleasedFileInput,
      dryRun,
      updatedFiles,
    });
    changelogPath = changelogResult.changelogPath;
    if (!releaseBody && changelogResult.releaseBody) {
      releaseBody = changelogResult.releaseBody;
    }
  }

  if (runBumpVersion) {
    runBumpPhase({
      cwd,
      marker,
      replacementValue: nextTag,
      dryRun,
      updatedFiles,
    });
  }

  let tagOutput = nextTag;
  let targetSha = "";
  let releaseId = "0";
  let releaseUrl = "";

  if (runTag) {
    const repository = resolveRepository(repositoryInput);

    if (dryRun) {
      targetSha = "0000000000000000000000000000000000000000";
      releaseUrl = `https://github.com/${repository}/releases/tag/${nextTag}`;
    } else {
      if (!githubToken) {
        throw new Error("github-token is required when run-tag=true and dry-run=false");
      }

      const env = { ...process.env };
      git(["remote", "set-url", "origin", `https://x-access-token:${githubToken}@github.com/${repository}.git`], { cwd, env });

      if (gitHasChanges(cwd)) {
        git(["config", "user.name", "github-actions[bot]"], { cwd, env });
        git(["config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], { cwd, env });
        git(["add", "-A"], { cwd, env });
        git(["commit", "-m", `chore(release): prepare ${nextTag}`], { cwd, env });
        git(["push", "origin", `HEAD:refs/heads/${targetBranch}`], { cwd, env });
      }

      targetSha = git(["rev-parse", "HEAD"], { cwd, env });
      const existing = git(["ls-remote", "--tags", "origin", `refs/tags/${nextTag}`], { cwd, env });
      if (existing.trim()) {
        throw new Error(`Tag already exists on remote: ${nextTag}`);
      }

      git(["tag", nextTag, targetSha], { cwd, env });
      git(["push", "origin", `refs/tags/${nextTag}`], { cwd, env });

      const release = await createGitHubRelease(repository, releaseToken, nextTag, targetBranch, releaseBody);
      releaseId = release.id;
      releaseUrl = release.htmlUrl;
    }
  }

  const uniqueUpdated = [...new Set(updatedFiles)];

  setOutput("next-version", nextVersion);
  setOutput("next-tag", nextTag);
  setOutput("bump-type", bumpType);
  setOutput("commit-count", commitCount);
  setOutput("changelog-path", changelogPath);
  setOutput("updated-files", JSON.stringify(uniqueUpdated));
  setOutput("tag", tagOutput);
  setOutput("target-sha", targetSha);
  setOutput("release-id", releaseId);
  setOutput("release-url", releaseUrl);

  console.log(`next-version=${nextVersion}`);
  console.log(`next-tag=${nextTag}`);
  console.log(`updated-files=${JSON.stringify(uniqueUpdated)}`);
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}

module.exports = {
  parseVersion,
  stringifyVersion,
  determineRange,
  detectCommitBump,
  computeNextVersion,
  normalizeMarkdownBody,
  replaceMarkedLine,
  getBooleanInput,
};

# action-release

Composite GitHub Action that orchestrates release management phases in one place:

1. calculate next semantic version from conventional commits
2. move unreleased notes into `.changelog/<tag>.md` and rebuild `CHANGELOG.md`
3. update version strings on marker lines (`update-automation:version`)
4. optionally commit and push release changes
5. create tag and GitHub release

## Inputs

Core inputs (shared naming style):

- `version` (optional)
- `tag-prefix` (default: `v`)
- `working-directory` (default: `.`)
- `dry-run` (default: `false`)

Feature flags:

- `run-next-version` (default: `true`)
- `run-changelog` (default: `true`)
- `run-bump-version` (default: `true`)
- `run-tag` (default: `true`)

Auto-commit inputs:

- `auto-commit` (default: `true`)
- `commit-message` (default: `chore(release): prepare`)
- `commit-skip-ci` (default: `true`)
- `commit-user-name` (default: `github-actions[bot]`)
- `commit-user-email` (default: `41898282+github-actions[bot]@users.noreply.github.com`)

Tag/release inputs:

- `repository` (default: `GITHUB_REPOSITORY`)
- `target-branch` (default: `main`)
- `github-token`
- `release-token` (falls back to `github-token`)
- `release-body` (optional override)
- `update-major-tag` (default: `false`, updates major tag like `v1` together with full tag)

Changelog and bump inputs:

- `changelog-dir` (default: `.changelog`)
- `unreleased-file` (default: `unreleased.md`)
- `marker` (default: `update-automation:version`)

## Outputs

- `next-version`, `next-tag`, `bump-type`, `commit-count`
- `changelog-path`, `updated-files`
- `tag`, `target-sha`, `release-id`, `release-url`

## Auto-commit behavior

- The action can commit generated files before tag/release creation.
- Commit happens only when all conditions are true:
  - `run-tag: true`
  - `auto-commit: true`
  - `dry-run: false`
- If `commit-skip-ci: true`, the commit message gets ` [skip ci]` appended.

## Example

```yaml
- name: Release
  id: release
  uses: saltyblu/action-release@v1
  with:
    tag-prefix: v
    working-directory: app
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Unit tests

```bash
node --test
```

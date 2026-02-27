# GitHub Actions Workflows

[< Back to main README](../../README.md)

13 workflows organized into CI, release, PR automation, and manual operations.

## CI pipeline

`ci.yml` orchestrates the full pipeline on push to `main` and PRs. It detects file changes with `dorny/paths-filter` and calls reusable workflows:

| Workflow        | Role                                           |
| --------------- | ---------------------------------------------- |
| `lint.yml`      | Prettier format check + ESLint                 |
| `typecheck.yml` | TypeScript compiler in check mode              |
| `build.yml`     | Wrangler dry-run build, lists `dist/` output   |
| `e2e.yml`       | Playwright E2E against site B (with preflight) |

E2E tests only run when `src/`, `schemas/`, `tests/`, config files, or `playwright.config.ts` change.

## Release automation

`release.yml` runs on push to `main`. Uses git-cliff to calculate the next semver from conventional commits, bumps `package.json`, syncs README badges, creates a GitHub Release with changelog, and commits with `[skip ci]` to prevent loops. Uses a GitHub App token so the version bump commit can trigger downstream workflows.

## PR automation

| Workflow                    | Trigger                 | What it does                                                 |
| --------------------------- | ----------------------- | ------------------------------------------------------------ |
| `labeler.yml`               | PR open/sync            | Labels by file paths + PR size (`size/xs` through `size/xl`) |
| `dependabot-auto-merge.yml` | PR open/sync            | Enables squash auto-merge on Dependabot PRs                  |
| `close-stale-prs.yml`       | Daily schedule + manual | Warns after 45 days inactive, closes after 60 days           |

## AI coding agent

`opencode.yml` responds to `/oc` or `/opencode` commands in issue/PR comments. Runs the OpenCode agent via Cloudflare AI Gateway (Claude Sonnet 4.5).

## Manual operations

| Workflow            | What it does                                        |
| ------------------- | --------------------------------------------------- |
| `e2e-a-manual.yml`  | Playwright E2E against site A                       |
| `seed-a-manual.yml` | Seed demo namespace on site A from a JSON seed file |
| `seed-b-manual.yml` | Seed demo namespace on site B from a JSON seed file |

## Environments

Two deployed environments (A and B), each with its own Cloudflare Access service token secrets:

- `CF_ACCESS_CLIENT_ID_A` / `CF_ACCESS_CLIENT_SECRET_A` / `API_BASE_URL_A`
- `CF_ACCESS_CLIENT_ID_B` / `CF_ACCESS_CLIENT_SECRET_B` / `API_BASE_URL_B`

CI runs E2E against site B automatically. Site A has manual-only workflows.

# GitHub Actions Workflows

[README](../../README.md) > CI/CD Workflows

21 workflows organized into CI, release, PR automation, operational, and manual operations.

## CI pipeline

`ci.yml` orchestrates the full pipeline on push to `main` and PRs. It detects file changes with `dorny/paths-filter` and calls reusable workflows:

| Workflow        | Role                                           |
| --------------- | ---------------------------------------------- |
| `lint.yml`      | Prettier format check + ESLint                 |
| `typecheck.yml` | TypeScript compiler in check mode              |
| `unit-test.yml` | Vitest unit tests with JUnit reporting         |
| `build.yml`     | Wrangler dry-run build, lists `dist/` output   |
| `e2e.yml`       | Playwright E2E against site B (with preflight) |

E2E tests only run when `src/`, `schemas/`, `tests/`, config files, or `playwright.config.ts` change.

## Release automation

`release.yml` runs on push to `main`. Uses git-cliff to calculate the next semver from conventional commits, bumps `package.json`, syncs README badges, creates a GitHub Release with changelog, and commits with `[skip ci]` to prevent loops. Uses a GitHub App token so the version bump commit can trigger downstream workflows.

## PR automation

| Workflow                    | Trigger                 | What it does                                                                      |
| --------------------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `pr-standards.yml`          | PR open/edit/sync       | Enforces conventional commit titles, linked issues, and contributor labeling      |
| `labeler.yml`               | PR open/sync            | Labels by file paths + PR size (`size/xs` through `size/xl`)                      |
| `dependabot-auto-merge.yml` | PR open/sync            | Enables squash auto-merge on Dependabot PRs                                       |
| `link-check.yml`            | PR + push               | Checks internal markdown links, breadcrumbs, and orphans (config in `.docs.toml`) |
| `close-stale-prs.yml`       | Daily schedule + manual | Warns after 45 days inactive, closes after 60 days                                |

## AI coding agent

`opencode.yml` responds to `/oc` or `/opencode` commands in issue/PR comments. Runs the OpenCode agent via Cloudflare AI Gateway (Claude Sonnet 4.5).

## Operational

| Workflow                | Trigger              | What it does                                           |
| ----------------------- | -------------------- | ------------------------------------------------------ |
| `health-check.yml`      | Every 30 min         | Curls both sites, opens/closes GitHub issue on failure |
| `nightly-smoke.yml`     | Daily 06:00 UTC      | Runs API E2E suite against site B                      |
| `stale.yml`             | Weekly Monday 09:00  | Marks/closes inactive issues (60d) and PRs (30d)       |
| `dependency-review.yml` | PR (package changes) | Flags high-severity vulns and GPL/AGPL deps            |

## Manual operations

| Workflow               | What it does                                               |
| ---------------------- | ---------------------------------------------------------- |
| `e2e-a-manual.yml`     | Playwright E2E against site A                              |
| `e2e-pages-manual.yml` | Playwright browser tests (landing page, bind UI) on site B |
| `seed-a-manual.yml`    | Seed demo namespace on site A from a JSON seed file        |
| `seed-b-manual.yml`    | Seed demo namespace on site B from a JSON seed file        |

## Environments

Two deployed environments (A and B), each with its own Cloudflare Access service token secrets:

- `CF_ACCESS_CLIENT_ID_A` / `CF_ACCESS_CLIENT_SECRET_A` / `API_BASE_URL_A`
- `CF_ACCESS_CLIENT_ID_B` / `CF_ACCESS_CLIENT_SECRET_B` / `API_BASE_URL_B`

CI runs E2E against site B automatically. Site A has manual-only workflows.

## Self-hosted runner

All CI, build, test, and E2E workflows run on a self-hosted runner. Lightweight workflows (labeler, pr-standards, dependency-review, stale, health-check, release, opencode, dependabot-auto-merge, close-stale-prs, ci orchestrator) stay on `ubuntu-latest`.

| Detail      | Value                                                                  |
| ----------- | ---------------------------------------------------------------------- |
| Host        | `10.1.1.41` (Proxmox LXC, Debian 13 trixie, 8 CPU / 16GB RAM)          |
| Runner user | `runner` (non-root, docker + sudo groups)                              |
| Service     | `actions.runner.FlarelyLegal.runner-01.service` (systemd, auto-start)  |
| Node.js     | 24/22/20 via fnm, npm 11, corepack 0.34                                |
| Build tools | wrangler, TypeScript, ESLint, Prettier                                 |
| Test tools  | Playwright (Chromium + Firefox + WebKit pre-installed), Google Chrome  |
| Linters     | yamllint, shellcheck, jsonlint, markdownlint-cli, actionlint, hadolint |
| Other       | Docker, git, gh                                                        |

**Why no `actions/setup-node`:** Node and all tools are pre-installed. Skipping setup-node saves ~30s per job.

**Why no `npx playwright install`:** Browsers are pre-installed at `/home/runner/.cache/ms-playwright`. No download needed.

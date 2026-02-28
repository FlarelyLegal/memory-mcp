---
name: Duplicate Code Detector
description: Identifies duplicate code patterns in TypeScript source and suggests refactoring

on:
  workflow_dispatch:
  schedule: weekly

permissions:
  contents: read
  issues: read
  pull-requests: read

tools:
  github:
    toolsets: [issues, code_search]

safe-outputs:
  create-issue:
    expires: 7d
    title-prefix: "[duplicate-code] "
    labels: [code-quality, enhancement]
    assignees: copilot
    group: true
    max: 3

timeout-minutes: 10
---

# Duplicate Code Detection

Analyze TypeScript source files in `src/` to identify duplicated patterns
that hurt maintainability. Report significant findings as issues with
concrete refactoring suggestions.

## Context

- **Repository**: ${{ github.repository }}
- **Language**: TypeScript (`.ts` files in `src/`)
- **File cap**: 250 lines per source file -- duplicates are especially
  wasteful under this constraint.

## Scope

### Analyze

- All `.ts` files under `src/` (excluding barrel `index.ts` re-exports)
- Focus on files changed in the last 30 days first, then widen

### Skip

- Test files (`tests/`, `*.test.ts`, `*.spec.ts`)
- Workflow and config files (`.github/`, `*.json`, `*.toml`, `*.sql`)
- Standard boilerplate (imports, type re-exports, barrel files)
- Small snippets (<5 lines) unless repeated 4+ times
- Language-specific patterns (constructors, type guards)

## Detection Strategy

1. **Symbol analysis**: Search for functions/methods with similar names
   across different files (e.g., `parseEntity` in multiple modules).
2. **Pattern search**: Look for repeated logic blocks -- similar
   conditionals, error handling, validation, DB query patterns.
3. **Structural comparison**: Compare file overviews for overlapping
   functionality between modules.
4. **Cross-reference**: Check `src/tools/`, `src/api/routes/`, and
   `src/graph/` for parallel implementations of the same logic.

## Duplication types to flag

- **Exact duplication**: identical code blocks in multiple files
- **Structural duplication**: same logic with different variable names
- **Functional duplication**: different implementations of the same task
- **Copy-paste patterns**: similar blocks that should be a shared utility

## Thresholds

Only report when:

- A duplicated block is >10 lines, OR
- A pattern appears in 3+ locations, OR
- Duplication crosses module boundaries (e.g., `tools/` and `api/routes/`
  both implementing the same validation)

## Reporting

Create **one issue per distinct pattern** (max 3 per run). Each issue must
include:

1. **Summary** -- one-sentence description of the pattern
2. **Locations** -- file paths and line ranges for each occurrence
3. **Code samples** -- concrete examples showing the duplication
4. **Impact** -- how this affects maintainability and bug risk
5. **Refactoring suggestion** -- where to extract a shared utility and
   which callers to update
6. **Estimated effort** -- low / medium / high

## Guidelines

- Read-only analysis only -- never modify files
- Verify findings before reporting; false positives waste reviewer time
- Consider whether patterns are intentional (e.g., similar but
  domain-specific validation) before flagging
- Provide specific, actionable refactoring steps -- not vague advice
- Assign issues to @copilot for automated remediation

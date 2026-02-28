#!/usr/bin/env bash
# check-docs.sh -- verify internal markdown links, breadcrumbs, and orphaned docs.
#
# Reads .docs.toml for:
#   - root_files: entry points exempt from breadcrumb checks
#   - exclude_paths: directories to skip
#   - breadcrumbs: expected line-3 breadcrumb for each doc
#
# Checks:
#   1. Breadcrumbs -- line 3 of each doc matches .docs.toml exactly
#   2. Broken links -- relative links in .md files that point to missing targets
#   3. Orphaned docs -- .md files not listed in .docs.toml and not root files
#   4. Config coverage -- .docs.toml entries that point to nonexistent files
#
# Exit code 0 = clean, 1 = problems found.
# Compatible with bash 3.2+ (macOS default).

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

CONFIG=".docs.toml"
if [ ! -f "$CONFIG" ]; then
  echo "ERROR: $CONFIG not found in repo root"
  exit 1
fi

errors=0
breadcrumb_fails=0
orphans=0
stale=0

# --- Parse config with python3 (available on macOS + Linux runners) ---

# Extract root_files, exclude_paths, and breadcrumbs from TOML
eval "$(python3 - "$CONFIG" <<'PYEOF'
import sys, re

config_path = sys.argv[1]
content = open(config_path).read()

# Minimal TOML parser -- handles our flat structure
section = None
breadcrumbs = {}
root_files = []
exclude_paths = []

for line in content.splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue

    # Section headers
    m = re.match(r'^\[(\w+(?:\.\w+)*)\]$', line)
    if m:
        section = m.group(1)
        continue

    # Key = value
    m = re.match(r'^"?([^"=]+?)"?\s*=\s*(.+)$', line)
    if not m:
        continue
    key, val = m.group(1).strip(), m.group(2).strip()

    if section == "settings":
        # Parse array: ["a", "b"]
        items = re.findall(r'"([^"]+)"', val)
        if key == "root_files":
            root_files = items
        elif key == "exclude_paths":
            exclude_paths = items
    elif section == "breadcrumbs":
        # Strip surrounding quotes
        val = val.strip('"')
        breadcrumbs[key] = val

# Output as bash variables
# Root files as space-separated
print("ROOT_FILES=({})".format(" ".join(f'"{f}"' for f in root_files)))
print("EXCLUDE_PATHS=({})".format(" ".join(f'"{p}"' for p in exclude_paths)))

# Breadcrumbs as parallel arrays (keys and values)
keys = list(breadcrumbs.keys())
vals = list(breadcrumbs.values())
print("BC_FILES=({})".format(" ".join(f'"{k}"' for k in keys)))
# Use | as delimiter since breadcrumbs contain spaces, quotes, parens
print("BC_COUNT={}".format(len(keys)))
for i, v in enumerate(vals):
    # Escape for bash single-quote safety
    v_escaped = v.replace("'", "'\\''")
    print(f"BC_VAL_{i}='{v_escaped}'")
PYEOF
)"

# --- Collect markdown files ---

exclude_args=""
for p in "${EXCLUDE_PATHS[@]}"; do
  exclude_args="$exclude_args -not -path './$p/*'"
done

all_md=()
while IFS= read -r f; do
  all_md+=("$f")
done < <(
  eval "find . -name '*.md' $exclude_args -not -name 'CHANGELOG.md'" \
    | sed 's|^\./||' \
    | sort
)

# --- Helper: check if file is a root file ---

is_root_file() {
  local file="$1"
  for root in "${ROOT_FILES[@]}"; do
    if [ "$file" = "$root" ]; then
      return 0
    fi
  done
  return 1
}

# --- Check 1: Breadcrumbs ---

echo "== Breadcrumb check =="
echo ""

for i in $(seq 0 $((BC_COUNT - 1))); do
  file="${BC_FILES[$i]}"
  eval "expected=\$BC_VAL_$i"

  if [ ! -f "$file" ]; then
    continue  # handled in stale config check
  fi

  # Read line 3
  actual="$(sed -n '3p' "$file")"

  if [ "$actual" != "$expected" ]; then
    echo "  MISMATCH: $file"
    echo "    expected: $expected"
    echo "    actual:   $actual"
    breadcrumb_fails=$((breadcrumb_fails + 1))
  fi
done

if [ "$breadcrumb_fails" -eq 0 ]; then
  echo "  All breadcrumbs OK"
fi

echo ""

# --- Check 2: Broken links ---

echo "== Broken link check =="
echo ""

for file in "${all_md[@]}"; do
  dir="$(dirname "$file")"

  while IFS= read -r target; do
    [ -z "$target" ] && continue

    # Strip anchor fragment
    target_path="${target%%#*}"
    [ -z "$target_path" ] && continue

    # Resolve relative to file's directory
    resolved="$(python3 -c "import os.path; print(os.path.normpath('$dir/$target_path'))")"

    # Check file or directory exists
    if [ ! -e "$REPO_ROOT/$resolved" ]; then
      echo "  BROKEN: $file -> $target"
      errors=$((errors + 1))
    fi
  done < <(
    grep -oE '\[[^]]*\]\(([^)]+)\)' "$file" 2>/dev/null \
      | sed -E 's/.*\]\(([^)]+)\)/\1/' \
      | grep -vE '^(https?://|mailto:|#)' \
      || true
  )
done

if [ "$errors" -eq 0 ]; then
  echo "  All internal links OK"
fi

echo ""

# --- Check 3: Orphaned docs ---

echo "== Orphan detection =="
echo ""

for file in "${all_md[@]}"; do
  # Skip root entry points
  if is_root_file "$file"; then
    continue
  fi

  # Check if file is in the breadcrumbs config
  found=0
  for i in $(seq 0 $((BC_COUNT - 1))); do
    if [ "$file" = "${BC_FILES[$i]}" ]; then
      found=1
      break
    fi
  done

  if [ "$found" -eq 0 ]; then
    echo "  ORPHAN: $file (not in $CONFIG)"
    orphans=$((orphans + 1))
  fi
done

if [ "$orphans" -eq 0 ]; then
  echo "  No orphaned docs"
fi

echo ""

# --- Check 4: Stale config entries ---

echo "== Config coverage =="
echo ""

for i in $(seq 0 $((BC_COUNT - 1))); do
  file="${BC_FILES[$i]}"
  if [ ! -f "$file" ]; then
    echo "  STALE: $CONFIG references $file but file does not exist"
    stale=$((stale + 1))
  fi
done

if [ "$stale" -eq 0 ]; then
  echo "  All config entries valid"
fi

echo ""

# --- Summary ---

total=${#all_md[@]}
echo "== Summary =="
echo ""
echo "  Files scanned:      $total"
echo "  Breadcrumb errors:  $breadcrumb_fails"
echo "  Broken links:       $errors"
echo "  Orphaned docs:      $orphans"
echo "  Stale config:       $stale"

total_problems=$((breadcrumb_fails + errors + orphans + stale))
if [ "$total_problems" -gt 0 ]; then
  exit 1
fi

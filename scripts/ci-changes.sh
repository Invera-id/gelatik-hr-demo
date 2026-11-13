#!/usr/bin/env bash
# Decide which components CI must verify for a change set.
# Usage: ci-changes.sh <base-sha> <head-sha>  → writes web=,api=,contracts= to $GITHUB_OUTPUT (or stdout).
set -euo pipefail
base="${1:-}"
head="${2:-HEAD}"
out="${GITHUB_OUTPUT:-/dev/stdout}"
all() { printf 'web=true\napi=true\ncontracts=true\n' >>"$out"; exit 0; }
# New branch, force push or unknown base: verify everything.
if [[ -z "$base" || "$base" =~ ^0+$ ]] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then all; fi
files="$(git diff --name-only "$base" "$head")"
web=false; api=false; contracts=false
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  case "$f" in
    apps/web/*) web=true ;;
    apps/api/*) api=true ;;
    packages/contracts/*) contracts=true; web=true; api=true ;;
    package.json|package-lock.json) web=true; contracts=true ;;
    .github/workflows/*|scripts/ci-changes.sh|Makefile|compose.yaml) web=true; api=true; contracts=true ;;
    *.md|docs/*|AGENTS.md|CLAUDE.md|.gitignore|.claude/*) ;;
    *) web=true; api=true; contracts=true ;; # unknown shared file: be safe
  esac
done <<<"$files"
printf 'web=%s\napi=%s\ncontracts=%s\n' "$web" "$api" "$contracts" >>"$out"

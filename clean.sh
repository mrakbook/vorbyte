#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

echo "==> Root: $ROOT_DIR"
echo

delete_all_named_dirs() {
	target="$1"

	echo "==> Deleting '$target' directories..."

	# Minimal preview: only show "top-level-ish" ones, not pnpm internal ones
	find . -type d -name "$target" \
		! -path "*/node_modules/.pnpm/*" \
		-print 2>/dev/null || true
	echo

	# Actually delete EVERYTHING (including pnpm internal paths)
	find . -type d -name "$target" -prune -exec rm -rf {} + 2>/dev/null || true

	echo "==> Done deleting '$target'"
	echo
}

delete_all_named_dirs "node_modules"
delete_all_named_dirs "out"

echo "==> Installing dependencies..."
pnpm install

echo "==> Running dev..."
pnpm dev:studio

#!/usr/bin/env bash
# Build the Chrome Web Store upload package.
# Bundles ONLY the files the store needs — manifest at the ZIP root, no repo cruft.
# Output: dist/chatgpt-exporter-v<version>.zip
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./manifest.json').version")
OUT="dist/chatgpt-exporter-v${VERSION}.zip"

# Files that ship. Everything else (README, screenshots, demo.gif, .git) stays out.
FILES=(manifest.json background.js content.js popup.html popup.js assets)

mkdir -p dist
rm -f "$OUT"
zip -r -X "$OUT" "${FILES[@]}" -x '*.DS_Store' >/dev/null

echo "Built $OUT"
unzip -l "$OUT"

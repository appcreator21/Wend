#!/bin/sh
# Copies the static site into dist/ for Cloudflare Pages (no bundler needed).
set -e
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
cp -r index.html src data dist/
printf '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n' > dist/_headers
echo "built dist/ ($(du -sh dist | cut -f1))"

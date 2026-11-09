#!/bin/sh
# Copies the static site into dist/ for Cloudflare Pages (no bundler needed).
set -e
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist
cp -r index.html manifest.webmanifest src data icons dist/
cp icons/apple-touch-icon.png dist/apple-touch-icon.png
cp icons/apple-touch-icon.png dist/apple-touch-icon-precomposed.png
cp icons/favicon-32.png dist/favicon.ico
printf '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n' > dist/_headers
echo "built dist/ ($(du -sh dist | cut -f1))"

#!/bin/sh
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/android/app/src/main/assets/www" "$ROOT/ios/BoseControl/Web" "$ROOT/macos/BoseControl/Web"
cp "$ROOT/web/"*.html "$ROOT/web/"*.js "$ROOT/web/"*.css "$ROOT/web/"*.png "$ROOT/android/app/src/main/assets/www/"
cp "$ROOT/web/"*.html "$ROOT/web/"*.js "$ROOT/web/"*.css "$ROOT/web/"*.png "$ROOT/ios/BoseControl/Web/"
cp "$ROOT/web/"*.html "$ROOT/web/"*.js "$ROOT/web/"*.css "$ROOT/web/"*.png "$ROOT/macos/BoseControl/Web/"
echo "synced web -> android assets + ios Web + macos Web"

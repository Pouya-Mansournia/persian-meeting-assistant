#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
npm run desktop:build
mkdir -p artifacts/dmg-root
ditto src-tauri/target/release/bundle/macos/Jalaseh.app artifacts/dmg-root/Jalaseh.app
ln -sfn /Applications artifacts/dmg-root/Applications
# A plain disk image avoids Finder automation and accessibility requirements.
hdiutil create -size 512m -fs HFS+ -volname Jalaseh -srcfolder artifacts/dmg-root -ov -format UDZO artifacts/Jalaseh-macOS-arm64.dmg
printf '\nBuilt artifacts/Jalaseh-macOS-arm64.dmg\n'

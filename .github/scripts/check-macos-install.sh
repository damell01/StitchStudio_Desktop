#!/usr/bin/env bash
set -euo pipefail

bundle=${1:?Pass the bundle directory}
work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/stitch-install.XXXXXX")
mount="$work/mounted"
mkdir "$mount"
mounted=false
cleanup() {
  if [[ "$mounted" == true ]]; then hdiutil detach "$mount" -quiet || true; fi
  rm -rf "$work"
}
trap cleanup EXIT

shopt -s nullglob
images=("$bundle"/dmg/*.dmg)
[[ ${#images[@]} -eq 1 ]]
hdiutil attach "${images[0]}" -mountpoint "$mount" -readonly -nobrowse -quiet
mounted=true
app="$work/Stitch Studio.app"
ditto "$mount/Stitch Studio.app" "$app"

plist="$app/Contents/Info.plist"
[[ $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist") == 'com.stitchstudio.desktop' ]]
binary=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")
test -x "$app/Contents/MacOS/$binary"
test -r "$app/Contents/Resources/licenses/LICENSE"
lipo -verify_arch "$(uname -m)" "$app/Contents/MacOS/$binary"
echo 'macOS disk image mount and application copy passed.'

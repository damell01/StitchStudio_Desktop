#!/usr/bin/env bash
set -euo pipefail

bundle=${1:?Pass the bundle directory}
expected_arch=${2:-$(uname -m)}
trap 'echo "Installer validation failed at line $LINENO: $BASH_COMMAND" >&2' ERR
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
if [[ ${#images[@]} -ne 1 ]]; then echo "Expected exactly one DMG in $bundle/dmg, found ${#images[@]}" >&2; ls -la "$bundle" "$bundle/dmg" || true; exit 1; fi
echo "Checking ${images[0]} for $expected_arch"
hdiutil attach "${images[0]}" -mountpoint "$mount" -readonly -nobrowse -quiet
mounted=true
app="$work/Stitch Studio.app"
ditto "$mount/Stitch Studio.app" "$app"

plist="$app/Contents/Info.plist"
[[ $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist") == 'com.stitchstudio.desktop' ]]
binary=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")
test -x "$app/Contents/MacOS/$binary"
test -r "$app/Contents/Resources/licenses/LICENSE"
lipo -info "$app/Contents/MacOS/$binary"
lipo -verify_arch "$expected_arch" "$app/Contents/MacOS/$binary"
echo 'macOS disk image mount and application copy passed.'

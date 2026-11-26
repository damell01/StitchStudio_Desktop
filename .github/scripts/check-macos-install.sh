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
  if [[ "$mounted" == true ]] || /sbin/mount | grep -Fq " on $mount ("; then
    if ! hdiutil detach "$mount" -quiet; then
      echo "Could not detach test image; preserving temporary mount directory" >&2
      return
    fi
  fi
  rm -rf "$work"
}
trap cleanup EXIT

shopt -s nullglob
images=("$bundle"/dmg/*.dmg)
if [[ ${#images[@]} -ne 1 ]]; then echo "Expected exactly one DMG in $bundle/dmg, found ${#images[@]}" >&2; ls -la "$bundle" "$bundle/dmg" || true; exit 1; fi
echo "Checking ${images[0]} for $expected_arch"
# Resolve the path before invoking DiskImages services and verify the image
# checksum independently. Hosted macOS runners can transiently fail to
# attach an otherwise valid image; keep the actual diagnostic output.
image="$(cd "$(dirname "${images[0]}")" && pwd -P)/$(basename "${images[0]}")"
hdiutil verify "$image"
for attempt in 1 2 3; do
  echo "Mount attempt $attempt"
  # Accept the embedded license for this unattended CI smoke test only.
  if hdiutil attach "$image" -mountpoint "$mount" -readonly -nobrowse -noautoopen -verbose <<< 'Y' && [[ -d "$mount/Stitch Studio.app" ]]; then
    mounted=true
    break
  fi
  if [[ -d "$mount/Stitch Studio.app" ]]; then
    mounted=true
    break
  fi
  sleep "$((attempt * 2))"
done
if [[ "$mounted" != true ]]; then
  echo "DMG verified but could not be mounted; disk image service diagnostics:" >&2
  hdiutil info || true
  diskutil list || true
  exit 1
fi
app="$work/Stitch Studio.app"
ditto "$mount/Stitch Studio.app" "$app"

plist="$app/Contents/Info.plist"
[[ $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist") == 'com.stitchstudio.desktop' ]]
binary=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")
test -x "$app/Contents/MacOS/$binary"
test -r "$app/Contents/Resources/licenses/LICENSE"
test -r "$app/Contents/Resources/licenses/NOTICE"
test -r "$app/Contents/Resources/licenses/THIRD-PARTY-NOTICES.md"
lipo -info "$app/Contents/MacOS/$binary"
lipo "$app/Contents/MacOS/$binary" -verify_arch "$expected_arch"
# Validate the copied bundle's property list and signature integrity. This
# checks ad-hoc signatures too; notarization is a separate release requirement.
plutil -lint "$plist"
codesign --verify --deep --strict --verbose=2 "$app"
assistant="$app/Contents/Resources/local-assistant"
model="$assistant/qwen2.5-0.5b-instruct-q4_k_m.gguf"
[[ $(stat -f %z "$model") -eq 491400032 ]]
lipo "$assistant/runtime/llama-cli" -verify_arch "$expected_arch"
"$assistant/runtime/llama-cli" --version
echo 'macOS disk image mount and application copy passed.'

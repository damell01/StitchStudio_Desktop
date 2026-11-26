#!/usr/bin/env bash
set -euo pipefail

version=${1:?Version is required}
packages=${2:?Feed directory is required}
if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ||
      ! "${HOSTINGER_SSH_HOST:-}" =~ ^[A-Za-z0-9_-]+@[A-Za-z0-9.-]+$ ||
      ! "${HOSTINGER_SSH_PORT:-}" =~ ^[1-9][0-9]{0,4}$ ||
      ! "${HOSTINGER_FEED_DIR:-}" =~ ^/[A-Za-z0-9_./-]+/stitch-studio-private/feed$ ||
      "$HOSTINGER_FEED_DIR" == *'/../'* || "$HOSTINGER_FEED_DIR" == *'/public_html/'* ]]; then
  echo 'Invalid private Hostinger deployment settings.' >&2
  exit 1
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077
printf '%s\n' "${HOSTINGER_SSH_KEY:?Set the Hostinger deployment key}" > "$work/key"
printf '%s\n' "${HOSTINGER_KNOWN_HOSTS:?Pin the Hostinger SSH host key}" > "$work/known_hosts"
options=(-i "$work/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$work/known_hosts")
remote=$HOSTINGER_SSH_HOST
root=$HOSTINGER_FEED_DIR
incoming="$root/.incoming-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
test -f "$packages/latest.json"
test -d "$packages/$version"
ssh "${options[@]}" -p "$HOSTINGER_SSH_PORT" "$remote" "mkdir -p '$root' && mkdir '$incoming'"
scp "${options[@]}" -P "$HOSTINGER_SSH_PORT" -r "$packages/latest.json" "$packages/$version" "$remote:$incoming/"
ssh "${options[@]}" -p "$HOSTINGER_SSH_PORT" "$remote" bash -s -- "$root" "$incoming" "$version" <<'REMOTE'
set -euo pipefail
root=$1
incoming=$2
version=$3
lock="$root/.stitch-publish-lock"
mkdir "$lock"
trap 'rmdir "$lock"' EXIT
php -r '
  $next = json_decode(file_get_contents($argv[1]), true, flags: JSON_THROW_ON_ERROR)["version"];
  if ($next !== $argv[3]) exit(1);
  if (is_file($argv[2])) {
    $previous = json_decode(file_get_contents($argv[2]), true, flags: JSON_THROW_ON_ERROR)["version"];
    if (version_compare($next, $previous, "<=")) exit(1);
  }
' "$incoming/latest.json" "$root/latest.json" "$version"
if [[ -e "$root/$version" ]]; then
  diff -qr "$incoming/$version" "$root/$version"
  rm -r "$incoming/$version"
else
  mv "$incoming/$version" "$root/$version"
fi
mv -f "$incoming/latest.json" "$root/latest.json"
rmdir "$incoming"
REMOTE

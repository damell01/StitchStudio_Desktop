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
feed_url=${STITCH_UPDATE_FEED:-https://www.dbellcreations.com/stitch-updates/latest.json}
if [[ ! "$feed_url" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/stitch-updates/latest\.json$ ||
      ! "${STITCH_FEED_ACCESS_KEY:-}" =~ ^[a-f0-9]{64}$ ]]; then
  echo 'Set the private HTTPS feed URL and 64-character access key.' >&2
  exit 1
fi
test -f "$packages/latest.json"
test -d "$packages/$version"
status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$feed_url")
if [[ "$status" == 404 || "$status" == 503 ]]; then
  bash "$(dirname "${BASH_SOURCE[0]}")/setup-hostinger-update.sh"
  status=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$feed_url")
fi
if [[ "$status" != 401 ]]; then
  echo "Expected the unauthenticated update endpoint to return 401, received $status." >&2
  exit 1
fi
authenticated() {
  printf 'header = "Authorization: Bearer %s"\n' "$STITCH_FEED_ACCESS_KEY" |
    curl -fsS -K - --max-time 15 "$feed_url" "$@"
}
status=$(authenticated -o /dev/null -w '%{http_code}')
if [[ "$status" != 200 && "$status" != 204 ]]; then
  echo "Expected an authenticated feed response of 200 or 204, received $status." >&2
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
incoming="$root/.incoming-${work##*/}"
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

authenticated | node -e '
  let value = "";
  process.stdin.on("data", data => value += data);
  process.stdin.on("end", () => {
    if (JSON.parse(value).version !== process.argv[1]) {
      console.error("The public endpoint did not serve the published version.");
      process.exitCode = 1;
    }
  });
' "$version"

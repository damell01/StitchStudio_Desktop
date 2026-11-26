#!/usr/bin/env bash
set -euo pipefail

if [[ ! "${HOSTINGER_SSH_HOST:-}" =~ ^[A-Za-z0-9_-]+@[A-Za-z0-9.-]+$ ||
      ! "${HOSTINGER_SSH_PORT:-}" =~ ^[1-9][0-9]{0,4}$ ||
      ! "${HOSTINGER_FEED_DIR:-}" =~ ^/[A-Za-z0-9_./-]+/stitch-studio-private/feed$ ||
      "$HOSTINGER_FEED_DIR" == *'/../'* || "$HOSTINGER_FEED_DIR" == *'/public_html/'* ||
      ! "${STITCH_FEED_ACCESS_KEY:-}" =~ ^[a-f0-9]{64}$ ]]; then
  echo 'Set the Hostinger SSH settings and private update access key.' >&2
  exit 1
fi

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../packaging/update-host" && pwd)
domain_dir=${HOSTINGER_FEED_DIR%/stitch-studio-private/feed}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
umask 077
printf '%s\n' "${HOSTINGER_SSH_KEY:?Set the Hostinger deployment key}" > "$work/key"
printf '%s\n' "${HOSTINGER_KNOWN_HOSTS:?Pin the Hostinger SSH host key}" > "$work/known_hosts"
printf '%s' "$STITCH_FEED_ACCESS_KEY" | openssl dgst -sha256 -r | cut -d' ' -f1 > "$work/access-key.sha256"
grep -Eq '^[a-f0-9]{64}$' "$work/access-key.sha256"
options=(-i "$work/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$work/known_hosts")
remote=$HOSTINGER_SSH_HOST
stage=$(ssh "${options[@]}" -p "$HOSTINGER_SSH_PORT" "$remote" bash -s -- "$domain_dir" <<'REMOTE'
set -euo pipefail
domain=$1
private="$domain/stitch-studio-private"
test -d "$domain/public_html" && test ! -L "$domain/public_html"
test ! -L "$private" && test ! -L "$private/feed"
umask 077
mkdir -p "$private/feed"
mktemp -d "$private/.endpoint-XXXXXXXX"
REMOTE
)
if [[ ! "$stage" == "$domain_dir"/stitch-studio-private/.endpoint-* ||
      ! "$stage" =~ ^/[A-Za-z0-9_./-]+$ ]]; then
  echo 'Unexpected Hostinger staging path.' >&2
  exit 1
fi
scp "${options[@]}" -P "$HOSTINGER_SSH_PORT" \
  "$source_dir/index.php" "$source_dir/.htaccess" "$work/access-key.sha256" "$remote:$stage/"
ssh "${options[@]}" -p "$HOSTINGER_SSH_PORT" "$remote" bash -s -- "$domain_dir" "$stage" <<'REMOTE'
set -euo pipefail
domain=$1
stage=$2
private="$domain/stitch-studio-private"
public="$domain/public_html/stitch-updates"
trap 'rm -f "$stage/index.php" "$stage/.htaccess" "$stage/access-key.sha256"; rmdir "$stage"' EXIT
test ! -L "$public" && test ! -L "$private" && test ! -L "$private/feed"
php -l "$stage/index.php" > /dev/null
check_existing() {
  if [ -L "$2" ] || { [ -e "$2" ] && ! cmp -s "$1" "$2"; }; then
    echo "A different file already exists at $2. Review it in hPanel." >&2
    exit 1
  fi
}
check_existing "$stage/access-key.sha256" "$private/access-key.sha256"
check_existing "$stage/index.php" "$public/index.php"
check_existing "$stage/.htaccess" "$public/.htaccess"
mkdir -p "$public"
publish() {
  # Create only when missing. Never replace an existing site file or access hash.
  if [ ! -e "$2" ]; then
    if ! (set -o noclobber; umask "$3"; cat "$1" > "$2"); then
      check_existing "$1" "$2"
    fi
  fi
}
publish "$stage/access-key.sha256" "$private/access-key.sha256" 077
publish "$stage/index.php" "$public/index.php" 022
publish "$stage/.htaccess" "$public/.htaccess" 022
REMOTE

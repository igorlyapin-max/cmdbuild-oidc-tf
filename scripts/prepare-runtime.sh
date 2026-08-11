#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
KEY_FILE=${LOG_COLLECTOR_HMAC_KEY_FILE:-"$ROOT/secrets/log_collector_hmac_key"}

for volume in cmdbuild-oidc-tf_cmdbuild_db cmdbuild-oidc-tf_logs; do
  docker volume inspect "$volume" >/dev/null 2>&1 || docker volume create "$volume" >/dev/null
done

if [ ! -s "$KEY_FILE" ]; then
  umask 077
  mkdir -p "$(dirname -- "$KEY_FILE")"
  openssl rand -hex 32 > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
fi

test "$(stat -c '%a' "$KEY_FILE")" = '600'
printf '%s\n' 'Runtime preflight complete: isolated volumes and signed log-collector key are ready.'

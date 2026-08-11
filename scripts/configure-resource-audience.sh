#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-"$ROOT/.env"}
STATE_FILE=${RESOURCE_PROJECT_ID_FILE:-"$ROOT/secrets/zitadel_cmdbuild_oidc_tf_resource_project_id"}

test -f "$ENV_FILE"
test -r "$STATE_FILE"
resource_project_id=$(tr -d '\r\n' < "$STATE_FILE")
case "$resource_project_id" in
  ''|*[!0-9]*)
    printf '%s\n' 'Resource project ID must be a non-empty numeric ZITADEL project ID.' >&2
    exit 1
    ;;
esac

temporary_file=$(mktemp "$ROOT/.env.resource-audience.XXXXXX")
trap 'rm -f "$temporary_file"' EXIT HUP INT TERM

awk -v resource_project_id="$resource_project_id" '
  BEGIN {
    replacement["CMDBUILD_RESOURCE_PROJECT_ID"] = resource_project_id
    replacement["CMDBUILD_RESOURCE_AUDIENCE"] = resource_project_id
    replacement["CMDBUILD_BEARER_AUDIENCE"] = resource_project_id
  }
  /^[A-Za-z_][A-Za-z0-9_]*=/ {
    key = substr($0, 1, index($0, "=") - 1)
    if (key in replacement) {
      print key "=" replacement[key]
      seen[key] = 1
      next
    }
  }
  { print }
  END {
    for (key in replacement) {
      if (!(key in seen)) print key "=" replacement[key]
    }
  }
' "$ENV_FILE" > "$temporary_file"

chmod 600 "$temporary_file"
mv "$temporary_file" "$ENV_FILE"
trap - EXIT HUP INT TERM
printf '%s\n' 'Configured dedicated CMDBuild resource audience in the local .env file.'

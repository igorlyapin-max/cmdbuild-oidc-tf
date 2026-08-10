#!/bin/sh
set -eu

: "${CMDBUILD_APP_PASSWORD:?CMDBUILD_APP_PASSWORD is required}"

psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 --command 'CREATE ROLE cmdbuild LOGIN;'
printf '\\password cmdbuild\n%s\n%s\n' "$CMDBUILD_APP_PASSWORD" "$CMDBUILD_APP_PASSWORD" \
  | psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 >/dev/null

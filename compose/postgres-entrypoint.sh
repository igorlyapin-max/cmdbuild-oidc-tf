#!/bin/sh
set -eu

# The official Postgres entrypoint reads POSTGRES_PASSWORD_FILE while root and
# runs initdb scripts as postgres. Supply the second, application-only secret
# through that controlled transition rather than widening file permissions.
export CMDBUILD_APP_PASSWORD=$(cat /run/secrets/cmdbuild_app_password)
exec /usr/local/bin/docker-entrypoint.sh "$@"

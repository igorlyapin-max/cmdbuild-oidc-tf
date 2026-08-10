#!/bin/sh
set -eu

docker compose --env-file .env -f compose.yml exec -T cmdbuild sh -s <<'REMOTE'
set -eu

cmdbuild='/usr/local/tomcat/webapps/cmdbuild/cmdbuild.sh'
placeholder='replace-with-zitadel-bff-client-id'

test "${CMDBUILD_BEARER_ENABLED}" = 'true'
test -n "${CMDBUILD_BEARER_ISSUER}"
test -n "${CMDBUILD_BEARER_JWKS_URL}"
test "${CMDBUILD_BEARER_AUDIENCE}" != "$placeholder"
test -n "${CMDBUILD_BEARER_USER_CLAIM}"
test -n "${CMDBUILD_BEARER_AUDIT_SINK_URL}"

set_config() {
  "$cmdbuild" restws setconfig "$1" "$2" >/dev/null
}

set_config org.cmdbuild.auth.bearer.enabled "$CMDBUILD_BEARER_ENABLED"
set_config org.cmdbuild.auth.bearer.issuer "$CMDBUILD_BEARER_ISSUER"
set_config org.cmdbuild.auth.bearer.jwksUrl "$CMDBUILD_BEARER_JWKS_URL"
set_config org.cmdbuild.auth.bearer.audience "$CMDBUILD_BEARER_AUDIENCE"
set_config org.cmdbuild.auth.bearer.userClaim "$CMDBUILD_BEARER_USER_CLAIM"
set_config org.cmdbuild.auth.bearer.clockSkewSeconds "$CMDBUILD_BEARER_CLOCK_SKEW_SECONDS"
set_config org.cmdbuild.auth.bearer.allowedJwsAlgorithm "$CMDBUILD_BEARER_ALLOWED_JWS_ALGORITHM"
set_config org.cmdbuild.auth.bearer.auditSinkUrl "$CMDBUILD_BEARER_AUDIT_SINK_URL"
set_config org.cmdbuild.auth.bearer.diagnosticLevel "$CMDBUILD_BEARER_DIAGNOSTIC_LEVEL"
# CMDBuild's built-in stdout configuration preserves its structured logger and
# makes bearer audit events observable to the container platform.
set_config org.cmdbuild.core.logger.type stdout
"$cmdbuild" restws reloadconfig >/dev/null
REMOTE

printf '%s\n' 'CMDBuild Bearer configuration reloaded; no credentials or JWT values were printed.'

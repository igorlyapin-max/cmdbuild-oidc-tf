#!/bin/sh
set -eu

: "${CMDBUILD_API_BASE_URL:?Set CMDBUILD_API_BASE_URL to https://<cmdbuild-fqdn>/cmdbuild}"
: "${CMDBUILD_BOOTSTRAP_PASSWORD_FILE:?Set CMDBUILD_BOOTSTRAP_PASSWORD_FILE}"
: "${CMDBUILD_BEARER_ISSUER:?Set CMDBUILD_BEARER_ISSUER}"
: "${CMDBUILD_BEARER_JWKS_URL:?Set CMDBUILD_BEARER_JWKS_URL}"
: "${CMDBUILD_RESOURCE_AUDIENCE:?Set CMDBUILD_RESOURCE_AUDIENCE}"
: "${CMDBUILD_BEARER_AUDIENCE:?Set CMDBUILD_BEARER_AUDIENCE}"
: "${CMDBUILD_BEARER_AUDIT_SINK_URL:?Set CMDBUILD_BEARER_AUDIT_SINK_URL}"
: "${CMDBUILD_BEARER_AUDIT_HMAC_KEY_FILE:?Set CMDBUILD_BEARER_AUDIT_HMAC_KEY_FILE}"

base_url=${CMDBUILD_API_BASE_URL%/}
validate_https_url() { case "$2" in https://*) ;; *) echo "$1 must be an HTTPS URL without query, fragment or userinfo" >&2; exit 1;; esac; case "$2" in *'?'*|*'#'*|*'@'*) echo "$1 must be an HTTPS URL without query, fragment or userinfo" >&2; exit 1;; esac; }
validate_https_url CMDBUILD_API_BASE_URL "$base_url"
validate_https_url CMDBUILD_BEARER_ISSUER "$CMDBUILD_BEARER_ISSUER"
validate_https_url CMDBUILD_BEARER_JWKS_URL "$CMDBUILD_BEARER_JWKS_URL"
test -r "$CMDBUILD_BOOTSTRAP_PASSWORD_FILE"
test "$CMDBUILD_BEARER_AUDIENCE" = "$CMDBUILD_RESOURCE_AUDIENCE" || { echo 'CMDBUILD_BEARER_AUDIENCE must equal CMDBUILD_RESOURCE_AUDIENCE' >&2; exit 1; }
case "$CMDBUILD_BEARER_AUDIENCE" in ''|replace-with-*|*'<'*'>'*) echo 'CMDBUILD_BEARER_AUDIENCE must not be a placeholder' >&2; exit 1;; esac

CMDBUILD_BEARER_ENABLED=${CMDBUILD_BEARER_ENABLED:-true}
CMDBUILD_BEARER_DEPLOYMENT_PROFILE=${CMDBUILD_BEARER_DEPLOYMENT_PROFILE:-production}
CMDBUILD_BEARER_CLOCK_SKEW_SECONDS=${CMDBUILD_BEARER_CLOCK_SKEW_SECONDS:-30}
CMDBUILD_BEARER_ALLOWED_JWS_ALGORITHM=${CMDBUILD_BEARER_ALLOWED_JWS_ALGORITHM:-RS256}
CMDBUILD_BEARER_DIAGNOSTIC_LEVEL=${CMDBUILD_BEARER_DIAGNOSTIC_LEVEL:-off}
test "$CMDBUILD_BEARER_ENABLED" = true || { echo 'CMDBUILD_BEARER_ENABLED must be true' >&2; exit 1; }
test "$CMDBUILD_BEARER_DEPLOYMENT_PROFILE" = production || { echo 'CMDBUILD_BEARER_DEPLOYMENT_PROFILE must be production' >&2; exit 1; }
test "$CMDBUILD_BEARER_ALLOWED_JWS_ALGORITHM" = RS256 || { echo 'CMDBUILD_BEARER_ALLOWED_JWS_ALGORITHM must be RS256' >&2; exit 1; }
test "$CMDBUILD_BEARER_DIAGNOSTIC_LEVEL" = off || { echo 'CMDBUILD_BEARER_DIAGNOSTIC_LEVEL must be off for customer rollout' >&2; exit 1; }

umask 077
netrc=$(mktemp)
trap 'rm -f "$netrc"' EXIT HUP INT TERM
printf 'machine %s login %s password %s\n' "$(printf %s "$base_url" | sed 's#https://##; s#/.*##')" "${CMDBUILD_BOOTSTRAP_USERNAME:-admin}" "$(cat "$CMDBUILD_BOOTSTRAP_PASSWORD_FILE")" > "$netrc"
curl_ca=''
if [ -n "${CMDBUILD_CA_BUNDLE:-}" ]; then test -r "$CMDBUILD_CA_BUNDLE"; curl_ca="--cacert $CMDBUILD_CA_BUNDLE"; fi
put() { curl --fail --silent --show-error --netrc-file "$netrc" $curl_ca -X PUT -H 'Content-Type: text/plain' --data-binary "$2" "$base_url/services/rest/v3/system/config/$1" >/dev/null; }
put org.cmdbuild.auth.bearer.enabled "$CMDBUILD_BEARER_ENABLED"
put org.cmdbuild.auth.bearer.issuer "$CMDBUILD_BEARER_ISSUER"
put org.cmdbuild.auth.bearer.jwksUrl "$CMDBUILD_BEARER_JWKS_URL"
put org.cmdbuild.auth.bearer.audience "$CMDBUILD_BEARER_AUDIENCE"
put org.cmdbuild.auth.bearer.deploymentProfile "$CMDBUILD_BEARER_DEPLOYMENT_PROFILE"
put org.cmdbuild.auth.bearer.clockSkewSeconds "$CMDBUILD_BEARER_CLOCK_SKEW_SECONDS"
put org.cmdbuild.auth.bearer.allowedJwsAlgorithm "$CMDBUILD_BEARER_ALLOWED_JWS_ALGORITHM"
put org.cmdbuild.auth.bearer.auditSinkUrl "$CMDBUILD_BEARER_AUDIT_SINK_URL"
put org.cmdbuild.auth.bearer.auditSinkHmacKeyFile "$CMDBUILD_BEARER_AUDIT_HMAC_KEY_FILE"
put org.cmdbuild.auth.bearer.diagnosticLevel "$CMDBUILD_BEARER_DIAGNOSTIC_LEVEL"
curl --fail --silent --show-error --netrc-file "$netrc" $curl_ca -X POST "$base_url/services/rest/v3/system/config/reload" >/dev/null
printf '%s\n' 'CMDBuild Bearer configuration reloaded; no credentials or token values were printed.'

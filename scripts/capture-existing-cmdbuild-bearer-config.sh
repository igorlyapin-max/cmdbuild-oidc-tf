#!/bin/sh
set -eu
: "${CMDBUILD_API_BASE_URL:?Set CMDBUILD_API_BASE_URL to https://<cmdbuild-fqdn>/cmdbuild}"
: "${CMDBUILD_BOOTSTRAP_PASSWORD_FILE:?Set CMDBUILD_BOOTSTRAP_PASSWORD_FILE}"
base_url=${CMDBUILD_API_BASE_URL%/}
case "$base_url" in https://*) ;; *) echo 'CMDBUILD_API_BASE_URL must be an HTTPS URL without query, fragment or userinfo' >&2; exit 1;; esac
case "$base_url" in *'?'*|*'#'*|*'@'*) echo 'CMDBUILD_API_BASE_URL must be an HTTPS URL without query, fragment or userinfo' >&2; exit 1;; esac
test -r "$CMDBUILD_BOOTSTRAP_PASSWORD_FILE"
umask 077; netrc=$(mktemp); trap 'rm -f "$netrc"' EXIT HUP INT TERM
printf 'machine %s login %s password %s\n' "$(printf %s "$base_url" | sed 's#https://##; s#/.*##')" "${CMDBUILD_BOOTSTRAP_USERNAME:-admin}" "$(cat "$CMDBUILD_BOOTSTRAP_PASSWORD_FILE")" > "$netrc"
curl_ca=''; if [ -n "${CMDBUILD_CA_BUNDLE:-}" ]; then test -r "$CMDBUILD_CA_BUNDLE"; curl_ca="--cacert $CMDBUILD_CA_BUNDLE"; fi
value() { curl --fail --silent --show-error --netrc-file "$netrc" $curl_ca "$base_url/services/rest/v3/system/config/$1" | jq -er '.data | strings'; }
hash() { printf %s "$1" | sha256sum | cut -c1-16; }
enabled=$(value org.cmdbuild.auth.bearer.enabled); issuer=$(value org.cmdbuild.auth.bearer.issuer); jwks=$(value org.cmdbuild.auth.bearer.jwksUrl); audience=$(value org.cmdbuild.auth.bearer.audience); profile=$(value org.cmdbuild.auth.bearer.deploymentProfile)
jq -nc --arg enabled "$enabled" --arg issuer_hash "$(hash "$issuer")" --arg jwks_hash "$(hash "$jwks")" --arg audience_hash "$(hash "$audience")" --arg profile "$profile" '{bearer:{enabled:$enabled,issuer_hash:$issuer_hash,jwks_url_hash:$jwks_hash,audience_hash:$audience_hash,deployment_profile:$profile}}'

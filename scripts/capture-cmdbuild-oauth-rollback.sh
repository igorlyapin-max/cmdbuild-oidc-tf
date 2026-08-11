#!/bin/sh
set -eu

if [ -z "${CMDBUILD_BOOTSTRAP_PASSWORD:-}" ] && [ -n "${CMDBUILD_BOOTSTRAP_PASSWORD_FILE:-}" ]; then
  test -r "$CMDBUILD_BOOTSTRAP_PASSWORD_FILE"
  CMDBUILD_BOOTSTRAP_PASSWORD="$(cat "$CMDBUILD_BOOTSTRAP_PASSWORD_FILE")"
  export CMDBUILD_BOOTSTRAP_PASSWORD
fi
: "${CMDBUILD_BOOTSTRAP_PASSWORD:?Set CMDBUILD_BOOTSTRAP_PASSWORD or CMDBUILD_BOOTSTRAP_PASSWORD_FILE}"

config_value() {
  key=$1
  docker compose --env-file .env -f compose.yml exec -T -e CMDBUILD_BOOTSTRAP_PASSWORD cmdbuild \
    sh -lc '/usr/local/tomcat/webapps/cmdbuild/cmdbuild.sh restws -username admin -password "$CMDBUILD_BOOTSTRAP_PASSWORD" config "$1"' \
    cmdbuild-oauth-config "$key"
}

modules="$(config_value org.cmdbuild.auth.modules)"
protocol="$(config_value org.cmdbuild.auth.module.oauth.protocol)"
login_attr="$(config_value org.cmdbuild.auth.module.oauth.login.attr)"
redirect_uri="$(config_value org.cmdbuild.auth.module.oauth.redirectUrl)"
service_url="$(config_value org.cmdbuild.auth.module.oauth.serviceUrl)"
client_id="$(config_value org.cmdbuild.auth.module.oauth.clientId)"
client_secret="$(config_value org.cmdbuild.auth.module.oauth.clientSecret)"
bearer_enabled="$(config_value org.cmdbuild.auth.bearer.enabled)"
bearer_issuer="$(config_value org.cmdbuild.auth.bearer.issuer)"
bearer_jwks_url="$(config_value org.cmdbuild.auth.bearer.jwksUrl)"
bearer_audience="$(config_value org.cmdbuild.auth.bearer.audience)"
bearer_user_claim="$(config_value org.cmdbuild.auth.bearer.userClaim)"
bearer_audit_sink_url="$(config_value org.cmdbuild.auth.bearer.auditSinkUrl)"
bearer_audit_hmac_key_file="$(config_value org.cmdbuild.auth.bearer.auditSinkHmacKeyFile)"

jq -nc \
  --arg modules "$modules" \
  --arg protocol "$protocol" \
  --arg login_attr "$login_attr" \
  --arg redirect_uri_hash "$(printf %s "$redirect_uri" | sha256sum | cut -c1-16)" \
  --arg service_url_hash "$(printf %s "$service_url" | sha256sum | cut -c1-16)" \
  --arg client_id_hash "$(printf %s "$client_id" | sha256sum | cut -c1-16)" \
  --argjson client_secret_configured "$(test -n "$client_secret" && printf true || printf false)" \
  --arg bearer_enabled "$bearer_enabled" \
  --arg bearer_issuer_hash "$(printf %s "$bearer_issuer" | sha256sum | cut -c1-16)" \
  --arg bearer_jwks_url_hash "$(printf %s "$bearer_jwks_url" | sha256sum | cut -c1-16)" \
  --arg bearer_audience_hash "$(printf %s "$bearer_audience" | sha256sum | cut -c1-16)" \
  --arg bearer_user_claim "$bearer_user_claim" \
  --arg bearer_audit_sink_url_hash "$(printf %s "$bearer_audit_sink_url" | sha256sum | cut -c1-16)" \
  --argjson bearer_audit_hmac_key_file_configured "$(test -n "$bearer_audit_hmac_key_file" && printf true || printf false)" \
  '{oauth: {modules: $modules, protocol: $protocol, login_attr: $login_attr, redirect_uri_hash: $redirect_uri_hash, service_url_hash: $service_url_hash, client_id_hash: $client_id_hash, client_secret_configured: $client_secret_configured}, bearer: {enabled: $bearer_enabled, issuer_hash: $bearer_issuer_hash, jwks_url_hash: $bearer_jwks_url_hash, audience_hash: $bearer_audience_hash, user_claim: $bearer_user_claim, audit_sink_url_hash: $bearer_audit_sink_url_hash, audit_hmac_key_file_configured: $bearer_audit_hmac_key_file_configured}}'

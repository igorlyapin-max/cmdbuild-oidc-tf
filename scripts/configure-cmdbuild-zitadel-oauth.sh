#!/bin/sh
set -eu

: "${CMDBUILD_OIDC_COMPAT_URL:=http://192.168.202.35:8084/cmdbuild-oidc}"
: "${CMDBUILD_OIDC_REDIRECT_URI:=http://127.0.0.1:18090/cmdbuild/oauth2/callback}"

docker compose --env-file .env -f compose.yml exec -T cmdbuild sh -s -- "$CMDBUILD_OIDC_COMPAT_URL" "$CMDBUILD_OIDC_REDIRECT_URI" <<'REMOTE'
set -eu
service_url="$1"
redirect_uri="$2"
cmdbuild='/usr/local/tomcat/webapps/cmdbuild/cmdbuild.sh'
client_id=$(cat /run/secrets/cmdbuild_oidc_tf_client_id)
client_secret=$(cat /run/secrets/cmdbuild_oidc_tf_client_secret)
set_config() {
  "$cmdbuild" restws setconfig "$1" "$2" >/dev/null
}
set_config org.cmdbuild.auth.modules default,oauth
set_config org.cmdbuild.auth.module.oauth.protocol OP_CUSTOM
set_config org.cmdbuild.auth.module.oauth.clientId "$client_id"
set_config org.cmdbuild.auth.module.oauth.clientSecret "$client_secret"
set_config org.cmdbuild.auth.module.oauth.login.type auto
set_config org.cmdbuild.auth.module.oauth.login.attr preferred_username
set_config org.cmdbuild.auth.module.oauth.redirectUrl "$redirect_uri"
set_config org.cmdbuild.auth.module.oauth.serviceUrl "$service_url"
set_config org.cmdbuild.auth.module.oauth.scope 'openid profile email'
set_config org.cmdbuild.auth.module.oauth.logout.enabled false
"$cmdbuild" restws reloadconfig >/dev/null
REMOTE

printf '%s\n' 'CMDBuild OAuth configuration reloaded; no secret values were printed.'

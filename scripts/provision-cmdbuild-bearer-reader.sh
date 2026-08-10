#!/bin/sh
set -eu

# Bootstrap is the only administrative path in this POC. BFF/MCP never uses
# these credentials: it forwards only the authenticated user's Bearer token.
api_url="${CMDBUILD_BOOTSTRAP_URL:-http://127.0.0.1:18090/cmdbuild/services/rest/v3}"
admin_username="${CMDBUILD_BOOTSTRAP_USERNAME:-admin}"
reader_username="${CMDBUILD_BEARER_READER_USERNAME:-cmdbuild-oidc-tf-reader}"
reader_group="${CMDBUILD_BEARER_READER_GROUP:-CmdbOidcTfReader}"

if [ -n "${CMDBUILD_BOOTSTRAP_PASSWORD_FILE:-}" ]; then
  test -r "$CMDBUILD_BOOTSTRAP_PASSWORD_FILE"
  admin_password="$(tr -d '\r\n' < "$CMDBUILD_BOOTSTRAP_PASSWORD_FILE")"
elif [ -n "${CMDBUILD_BOOTSTRAP_PASSWORD:-}" ]; then
  admin_password="$CMDBUILD_BOOTSTRAP_PASSWORD"
else
  printf '%s\n' 'Set CMDBUILD_BOOTSTRAP_PASSWORD_FILE (preferred) or CMDBUILD_BOOTSTRAP_PASSWORD.' >&2
  exit 64
fi

request() {
  curl --fail --silent --show-error \
    --user "$admin_username:$admin_password" \
    -H 'Accept: application/json' \
    "$@"
}

role_id="$(request "$api_url/roles/?limit=100" | jq -er --arg name "$reader_group" '.data[] | select(.name == $name) | ._id' | head -n 1 || true)"
role_result='existing'
if [ -z "$role_id" ]; then
  role_id="$(jq -nc --arg name "$reader_group" --arg description 'Least-privilege group for direct Bearer OIDC POC' '{name: $name, description: $description, active: true, rolePrivileges: []}' | request -X POST -H 'Content-Type: application/json' --data-binary @- "$api_url/roles/" | jq -er '.data._id')"
  role_result='created'
fi

user_id="$(request "$api_url/users/?limit=100" | jq -er --arg username "$reader_username" '.data[] | select(.username == $username) | ._id' | head -n 1 || true)"
user_result='existing'
if [ -z "$user_id" ]; then
  reader_bootstrap_password="$(openssl rand -base64 48 | tr -d '\r\n')"
  jq -nc \
    --arg username "$reader_username" \
    --arg description 'Disposable direct-Bearer OIDC reader; local password is intentionally unrecoverable' \
    --arg password "$reader_bootstrap_password" \
    --argjson role_id "$role_id" \
    '{username: $username, description: $description, password: $password, changePasswordRequired: true, active: true, service: false, multiGroup: false, userGroups: [{_id: $role_id}], defaultUserGroup: $role_id}' \
    | request -X POST -H 'Content-Type: application/json' --data-binary @- "$api_url/users/" >/dev/null
  user_result='created'
fi

printf '%s\n' "CMDBuild direct-Bearer bootstrap complete: group=$role_result user=$user_result username=$reader_username"

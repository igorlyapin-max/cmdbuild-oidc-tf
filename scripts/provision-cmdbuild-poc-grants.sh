#!/bin/sh
set -eu

if [ -z "${CMDBUILD_BOOTSTRAP_PASSWORD:-}" ] && [ -n "${CMDBUILD_BOOTSTRAP_PASSWORD_FILE:-}" ]; then
  test -r "$CMDBUILD_BOOTSTRAP_PASSWORD_FILE"
  CMDBUILD_BOOTSTRAP_PASSWORD="$(cat "$CMDBUILD_BOOTSTRAP_PASSWORD_FILE")"
  export CMDBUILD_BOOTSTRAP_PASSWORD
fi
: "${CMDBUILD_BOOTSTRAP_PASSWORD:?Set CMDBUILD_BOOTSTRAP_PASSWORD or CMDBUILD_BOOTSTRAP_PASSWORD_FILE for the isolated CMDBuild admin only}"

CMDBUILD_POC_CLASS=${CMDBUILD_POC_CLASS:-Building}
CMDBUILD_POC_CARD_CODE=${CMDBUILD_POC_CARD_CODE:-cmdbuild-oidc-tf-poc}
CMDBUILD_POC_READER_GROUP=${CMDBUILD_POC_READER_GROUP:-CmdbOidcTfReader}
CMDBUILD_POC_EDITOR_GROUP=${CMDBUILD_POC_EDITOR_GROUP:-CmdbOidcTfEditor}

subject_for_role() {
  role=$1
  state_file="secrets/zitadel_cmdbuild_oidc_tf_${role}_user_id"
  test -r "$state_file"
  subject=$(tr -d '\r\n' < "$state_file")
  test -n "$subject"
  printf '%s\n' "$subject"
}

# ZITADEL user ID is the immutable OIDC `sub`. It is deliberately the local
# CMDBuild username for this isolated POC; human-readable login names are not
# authorization keys.
CMDBUILD_POC_READER_USERNAME=${CMDBUILD_POC_READER_USERNAME:-$(subject_for_role reader)}
CMDBUILD_POC_EDITOR_USERNAME=${CMDBUILD_POC_EDITOR_USERNAME:-$(subject_for_role editor)}

request() {
  method=$1
  path=$2
  body=${3-}
  docker compose --env-file .env -f compose.yml exec -T -e CMDBUILD_BOOTSTRAP_PASSWORD cmdbuild \
    sh -c 'method=$1; path=$2; body=$3
      if [ -n "$body" ]; then
        printf "%s" "$body" | curl --fail --silent --show-error --user "admin:${CMDBUILD_BOOTSTRAP_PASSWORD}" -H "Accept: application/json" -H "Content-Type: application/json" -X "$method" --data-binary @- "http://127.0.0.1:8080/cmdbuild/services/rest/v3${path}"
      else
        curl --fail --silent --show-error --user "admin:${CMDBUILD_BOOTSTRAP_PASSWORD}" -H "Accept: application/json" -X "$method" "http://127.0.0.1:8080/cmdbuild/services/rest/v3${path}"
      fi' cmdbuild-poc-request "$method" "$path" "$body"
}

ensure_role() {
  role_name=$1
  role_description=$2
  role_id="$(request GET '/roles/?limit=100' | jq -er --arg name "$role_name" '.data[] | select(.name == $name) | ._id' | head -n 1 || true)"
  if [ -n "$role_id" ]; then
    printf '%s\n' "$role_id"
    return
  fi
  body="$(jq -nc --arg name "$role_name" --arg description "$role_description" \
    '{name: $name, description: $description, active: true, rolePrivileges: []}')"
  request POST '/roles/' "$body" \
    | jq -er '.data._id'
}

ensure_user() {
  username=$1
  role_id=$2
  description=$3
  user_id="$(request GET '/users/?limit=100' | jq -er --arg username "$username" '.data[] | select(.username == $username) | ._id' | head -n 1 || true)"
  if [ -n "$user_id" ]; then
    printf '%s\n' "$user_id"
    return
  fi
  local_password="$(openssl rand -base64 48 | tr -d '\r\n')"
  body="$(jq -nc \
    --arg username "$username" \
    --arg description "$description" \
    --arg password "$local_password" \
    --argjson role_id "$role_id" \
    '{username: $username, description: $description, password: $password, changePasswordRequired: true, active: true, service: false, multiGroup: false, userGroups: [{_id: $role_id}], defaultUserGroup: $role_id}')"
  request POST '/users/' "$body" \
    | jq -er '.data._id'
}

ensure_card() {
  card_id="$(request GET "/classes/${CMDBUILD_POC_CLASS}/cards/?limit=100" | jq -er --arg code "$CMDBUILD_POC_CARD_CODE" '.data[] | select(.Code == $code) | ._id' | head -n 1 || true)"
  if [ -n "$card_id" ]; then
    printf '%s\n' "$card_id"
    return
  fi
  body="$(jq -nc --arg code "$CMDBUILD_POC_CARD_CODE" \
    --arg description 'Isolated CMDBuild OIDC POC test card; value is restored after every editor check' \
    '{Code: $code, Description: $description}')"
  request POST "/classes/${CMDBUILD_POC_CLASS}/cards/" "$body" \
    | jq -er '.data._id'
}

set_grant() {
  role_name=$1
  mode=$2
  can_update=false
  if [ "$mode" = write ]; then can_update=true; fi
  filter="{\"attribute\":{\"simple\":{\"attribute\":\"Code\",\"operator\":\"equal\",\"parameterType\":\"fixed\",\"value\":[\"${CMDBUILD_POC_CARD_CODE}\"]}}}"
  body="$(jq -nc --arg mode "$mode" --arg class "$CMDBUILD_POC_CLASS" --arg filter "$filter" --argjson can_update "$can_update" \
    '[{mode: $mode, objectType: "class", objectTypeName: $class, filter: $filter, _can_create: false, _can_update: $can_update, _can_delete: false, _can_clone: false, _can_bulk_update: false, _can_bulk_delete: false}]')"
  request POST "/roles/${role_name}/grants/_ANY" "$body" >/dev/null
}

reader_role_id="$(ensure_role "$CMDBUILD_POC_READER_GROUP" 'Least-privilege reader group for the CMDBuild OIDC POC card')"
editor_role_id="$(ensure_role "$CMDBUILD_POC_EDITOR_GROUP" 'Least-privilege editor group for the CMDBuild OIDC POC card')"
ensure_user "$CMDBUILD_POC_READER_USERNAME" "$reader_role_id" 'Disposable direct-Bearer OIDC reader; local password is intentionally unrecoverable' >/dev/null
ensure_user "$CMDBUILD_POC_EDITOR_USERNAME" "$editor_role_id" 'Disposable direct-Bearer OIDC editor; local password is intentionally unrecoverable' >/dev/null
card_id="$(ensure_card)"
set_grant "$CMDBUILD_POC_READER_GROUP" read
set_grant "$CMDBUILD_POC_EDITOR_GROUP" write

jq -nc --arg card_id "$card_id" --arg reader_group "$CMDBUILD_POC_READER_GROUP" --arg editor_group "$CMDBUILD_POC_EDITOR_GROUP" \
  '{status: "ready", card_id: $card_id, reader_group: $reader_group, editor_group: $editor_group}'

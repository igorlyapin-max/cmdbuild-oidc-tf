#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"
ENV_FILE=${ENV_FILE:-.env}
test -f "$ENV_FILE"

gateway_port=$(awk -F= '$1 == "MCP_GATEWAY_PORT" { print $2; exit }' "$ENV_FILE")
gateway_port=${gateway_port:-18100}
case "$gateway_port" in
  *[!0-9]*|'')
    printf '%s\n' 'MCP_GATEWAY_PORT must be numeric.' >&2
    exit 1
    ;;
esac

temporary_env=$(mktemp /tmp/cmdbuild-oidc-tf-wrong-audience.XXXXXX)
restored=false
cleanup() {
  rm -f "$temporary_env"
  if [ "$restored" = false ]; then
    docker compose --env-file "$ENV_FILE" -f compose.yml up -d --force-recreate mcp-gateway >/dev/null
  fi
}
trap cleanup EXIT HUP INT TERM

awk '
  /^[A-Za-z_][A-Za-z0-9_]*=/ {
    key = substr($0, 1, index($0, "=") - 1)
    if (key == "CMDBUILD_RESOURCE_PROJECT_ID" || key == "CMDBUILD_RESOURCE_AUDIENCE") {
      print key "=wrong-audience-for-isolated-poc"
      seen[key] = 1
      next
    }
  }
  { print }
  END {
    if (!("CMDBUILD_RESOURCE_PROJECT_ID" in seen)) print "CMDBUILD_RESOURCE_PROJECT_ID=wrong-audience-for-isolated-poc"
    if (!("CMDBUILD_RESOURCE_AUDIENCE" in seen)) print "CMDBUILD_RESOURCE_AUDIENCE=wrong-audience-for-isolated-poc"
  }
' "$ENV_FILE" > "$temporary_env"

wait_ready() {
  attempt=0
  while [ "$attempt" -lt 30 ]; do
    if curl --fail --silent --show-error "http://127.0.0.1:${gateway_port}/ready" >/dev/null; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  return 1
}

docker compose --env-file "$temporary_env" -f compose.yml up -d --force-recreate mcp-gateway >/dev/null
wait_ready
node scripts/e2e-openwebui-native-mcp-audience-rejection.mjs reject

docker compose --env-file "$ENV_FILE" -f compose.yml up -d --force-recreate mcp-gateway >/dev/null
wait_ready
restored=true
node scripts/e2e-openwebui-native-mcp-audience-rejection.mjs accept
printf '%s\n' 'Resource-audience rejection/restore boundary passed.'

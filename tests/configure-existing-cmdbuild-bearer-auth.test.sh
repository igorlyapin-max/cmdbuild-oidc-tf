#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
mkdir "$tmp/bin"
cat > "$tmp/bin/curl" <<'MOCK'
#!/bin/sh
printf '%s\n' "$*" >> "$CURL_LOG"
exit 0
MOCK
chmod +x "$tmp/bin/curl"
printf 'not-a-secret-in-output' > "$tmp/password"
PATH="$tmp/bin:$PATH" CURL_LOG="$tmp/curl.log" \
CMDBUILD_API_BASE_URL=https://cmdb.example.org/cmdbuild \
CMDBUILD_BOOTSTRAP_PASSWORD_FILE="$tmp/password" \
CMDBUILD_BEARER_ISSUER=https://idp.example.org \
CMDBUILD_BEARER_JWKS_URL=https://idp.example.org/jwks \
CMDBUILD_RESOURCE_AUDIENCE=cmdbuild-api \
CMDBUILD_BEARER_AUDIENCE=cmdbuild-api \
CMDBUILD_BEARER_AUDIT_SINK_URL=https://audit.example.org/v1/logs \
CMDBUILD_BEARER_AUDIT_HMAC_KEY_FILE=/run/secrets/audit \
  "$root/scripts/configure-existing-cmdbuild-bearer-auth.sh" > "$tmp/out"
test "$(wc -l < "$tmp/curl.log" | tr -d ' ')" = 11
rg -q '/system/config/reload' "$tmp/curl.log"
! rg -q 'not-a-secret-in-output' "$tmp/out"
printf '%s\n' 'configure-existing-cmdbuild-bearer-auth: OK'

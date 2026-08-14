# cmdbuild-oidc-tf: OIDC, group claims, MCP token forwarding

Language: [English](README.md) | [Русский](README.ru.md)

For an existing customer CMDBuild environment, start with the
[customer deployment kit](docs/customer/README.md). It covers the patch,
CMDBuild API configuration, FAM/ZITADEL, UI+BFF and OpenWebUI MCP. Native
CMDBuild browser UI/SAML is outside the delivered API scope.

## Repository verification environment (not customer deployment)

The isolated POC below is regression evidence for the patch, not a customer
environment blueprint:

- OpenWebUI работает через OIDC; local password form отключена;
- OpenWebUI RBAC и доступ к MCP определяются плоским custom claim `cmdbuild_oidc_tf_groups`;
- MCP gateway передаёт в CMDBuild только access token текущего пользователя;
- отдельный CMDBuild 4.2 и BFF-аналог custom page не затрагивают рабочие CMDBuild и `cmdbcustompages`.

Исходники POC хранятся в Git как patch поверх checksum-verified official CMDBuild 4.2.0 source; upstream archive и распакованный vendor source не хранятся в репозитории. Пароли и токены не выводятся и не хранятся в документации.

## Architecture

```text
Browser
  |-- :8083 --> cmdbuild-oidc-tf edge --> existing OpenWebUI :13001
  |-- :8084 --> cmdbuild-oidc-tf edge --> existing ZITADEL API :18080 / login :13000
  |-- :8085 --> cmdbuild-oidc-tf edge --> MCP gateway :18100
  `-- :18086 -----------------> OIDC BFF analogue (direct; no reverse proxy)

OpenWebUI -- OAuth access token --> MCP gateway -- same Bearer token --> isolated CMDBuild :18090
MCP gateway + BFF -- structured redacted logs --> local log collector :18101 --> named volume
```

`cmdbuild-oidc-tf edge` only restores the already configured public URLs for the existing stack. It does not change its source files, volumes, secrets, or containers. The BFF at `:18086` deliberately has no reverse proxy.

## Start

1. Apply the ZITADEL and OpenWebUI setup in the [administrator runbook](docs/administrator-runbook.md). The existing OpenWebUI OIDC client uses `cmdbuild_oidc_tf_groups`; local password login stays disabled.
2. Keep `secrets/` local. Create the isolated external volumes and the `0600`
   HMAC key required by the log collector:

   ```bash
   scripts/prepare-runtime.sh
   ```

3. Before requesting a new resource audience or changing CMDBuild OAuth
   configuration, capture the existing configuration with a host-readable
   CMDBuild administrator-password file. The snapshot prints hashes and flags
   only; it never prints a password, secret, cookie, or token.

4. Create the dedicated ZITADEL project resource, write its exact ID into the
   local `.env`, and update the project-scoped role action. The resource ID is
   an access-token audience; it must not be any OIDC client ID.

   ```bash
   CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
     scripts/capture-cmdbuild-oauth-rollback.sh
   node scripts/create-zitadel-cmdbuild-oidc-tf-resource-project.mjs
   scripts/configure-resource-audience.sh
   node scripts/update-zitadel-cmdbuild-oidc-tf-flat-groups-action.mjs
   ```

5. Before starting the OAuth-configured CMDBuild service, start `oidc-edge`
   and provision/reconcile the dedicated CMDBuild and native-MCP clients. This
   creates local `0600` files `secrets/cmdbuild_oidc_tf_client_id` and
   `secrets/cmdbuild_oidc_tf_client_secret`; neither is tracked or printed.
   If the confidential CMDBuild client was created before identity state was
   recorded, run its reconcile once with `CMDBUILD_ROTATE_CLIENT_SECRET=true`.

   ```bash
   docker compose --env-file .env -f compose.yml up -d oidc-edge
   CMDBUILD_ROTATE_CLIENT_SECRET=true \
     node scripts/provision-zitadel-cmdbuild-oidc-tf-cmdbuild-client.mjs
   node scripts/provision-zitadel-cmdbuild-oidc-tf-native-mcp-client.mjs
   node scripts/configure-zitadel-cmdbuild-oidc-tf-native-mcp-token-settings.mjs
   node scripts/configure-openwebui-native-mcp.mjs
   ```

6. Validate and start. Reconfigure the CMDBuild OAuth and Bearer modules after
   the fork is healthy:

   ```bash
   docker compose --env-file .env -f compose.yml config --quiet
   docker compose --env-file .env -f compose.yml up -d --build
   scripts/configure-cmdbuild-zitadel-oauth.sh
   scripts/configure-cmdbuild-bearer-auth.sh
   ```

   If `boot/status` reports `WAITING_FOR_PATCH_MANAGER`, run the isolated maintenance job before the next application start:

   ```bash
   docker compose --env-file .env -f compose.yml stop cmdbuild
   docker compose --env-file .env -f compose.yml --profile maintenance run --rm cmdbuild-db-patch
   docker compose --env-file .env -f compose.yml up -d cmdbuild
   ```

5. Run the focused checks:

   ```bash
   npm run typecheck
   npm test
   MCP_SMOKE_URL=http://127.0.0.1:18100 npm run smoke:mcp
   docker compose --env-file .env -f compose.yml ps
   ```

   The IdP-neutral Bearer patch gates are separate from the live ZITADEL POC:

   ```bash
   npm run verify:cmdbuild-bearer-artifact
   npm run test:cmdbuild-bearer:integration
   ```

   The integration command starts an isolated temporary Docker project with a
   local RS256/JWKS fixture. It never uses ZITADEL, OpenWebUI, FAM or the POC
   volumes, and deletes its own project and volumes after the result.

The first CMDBuild initialization can take several minutes. Its data volumes are `cmdbuild-oidc-tf_cmdbuild_db` and `cmdbuild-oidc-tf_logs`; they are distinct from the rollback volumes of the prior POC and from the existing CMDBuild stack.

## Guarantees and deliberate limits

- Gateway validates JWT signature, issuer, audience, expiry, then parses the standard ZITADEL project-role claim. If the verified access token has no roles, it reads the same subject's UserInfo response. Unknown or no group is denied.
- `reader` can call only read tools. `editor` and `admin` can use the bounded demo update. The tool permits one configured demo card and allowlisted attributes only.
- Gateway and BFF do not have a CMDBuild service-account fallback. The stock
  CMDBuild 4.2 image remains Bearer-unsupported; only the checksum-verified
  local fork can validate a forwarded user access token.
- The isolated prior POC proved browser mapping by immutable `sub` and
  `direct-user-api-pass`. This P1/P2 resource-audience hardening must be
  revalidated with the commands in the runbook before relying on that result.
  It does not authorize production proxy removal.
- JWTs, passwords, cookies, auth headers, OAuth codes, and secrets are redacted from stdout and from the log collector.
- `DIAGNOSTIC_LEVEL=basic` is normal. `verbose` is temporary and still redacted.
- OpenWebUI has a stable `WEBUI_SECRET_KEY` Docker secret. Its first rollout clears only stale encrypted `oauth_session` cache rows; users must sign in again. This key must never be rotated casually because it encrypts OAuth sessions and MCP OAuth client data.
- HTTP is intentional for the current private test host only. Production deployment requires HTTPS, secure cookies, a hardened external log sink, and a secrets manager.

Customer deployment starts with [the customer deployment kit](docs/customer/README.md).
The isolated POC material is retained only as [verification appendix](docs/verification/README.md).

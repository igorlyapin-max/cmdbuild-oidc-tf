# cmdbuild-oidc-tf: OIDC, group claims, MCP token forwarding

Изолированный POC для проверки авторизации приложений через существующий ZITADEL:

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
2. Keep `secrets/` local. `secrets/cmdbuild_db_password` is generated for this POC. The BFF is a public PKCE client, so `secrets/bff_client_secret` may contain `unconfigured`; a confidential replacement must be `0600`.
3. Before starting the OAuth-configured CMDBuild service, start `oidc-edge` and provision the dedicated client. This creates local `0600` files `secrets/cmdbuild_oidc_tf_client_id` and `secrets/cmdbuild_oidc_tf_client_secret`; neither is tracked or printed:

   ```bash
   docker compose --env-file .env -f compose.yml up -d oidc-edge
   node scripts/provision-zitadel-cmdbuild-oidc-tf-cmdbuild-client.mjs
   ```

4. Validate and start:

   ```bash
   docker compose --env-file .env -f compose.yml config --quiet
   docker compose --env-file .env -f compose.yml up -d --build
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

The first CMDBuild initialization can take several minutes. Its data volumes are `cmdbuild-oidc-tf_cmdbuild_db` and `cmdbuild-oidc-tf_logs`; they are distinct from the rollback volumes of the prior POC and from the existing CMDBuild stack.

## Guarantees and deliberate limits

- Gateway validates JWT signature, issuer, audience, expiry, then parses the standard ZITADEL project-role claim. If the verified access token has no roles, it reads the same subject's UserInfo response. Unknown or no group is denied.
- `reader` can call only read tools. `editor` and `admin` can use the bounded demo update. The tool permits one configured demo card and allowlisted attributes only.
- Gateway and BFF do not have a CMDBuild service-account fallback. The current stock CMDBuild 4.2 result for a forwarded ZITADEL user token is HTTP `400 generic error`; this is a recorded negative result, not a bypass.
- The configured CMDBuild OAuth-module endpoint adapter is not a CMDBuild reverse proxy. In the current run it reaches the UI shell but does not establish a proved mapped CMDBuild session; therefore the POC does not authorise removing the `cmdbcustompages` session-proxy pattern.
- JWTs, passwords, cookies, auth headers, OAuth codes, and secrets are redacted from stdout and from the log collector.
- `DIAGNOSTIC_LEVEL=basic` is normal. `verbose` is temporary and still redacted.
- OpenWebUI has a stable `WEBUI_SECRET_KEY` Docker secret. Its first rollout clears only stale encrypted `oauth_session` cache rows; users must sign in again. This key must never be rotated casually because it encrypts OAuth sessions and MCP OAuth client data.
- HTTP is intentional for the current private test host only. Production deployment requires HTTPS, secure cookies, a hardened external log sink, and a secrets manager.

See [entry points](docs/entrypoints.md), the [administrator runbook](docs/administrator-runbook.md), [CMDBuild OIDC discovery](docs/cmdbuild-oidc-discovery.md), and the [validation matrix](docs/validation-matrix.md).
The completed naming/data cutover and rollback boundary are recorded in [rename migration](docs/rename-migration.md).

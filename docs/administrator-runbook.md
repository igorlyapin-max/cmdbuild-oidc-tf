# Administrator runbook

## 1. ZITADEL configuration

Use the existing ZITADEL Console at the URL in [entry points](entrypoints.md). Do not modify production identity objects; name every POC object with `cmdbuild-oidc-tf-`.

1. In project `cmdbuild-oidc-tf`, create roles `admin`, `editor`, `reader`; create `cmdbuild-oidc-tf-admin`, `cmdbuild-oidc-tf-editor`, `cmdbuild-oidc-tf-reader`, then assign each exactly one matching role. Keep passwords only in the operator secret store.
2. The existing OpenWebUI OIDC application belongs to the ZITADEL project `OpenWebUI`, not `cmdbuild-oidc-tf`. Create only the new roles `cmdbuild_oidc_tf_admin`, `cmdbuild_oidc_tf_editor`, `cmdbuild_oidc_tf_reader` there and assign them only to the three `cmdbuild-oidc-tf-*` users. Enable **Return user roles during authentication** for that project and **User roles inside ID Token** in the application token settings. This project boundary matters: the Action maps those namespaced project roles back to the plain `admin`, `editor`, `reader` groups consumed by OpenWebUI and MCP.
3. Create Action `cmdbuild_oidc_tf_flat_groups` and attach it to **Complement Token** triggers **Pre Userinfo creation** and **Pre access token creation**. The claim name must not contain dots because OpenWebUI treats a group claim as a dot path:

   ```javascript
   function cmdbuild_oidc_tf_flat_groups(ctx, api) {
     const user = ctx.v1.getUser();
     const cmdbuildUsername = user && (user.preferredLoginName || user.username);
     if (typeof cmdbuildUsername === 'string' && cmdbuildUsername.length > 0) {
       api.v1.claims.setClaim('cmdbuild_username', cmdbuildUsername);
     }
     if (ctx.v1.user.grants === undefined || ctx.v1.user.grants.count === 0) return;
     const groups = [];
     ctx.v1.user.grants.grants.forEach((grant) => grant.roles.forEach((role) => {
       groups.push(role.match(/^cmdbuild_oidc_tf_(admin|editor|reader)$/)?.[1] ?? role);
     }));
     api.v1.claims.setClaim('cmdbuild_oidc_tf_groups', [...new Set(groups)]);
   }
   ```

   ZITADEL permits one Action per trigger in this tenant. During cutover, replace the action assigned to both trigger slots; do not leave the former Action emitting the old claim as a compatibility path. Verify both rows name `cmdbuild_oidc_tf_flat_groups` before treating group sync as passed.

4. OpenWebUI's existing client is configured for SSO-only login and these environment values:

   ```text
   ENABLE_OAUTH_ROLE_MANAGEMENT=true
   OAUTH_ROLES_CLAIM=cmdbuild_oidc_tf_groups
   OAUTH_ALLOWED_ROLES=reader,editor,admin
   OAUTH_ADMIN_ROLES=admin
   ENABLE_OAUTH_GROUP_MANAGEMENT=true
   ENABLE_OAUTH_GROUP_CREATION=true
   OAUTH_GROUPS_CLAIM=cmdbuild_oidc_tf_groups
   OAUTH_GROUP_DEFAULT_SHARE=members
   ENABLE_LOGIN_FORM=false
   ENABLE_PASSWORD_AUTH=false
   ```

   `admin` maps to OpenWebUI system `admin`; `editor` and `reader` map to system `user` plus same-named JIT groups. Configure group permissions and resource ACLs in OpenWebUI Admin Panel. Permissions are additive; do not use a permissive group as a deny mechanism.
5. Set a stable, secret-mounted `WEBUI_SECRET_KEY` before using OAuth-protected MCP tools. It encrypts OpenWebUI OAuth sessions and OAuth client data. The first introduction of this key requires clearing stale `oauth_session` cache records and makes users sign in again; it does not delete users, chats, tools, or settings.
6. Create Web application `cmdbuild-oidc-tf-bff`, authorization-code flow with PKCE, redirect URI `http://192.168.202.35:18086/oauth/callback`, and allowed origin `http://192.168.202.35:18086`. Put its ID in `BFF_CLIENT_ID` and `BFF_OIDC_AUDIENCE`. The POC uses a public PKCE client; a confidential replacement stores its secret only in `secrets/bff_client_secret`.
7. For ZITADEL JWT access tokens, leave `OIDC_USERINFO_URL` pointed at the issuer. The gateway first verifies signature, issuer and audience locally, then reads the same subject's standard project-role assertion from UserInfo only when the verified access-token payload has no roles.

Verify the claim from a non-production token without printing the token itself:

```bash
node scripts/inspect-token-claims.mjs < /path/to/operator-controlled-access-token
```

Expected output has the standard ZITADEL project role for exactly one of `admin`, `editor`, `reader` and shows no raw token.

## 2. CMDBuild POC bootstrap and OIDC assessment

1. Start the isolated stack and wait for CMDBuild health.
   If `/cmdbuild/services/rest/v3/boot/status` reports `WAITING_FOR_PATCH_MANAGER`, run the maintenance-only `cmdbuild-db-patch` command from the README while the application container is stopped.
2. Use only the local UI URL from [entry points](entrypoints.md). Create a disposable demo class/card or select an existing harmless imported demo card.
3. Configure `.env` with its exact `CMDBUILD_DEMO_CLASS`, `CMDBUILD_DEMO_CARD_ID`, and an intentionally small `CMDBUILD_WRITABLE_ATTRIBUTES` allowlist. Restart the gateway.
4. Start the edge, provision the dedicated confidential CMDBuild client, mount its two local secret files, then configure the isolated CMDBuild module. The commands do not print the client secret:

   ```bash
   docker compose --env-file .env -f compose.yml up -d oidc-edge
   node scripts/provision-zitadel-cmdbuild-oidc-tf-cmdbuild-client.mjs
   docker compose --env-file .env -f compose.yml up -d --force-recreate cmdbuild
   scripts/configure-cmdbuild-zitadel-oauth.sh
   ```

   The client callback is `http://127.0.0.1:18090/cmdbuild/oauth2/callback`. CMDBuild `OP_CUSTOM` expects `/auth`, `/token`, and `/userinfo` below one base URL, so `cmdbuild-oidc-tf-edge` provides `/cmdbuild-oidc` as an endpoint compatibility adapter. It does **not** proxy CMDBuild REST, BFF, or custom pages.
5. Run `node scripts/e2e-cmdbuild-reader-oidc.mjs`. A pass requires `cmdbuild_ui_authenticated`, the expected mapped username, and a CMDBuild role. Current result is negative: the UI shell returns but the CMDBuild current-session request is HTTP `400`; mapping is not proven.
6. The stock-image result is retained as baseline evidence only. The current experiment uses the local `4.2.0-bearer.1` fork documented in [CMDBuild Bearer resource-server fork](cmdbuild-bearer-fork.md). Set its `CMDBUILD_BEARER_*` values, build the image, recreate `log-collector` and `cmdbuild`, then wait for an authenticated CMDBuild REST request to return HTTP `200` before running `scripts/configure-cmdbuild-bearer-auth.sh`; Tomcat's healthcheck becomes ready earlier than the webapp.
7. Before direct forwarding, bootstrap the explicit disposable local mapping with a secret-mounted administrator password. This is the sole administrative bootstrap path; BFF/MCP never uses it:

   ```bash
   CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/run/secrets/cmdbuild_bootstrap_password \
     scripts/provision-cmdbuild-bearer-reader.sh
   ```

   The script creates or reuses `McpReader` without data privileges and active `cmdbuild-oidc-tf-reader` with that default group. Its generated local password is intentionally unrecoverable and must not be used as a fallback.
8. The Direct BFF identity row currently passes: `/api/cmdbuild/whoami` returns HTTP `200` with `cmdbuild-oidc-tf-reader`. It does not permit a Basic, session-cookie, service-account, generic-proxy, token-exchange, or automatic-provisioning fallback. Browser CMDBuild OIDC mapping and the reader/editor CMDBuild grant rows are still incomplete; run [the fork validation contract](cmdbuild-bearer-fork.md#validation-contract) before changing the custom-page architecture.

## 3. Register MCP in OpenWebUI

1. Provision a dedicated ZITADEL Web client for this MCP resource. Copy the exact browser callback URI offered by OpenWebUI into that client; use a static client id/secret in the next step. Do not reuse the OpenWebUI SSO client.
2. Sign in as `cmdbuild-oidc-tf-admin` through OIDC. In **Admin Settings → External Tools**, add MCP (Streamable HTTP) server `http://192.168.202.35:8085/mcp`.
3. Select **OAuth 2.1 (Static)**, enter the MCP client data, set OAuth Server URL to `http://192.168.202.35:8084`, register the client, then save. The gateway supplies protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`; retain automatic resource handling unless ZITADEL rejects it.
4. Each user enables the OAuth tool manually from the chat integrations menu and completes browser authorization. Do not set OAuth MCP tools as default/pre-enabled: first-use requires an interactive redirect.
5. Run `cmdbuild_whoami`, then `cmdbuild_read_demo_cards`. Only `cmdbuild-oidc-tf-editor` and `cmdbuild-oidc-tf-admin` may call `cmdbuild_update_demo_card`. The native OpenWebUI registration remains a pending acceptance step; the gateway policy has been tested through the BFF client.

OpenWebUI's native remote MCP OAuth connection may obtain a new ZITADEL access token for the already signed-in person; it is not safe to assume the application SSO token is reused byte-for-byte. The proof required here is the accepted gateway token plus the same caller identity returned by CMDBuild `sessions/current` after forwarding.

## 4. Direct BFF analogue

Open `http://192.168.202.35:18086`, choose **Sign in with ZITADEL**, then **Test CMDBuild API**. The BFF keeps the access token server-side and sends it unchanged to CMDBuild. It has no reverse proxy; that condition reproduces the custom-page deployment shape without modifying `cmdbcustompages`.

## 5. Operations

```bash
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs --tail=200 mcp-gateway cmdb-oidc-bff log-collector
docker compose --env-file .env -f compose.yml restart mcp-gateway cmdb-oidc-bff
```

The collector persists redacted JSONL in named volume `cmdbuild-oidc-tf_logs`. `stdout` remains the primary stream. Keep `DIAGNOSTIC_LEVEL=basic`; `verbose` is temporary and must not be used to capture tokens, passwords, cookies, or authorization headers.

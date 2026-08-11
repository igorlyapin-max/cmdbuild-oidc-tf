# Administrator runbook

This runbook is for the isolated `cmdbuild-oidc-tf` POC. It has no production
credentials or fallback authentication paths.

## ZITADEL

1. In project `cmdbuild-oidc-tf`, create roles `admin`, `editor`, `reader`.
   Assign reader/editor test users exactly one matching role. Local CMDBuild
   usernames are the immutable ZITADEL user IDs (`sub`), not login names.
2. For the negative authorization check, create an `unassigned` role and a
   disposable user with only that role. It is intentionally not accepted by
   BFF/MCP policy.
3. Attach `cmdbuild_oidc_tf_flat_groups` to **Complement Token → Pre Userinfo
   creation** and **Pre access token creation**. It must emit groups only from
   the exact `cmdbuild-oidc-tf` project; roles from any other ZITADEL project
   are ignored:

   ```javascript
   function cmdbuild_oidc_tf_flat_groups(ctx, api) {
     if (ctx.v1.user.grants === undefined || ctx.v1.user.grants.count === 0) return;
     const groups = [];
     ctx.v1.user.grants.grants.forEach((grant) => {
       if (grant.projectId !== '<cmdbuild-oidc-tf-project-id>') return;
       grant.roles.forEach((role) => {
         const mapped = role.match(/^cmdbuild_oidc_tf_(admin|editor|reader)$/)?.[1];
         if (mapped) groups.push(mapped);
       });
     });
     api.v1.claims.setClaim('cmdbuild_oidc_tf_groups', [...new Set(groups)]);
   }
   ```

   Do not emit or map a mutable username claim. ZITADEL supplies the standard
   `sub` claim.
4. The BFF is a public PKCE client with callback
   `http://192.168.202.35:18086/oauth/callback`. The CMDBuild confidential
   client callback is
   `http://192.168.202.35:18090/cmdbuild/oauth2/callback`. These are internal
   HTTP POC values only.
5. Create a separate project resource and use its ID as both
   `CMDBUILD_RESOURCE_PROJECT_ID` and `CMDBUILD_RESOURCE_AUDIENCE`. It is
   requested by the BFF and native MCP public clients through
   `urn:zitadel:iam:org:project:id:<resource-project-id>:aud`; do not reuse a
   BFF, browser, or MCP client ID.
6. The native MCP client is a dedicated public PKCE client. Configure it in
   OpenWebUI using `scripts/configure-openwebui-native-mcp.mjs`; do not edit
   its encrypted configuration database directly. The script replaces the
   complete canonical connection and deletes only that connection's stale OAuth
   sessions, so affected POC users must authorize it again.

## CMDBuild

1. Set `CMDBUILD_BIND_HOST` and `CMDBUILD_BASE_URL` to the same approved
   internal address. `CMDBUILD_BASE_URL` must not stay loopback because BFF and
   gateway use host networking.
2. Set `CMDBUILD_BEARER_USER_CLAIM=sub`; set the configured Bearer audience
   equal to the dedicated resource-project ID requested by forwarded access
   tokens. An ID token for a client does not satisfy this contract.
3. Provision explicit disposable local reader/editor users and grants. This is
   the only admin-bootstrap path; BFF and MCP never use its password.

   ```bash
   CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
     scripts/provision-cmdbuild-poc-grants.sh
   ```

4. Reconcile the ZITADEL clients, resource audience, callback and CMDBuild
   OAuth module. Commands
   never print the secret.

   ```bash
   scripts/prepare-runtime.sh
   CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
     scripts/capture-cmdbuild-oauth-rollback.sh
   node scripts/create-zitadel-cmdbuild-oidc-tf-resource-project.mjs
   scripts/configure-resource-audience.sh
   node scripts/update-zitadel-cmdbuild-oidc-tf-flat-groups-action.mjs
   node scripts/provision-zitadel-cmdbuild-oidc-tf-cmdbuild-client.mjs
   node scripts/provision-zitadel-cmdbuild-oidc-tf-native-mcp-client.mjs
   node scripts/configure-zitadel-cmdbuild-oidc-tf-native-mcp-token-settings.mjs
   node scripts/configure-openwebui-native-mcp.mjs
   node scripts/configure-zitadel-cmdbuild-oidc-tf-cmdbuild-redirects.mjs
   scripts/configure-cmdbuild-zitadel-oauth.sh
   scripts/configure-cmdbuild-bearer-auth.sh
   ```

5. Record a redacted OAuth/Bearer rollback snapshot before a configuration
   change:

   ```bash
   CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
     scripts/capture-cmdbuild-oauth-rollback.sh
   ```

   To return this POC to loopback browser OIDC, set the old callback as the
   desired URI and the current public internal URI as `CMDBUILD_LEGACY_*` for
   `configure-zitadel-cmdbuild-oidc-tf-cmdbuild-redirects.mjs`; then set
   `CMDBUILD_OIDC_LOGIN_ATTR=preferred_username`, restore the old local-user
   mapping intentionally, and rerun the two CMDBuild configuration scripts.

## Verification

```bash
node scripts/e2e-cmdbuild-reader-oidc.mjs reader
node scripts/e2e-cmdbuild-reader-oidc.mjs editor
node scripts/e2e-bff-cmdbuild-grants.mjs
node scripts/e2e-openwebui-native-mcp-oauth.mjs reader
node scripts/e2e-openwebui-native-mcp-oauth.mjs unassigned
node scripts/e2e-openwebui-native-mcp-cmdbuild.mjs reader
node scripts/e2e-openwebui-native-mcp-cmdbuild.mjs editor
node scripts/e2e-bff-cmdbuild-negative-auth.mjs unassigned
node scripts/e2e-bff-cmdbuild-negative-auth.mjs unmapped
scripts/e2e-resource-audience-boundary.sh
npm run smoke:mcp
```

`e2e-bff-cmdbuild-grants.mjs` performs the one bounded editor update/rollback;
set `BFF_POC_WRITE_ENABLED=true` only for that run, recreate BFF, then restore
it to `false` and recreate BFF again. Never leave it enabled.

## Operations

```bash
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs --tail=200 mcp-gateway cmdb-oidc-bff log-collector
```

Structured logs go to stdout and the redacted `log-collector`. Keep
`DIAGNOSTIC_LEVEL=basic` and CMDBuild Bearer diagnostics `off`; `verbose` is
temporary and must not record tokens, passwords, cookies or headers.

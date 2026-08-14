# Customer POC runbook: FAM, BFF, OpenWebUI MCP and CMDBuild API

Language: [English](customer-fam-poc-runbook.md) | [Русский](customer-fam-poc-runbook.ru.md)

This runbook prepares a controlled customer POC for two authenticated paths:

```text
Avanpost FAM/MFA+ -> UI -> BFF -> CMDBuild REST API
Avanpost FAM/MFA+ -> OpenWebUI -> native MCP -> CMDBuild REST API
```

FAM/MFA+ 1.17 is the only OIDC issuer. The native CMDBuild browser UI is not
part of this POC. Its FAM/SAML configuration, browser login and support model
are owned by the customer's CMDBuild and FAM administrators. Do not enable
CMDBuild `OP_CUSTOM`, deploy a FAM compatibility adapter, or use a successful
browser SAML login as evidence for the two API paths above.

## 1. Roles, values and hard boundaries

Complete this worksheet before changing an environment. Keep secrets in the
customer secret store; this document records identifiers and hashes only.

| Value | Owner | Required form |
| --- | --- | --- |
| `FAM_ISSUER` | FAM administrator | Exact HTTPS issuer URL from FAM discovery metadata. |
| `FAM_JWKS_URL` | FAM administrator | Exact HTTPS JWKS URL trusted by CMDBuild, BFF and MCP. |
| `CMDBUILD_RESOURCE_AUDIENCE` | FAM + CMDBuild administrators | One dedicated opaque audience string; never a client ID. |
| `BFF_REDIRECT_URI` | UI/BFF operator | Exact public HTTPS callback, no wildcard. |
| `OPENWEBUI_REDIRECT_URI` | OpenWebUI administrator | `https://<openwebui-fqdn>/oauth/clients/mcp:<server-id>/callback`. |
| `MCP_RESOURCE_URL` | MCP operator | Exact public HTTPS MCP protected-resource URL. |
| `CMDBUILD_BASE_URL` | CMDBuild administrator | Public HTTPS CMDBuild REST base URL. |
| `FAM_SUB` | FAM + CMDBuild administrators | Immutable, case-sensitive OIDC `sub`; local CMDBuild login has exactly this value. |

The patch accepts only RS256 JWT **access tokens** with the exact issuer,
audience and `sub`. It does not exchange tokens, create users, map groups to
CMDBuild grants, accept Basic authentication, service accounts or copied
CMDBuild browser cookies.

## 2. Pre-change and rollback

1. Name the change owner, rollback owner and POC window. Prepare four
   disposable FAM users: `reader`, `editor`, `unassigned`, and `unmapped`.
2. Record CMDBuild `4.2.0` version, current WAR/image digest, deployment mode,
   database-backup reference and current authentication configuration. Restore
   test the database backup using the customer's standard procedure.
3. Verify approved CA chains from CMDBuild, BFF, MCP and OpenWebUI to FAM.
   Do not disable certificate validation for a private CA.
4. Capture a redacted CMDBuild configuration snapshot before changing it:

   ```bash
   CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
     scripts/capture-cmdbuild-oauth-rollback.sh > cmdbuild-before.redacted.json
   ```

5. Keep a previous verified WAR/image digest and its rollback command ready.
   Stop the change if any artifact checksum, backup or TLS precondition is
   missing.

## 3. Apply the patch to an existing CMDBuild deployment

Build the artifact in approved CI, not on the production host. The repository
contains only source patch material; it intentionally does not carry the
vendor source archive, WAR or customer secrets.

```bash
npm run verify:cmdbuild-bearer-artifact
scripts/build-cmdbuild-bearer-war.sh
sha256sum -c artifacts/cmdbuild-4.2.0-bearer.1.war.sha256
```

### Tomcat / systemd

Stop the service, then perform the atomic WAR swap. The helper refuses to
replace a running service and preserves the previous WAR under `backup/`.

```bash
CMDBUILD_HOME=/opt/cmdbuild/tomcat/webapps \
CMDBUILD_SERVICE=cmdbuild \
CMDBUILD_PATCH_WAR=/secure/artifacts/cmdbuild-4.2.0-bearer.1.war \
CMDBUILD_PATCH_WAR_SHA256=/secure/artifacts/cmdbuild-4.2.0-bearer.1.war.sha256 \
  scripts/apply-existing-cmdbuild-patch.sh
systemctl start cmdbuild
```

Confirm the public health/readiness route and the deployed WAR checksum before
changing identity settings. To stage rollback, stop the service and run
`scripts/rollback-existing-cmdbuild-patch.sh` with the same `CMDBUILD_HOME`
and `CMDBUILD_SERVICE`, then start and verify the previous service.

### Container deployment

Promote only an approved immutable image digest with source SHA, patch SHA and
SBOM/attestation. Change only the CMDBuild image reference, recreate only the
CMDBuild workload and verify the observed digest. Preserve the existing
database and application volumes. On failure, restore the previous digest and
the redacted configuration snapshot; do not edit CMDBuild tables directly.

## 4. FAM/MFA+ 1.17 configuration

The FAM administrator creates two separate applications. In FAM open
`Администрирование -> 5.3 Управление приложениями`, select **Добавить
приложение**, then choose **OAuth/OpenID Connect**.

### 4.1 BFF application

In the wizard **Основные настройки -> Настройки интеграции -> Настройки
аутентификации -> Завершение**, configure:

| Field/tab | Value |
| --- | --- |
| `Наименование` | A distinct BFF application name. |
| `Redirect URIs` | Exact `BFF_REDIRECT_URI`. |
| `Публичный` | Enabled. |
| flow | Authorization Code with PKCE `S256`; no distributed client secret. |
| `Access token type` | `JSON Web Token`. |
| `JWT Signature Algorithm` | `RS256`. |
| `Audience` / `Audience type` | `CMDBUILD_RESOURCE_AUDIENCE` as a string audience. |
| `Scopes` | Minimum OIDC scopes plus the approved CMDBuild resource scope. |
| `Модель доступа` | Only the disposable POC users/groups. |

### 4.2 OpenWebUI native MCP application

Create a second public OIDC application with the same JWT/audience policy and
the exact `OPENWEBUI_REDIRECT_URI`. Do not reuse the BFF client. On its
**Scopes** tab, expose a flat approved group claim for `reader`/`editor` only
when OpenWebUI needs it for tool visibility. FAM `sub` remains the only local
CMDBuild identity mapping.

Before activating either app, open **Настройки**, **Scopes**, **Модель
доступа** and **Сертификаты**. Check HTTPS redirect URI, RS256 signing key,
JWT access-token type, resource audience, user access and stable `sub`. The
FAM administrator supplies discovery/JWKS URLs and validates a fresh access
token locally without copying it into a ticket or external decoder.

## 5. CMDBuild setup

The CMDBuild administrator signs in to the Administration Module.

1. In the security section, create `reader` and `editor` groups. Give reader
   only the approved CMDBuild read permissions; give editor the one bounded
   update permission needed by the POC. Do not grant administration rights.
2. Create active local users for the FAM `reader` and `editor` subjects. Set
   each local login exactly to the case-sensitive FAM `sub`; set one intended
   default group. Keep `unmapped` absent and `unassigned` without an accepted
   grant path.
3. Configure only the Bearer patch. Do not change the existing browser SAML
   settings or enable `default,oauth`/`OP_CUSTOM` for this POC.

For the repository Compose example, copy `.env.example` to a protected `.env`,
set the non-secret Bearer values below, then recreate only the CMDBuild
workload so those values exist in its process environment. Keep the password
outside `.env` in a root-readable secret file:

```bash
CMDBUILD_BEARER_ENABLED=true
CMDBUILD_BEARER_DEPLOYMENT_PROFILE=production
CMDBUILD_BEARER_ISSUER=<FAM_ISSUER>
CMDBUILD_BEARER_JWKS_URL=<FAM_JWKS_URL>
CMDBUILD_RESOURCE_AUDIENCE=<CMDBUILD_RESOURCE_AUDIENCE>
CMDBUILD_BEARER_AUDIENCE=<CMDBUILD_RESOURCE_AUDIENCE>
CMDBUILD_BEARER_DIAGNOSTIC_LEVEL=off
```

```bash
docker compose --env-file .env -f compose.yml up -d --force-recreate cmdbuild
CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
  scripts/configure-cmdbuild-bearer-auth.sh
```

The helper uses CMDBuild's authenticated REST v3 `system/config` API and a
temporary mode-`0600` netrc file inside the container; it does not print
credentials or JWTs. Confirm that diagnostic mode is `off` by default, enable
`basic` only for a temporary diagnosis, and keep the external HMAC-protected
audit sink ready.

## 6. UI/BFF configuration

The UI/BFF operator configures the FAM discovery issuer, public PKCE BFF
client ID, exact BFF callback, approved CA bundle and the dedicated resource
scope. The BFF must request a user access token and forward it unchanged only
to CMDBuild REST. It may reject an unassigned group before the CMDBuild call,
but CMDBuild local groups/grants make the final authorisation decision.

Do not configure a token exchange, a static CMDBuild password, a service
account, a copied CMDBuild session cookie or a generic REST proxy.

## 7. Move OpenWebUI to FAM OIDC and register MCP

The labels vary slightly by OpenWebUI release. Sign in as an OpenWebUI system
administrator and open **Admin Panel -> Settings -> Authentication**.

1. Enable OAuth/OIDC SSO and set FAM discovery/issuer URL, OIDC client ID,
   secret only if the selected confidential-client mode requires it, scopes and
   exact public OpenWebUI base URL. Prefer public Authorization Code + PKCE
   when the deployed OpenWebUI version supports it.
2. Save, sign out, then select **Continue with SSO** on the OpenWebUI login
   page. Confirm a disposable reader arrives back in OpenWebUI.
3. Open **Admin Panel -> Users and Groups -> Groups**. Create `reader` and
   `editor`; map or reconcile the approved FAM flat group claim. Verify that
   an `unassigned` user receives no tool grant.
4. Open **Admin Panel -> Settings -> External Tools** (also named **Tools** or
   **MCP Servers** in some releases). Click **Add Connection** and select
   `MCP` with `OAuth 2.1`.
5. Set the exact HTTPS `MCP_RESOURCE_URL`, stable server ID, OAuth discovery
   metadata, public FAM MCP client ID and the exact `OPENWEBUI_REDIRECT_URI`.
   Enable only `cmdbuild_whoami`, `cmdbuild_read_demo_cards` and the bounded
   update tool used in this POC. Grant tool visibility to OpenWebUI `reader`
   and `editor` groups; do not grant it globally.
6. Save the connection, then authorize it once separately as reader and
   editor. If issuer, client ID, callback or scope changes, delete only this
   MCP connection's stale OAuth sessions and re-authorize users.

Do not edit encrypted OpenWebUI OAuth-session/configuration records directly.

## 8. Evidence and decision

Use [customer FAM POC checklist](customer-fam-poc-checklist.md) in order.
Record date, artifact digest, CMDBuild version, endpoint, HTTP status, token
fingerprint, subject hash, mapped group and grant outcome only. Never record
tokens, cookies, passwords, client secrets, authorization codes or user data.

Declare `direct-user-api-pass` only when both BFF and OpenWebUI native MCP
paths prove the matching mapped CMDBuild identity and least-privilege grants.
Native CMDBuild UI SAML evidence is customer-owned and does not alter this
decision.

## References

- [FAM/MFA+ 1.17 OIDC applications](https://docs.avanpost.ru/fam/1.17/131139314.html)
- [FAM/MFA+ 1.17 claim-based authorisation](https://docs.avanpost.ru/fam/1.17/125569833.html)
- [CMDBuild Administration Module](https://www.cmdbuild.org/en/project/features/administration-module)

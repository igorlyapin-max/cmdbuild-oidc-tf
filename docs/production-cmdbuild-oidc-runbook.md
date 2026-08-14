# Verification reference: CMDBuild Bearer patch and OIDC

Language: [English](production-cmdbuild-oidc-runbook.md) | [Русский](production-cmdbuild-oidc-runbook.ru.md)

> Detailed technical reference retained from verification work. Customer
> operators follow the [customer deployment kit](customer/README.md); browser
> SSO material below is outside the delivered API scope.

This document describes the controlled deployment of the CMDBuild `4.2.0`
Bearer patch on an already deployed CMDBuild system and the OIDC configuration
needed for these paths:

```text
browser -> CMDBuild UI
UI -> BFF -> CMDBuild REST API
OpenWebUI -> native MCP -> CMDBuild REST API
```

It is a production change procedure, not evidence that a production change has
already passed. The isolated HTTP POC and its historical result are documented
separately in [CMDBuild OIDC discovery](cmdbuild-oidc-discovery.md).

## 1. Security model and hard gates

### 1.1 What the patch changes

The patch adds a JWT Bearer resource-server filter to CMDBuild `4.2.0`. It
verifies the access token, resolves its immutable `sub` to an existing active
CMDBuild user with a default group, creates a server-side request-lifetime
session, and applies ordinary CMDBuild grants. It does **not** provide a token
exchange or automatic user/group provisioning.

For one CMDBuild installation configure exactly one active IdP profile:
ZITADEL **or** Avanpost FAM/MFA+ `1.17`. Do not trust two issuers in the same
Bearer filter and do not use a login name or e-mail as the identity binding.

| Boundary | Required production rule |
| --- | --- |
| Identity | `sub` is an immutable string and is the CMDBuild local username. |
| API token | Only an OIDC **access token** with the dedicated CMDBuild resource audience is accepted. An ID token and any OIDC client ID are rejected. |
| Authorisation | BFF/MCP may make an early reader/editor decision, but CMDBuild groups and grants remain the final data-permission source. |
| Credentials | No CMDBuild REST Basic authentication, service account, copied `CMDBuild-Authorization` cookie, generic REST proxy, or token exchange. A confidential browser client secret is allowed only for the OAuth authorization-code exchange. |
| Transport | Public issuer, CMDBuild callbacks, BFF, OpenWebUI and MCP use approved HTTPS FQDNs and a trusted CA. HTTP POC addresses are not production values. |
| Diagnostics | Keep `DIAGNOSTIC_LEVEL=basic` and CMDBuild Bearer diagnostics `off`. Temporary `verbose` must stay redacted and be disabled after diagnosis. |
| Audit | Keep structured stdout plus the HMAC-protected audit sink available and ready. Do not put credentials, JWTs, cookies, authorisation codes, or user payloads into a ticket or a log. |

The change owner must stop the rollout and rollback when any of the following
is true: the previous WAR/image cannot be restored, the configuration snapshot
is missing, the access token does not contain the exact audience, `sub` does
not resolve to the intended local user, or a negative case is accepted.

### 1.2 Pre-change checklist

1. Approve a maintenance window, named change owner, rollback owner and
   user-visible smoke window.
2. Record the exact stock CMDBuild version, deployment mode, current WAR/image
   digest, service/container name, database backup reference and CMDBuild base
   URL. The patch applies only to the exact `4.2.0` vendor source baseline.
3. Make and restore-test a database backup using the site's normal CMDBuild
   procedure. The WAR swap is reversible; changes to local users, groups and
   OAuth configuration also need a separately approved restore procedure.
4. Capture a redacted before-state of the CMDBuild OAuth/Bearer parameters and
   the local users/groups/grants affected by the change. Never capture values
   of secrets or passwords. The isolated POC helper is an example:

   ```bash
   CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
     scripts/capture-cmdbuild-oauth-rollback.sh
   ```

5. Prepare at least four disposable validation identities: `reader`, `editor`,
   `unassigned`, and a valid IdP identity with no local CMDBuild mapping.
6. Verify the live TLS certificate chain from every component that consumes
   the IdP or CMDBuild endpoint. Do not weaken TLS verification for a private
   CA; distribute the approved CA instead.

## 2. Obtain and verify the patch artifact

The Git repository contains only the small source patch. It intentionally does
not contain the vendor archive, unpacked vendor source, a WAR, or a registry
image. The current repository also does not publish a customer-verifiable
registry artifact. An operations team must use one of the following controlled
delivery paths.

### 2.1 Reproducible build from this repository

Build in a protected CI/build environment, not on the production CMDBuild host.
The build verifies the official source SHA-256, the patch SHA-256 and the
pinned vendor base image before producing the WAR or image.

```bash
git checkout v00.00.00.02
scripts/build-cmdbuild-bearer-war.sh
sha256sum -c artifacts/cmdbuild-4.2.0-bearer.1.war.sha256
```

Promote the resulting `WAR` plus its checksum, or the image by immutable
digest, through the normal approval pipeline. Preserve the Git commit, source
SHA-256, patch SHA-256 and resulting artifact digest with the change record.
The image labels `org.opencontainers.image.source-sha256` and
`org.opencontainers.image.patch-sha256` are the required provenance check for
the container path.

### 2.2 Internal registry delivery

Accept an internal-registry artifact only when its immutable digest, signed
attestation/SBOM, source SHA-256 and patch SHA-256 match the approved build.
The registry tag alone is not an identity. The production change record must
contain both the newly approved digest and the previous digest used for
rollback.

## 3. Apply or roll back the patch

### 3.1 Tomcat / systemd WAR deployment

This path is implemented by `scripts/apply-existing-cmdbuild-patch.sh`. Run it
from the repository checkout so its default `artifacts/` path is unambiguous,
or set `CMDBUILD_PATCH_WAR` and `CMDBUILD_PATCH_WAR_SHA256` explicitly.

```bash
cd /secure/build/cmdbuild-oidc-tf
CMDBUILD_HOME=/opt/cmdbuild/tomcat/webapps \
CMDBUILD_SERVICE=cmdbuild \
CMDBUILD_PATCH_WAR=/secure/artifacts/cmdbuild-4.2.0-bearer.1.war \
CMDBUILD_PATCH_WAR_SHA256=/secure/artifacts/cmdbuild-4.2.0-bearer.1.war.sha256 \
  scripts/apply-existing-cmdbuild-patch.sh
```

The helper refuses to overwrite an active service, validates the checksum,
copies the prior `cmdbuild.war` into `backup/`, records that backup path, then
performs an atomic same-filesystem rename. Start the service only after the
replacement completes and perform the health/readiness smoke before modifying
OAuth or Bearer parameters.

To stage a WAR rollback, stop the service and run:

```bash
cd /secure/build/cmdbuild-oidc-tf
CMDBUILD_HOME=/opt/cmdbuild/tomcat/webapps \
CMDBUILD_SERVICE=cmdbuild \
  scripts/rollback-existing-cmdbuild-patch.sh
```

Then start the service, verify stock health, restore the redacted configuration
snapshot by the approved CMDBuild administration procedure, and run the
browser smoke. Do not delete the backup until the change is accepted.

### 3.2 Docker / Compose deployment

Use an immutable approved image digest; do not build from Internet on a
production host. Before changing Compose/Kubernetes deployment data, export
the current manifest, note the running image digest and back up the named
database volume or external database. Preserve the existing CMDBuild database
and application volumes: replacing the image must not create a new CMDBuild
instance.

1. Change only the CMDBuild image reference to the approved immutable digest.
2. Recreate only the CMDBuild workload using the normal orchestrator change
   procedure; wait for its health endpoint and confirm the observed digest.
3. If CMDBuild reports that its patch manager is waiting, run the vendor's
   approved maintenance/patch-manager job once while the application workload
   is stopped, then restart it. Do not manually alter CMDBuild database tables.
4. On failure, scale down/stop the patched workload, restore the previous
   digest and configuration, start it, and prove stock health before deciding
   whether a database restore is necessary.

The repository `compose.yml` remains an isolated POC example. Its `build:`
entry and host networking are not a production deployment manifest.

## 4. IdP-independent OIDC contract

Create three OIDC clients/apps plus one API resource audience. Their browser
redirect URIs must be exact HTTPS URLs; never use a wildcard, a loopback value,
or a POC IP address in production.

| Purpose | Client type | Required token behaviour |
| --- | --- | --- |
| CMDBuild browser login | Confidential web client | Authorization Code flow; its callback is `https://cmdb.example.org/cmdbuild/oauth2/callback`. |
| BFF | Public PKCE client | Requests the dedicated resource scope and forwards the current user's access token only. |
| OpenWebUI native MCP | Public PKCE client | Requests the same resource scope; OpenWebUI stores its OAuth client/session data encrypted. |
| CMDBuild REST resource | Resource/audience, not a client | Exact value in `aud` of BFF/MCP access tokens and in CMDBuild `org.cmdbuild.auth.bearer.audience`. |

For all consumers configure and verify:

| Value | Requirement |
| --- | --- |
| `iss` | Exact issuer URL, no trailing-path approximation. |
| JWKS | HTTPS key set for the issuer, with CA trust tested from CMDBuild, BFF and MCP. |
| JWS | `RS256` for this patch. Do not configure `none`, HMAC, or an algorithm that the patch does not allow. |
| `aud` | Exact dedicated CMDBuild resource audience. |
| `sub` | String, immutable and globally unique for that issuer; create a CMDBuild local user with precisely this value as login. |
| token type | JWT access token for the BFF/MCP API. Do not forward an ID token. |
| group claim | A flat, documented claim used by BFF/OpenWebUI only. It is not a replacement for CMDBuild grants. |

Changing issuer, JWKS, audience, callbacks, token format, resource scope or
local-user mapping is an authentication change. Capture a new snapshot and
rerun the entire validation matrix after every such change.

### CMDBuild `OP_CUSTOM` compatibility adapter

CMDBuild browser OAuth in this POC uses `OP_CUSTOM`, which calls an adapter at
`serviceUrl` with `/auth`, `/token` and `/userinfo`. The shipped
`compose/nginx-edge.conf.template` adapts those paths to **ZITADEL only**; it
does not make Avanpost FAM a tested CMDBuild browser IdP.

For an IdP other than ZITADEL, implement and security-review a separate,
allowlisted adapter that translates only these three browser-OAuth operations
to that IdP's documented endpoints. It must never proxy CMDBuild REST, BFF,
MCP, cookies or arbitrary upstream paths. Perform the browser and direct-API
matrix in a staging system before a FAM production cutover.

## 5. ZITADEL console example

Use this example only when ZITADEL is the selected issuer. Its current POC
scripts are source of truth for the POC object names; replace every address and
identifier with approved production values.

1. In **Projects**, create/choose the application project. In **Roles**, add
   `reader`, `editor` and a non-accepted `unassigned`; in **Role assignments**
   assign each validation user exactly one role. Roles and assignments belong
   to the project, not to a client.
2. Create a separate resource project for CMDBuild REST. Its project ID is the
   resource audience. BFF and native MCP request
   `urn:zitadel:iam:org:project:id:<resource-project-id>:aud`; do not put any
   application `client_id` in `CMDBUILD_RESOURCE_AUDIENCE`.
3. In **Actions**, create/update a Complement Token Action. Attach it to both
   **Pre Userinfo creation** and **Pre access token creation**. It must select
   roles only from the CMDBuild application project and emit only a flat claim,
   for example `cmdbuild_oidc_tf_groups=["reader"]`. Do not emit a mutable
   CMDBuild username claim.
4. In the project **Applications** area create:
   - a confidential Web application for CMDBuild browser callback;
   - public PKCE applications for BFF and native MCP.
   Register only their exact HTTPS redirect and post-logout URLs. Use PKCE for
   user-facing apps; retain the CMDBuild browser client secret only in the
   approved secret store.
5. Obtain a fresh reader access token through the normal authorization-code
   flow and inspect its metadata in an approved local tool: it must have the
   configured issuer, `sub`, `aud` resource project ID and the expected group
   claim. Do not upload a production token to an external decoder.

ZITADEL documents PKCE application registration and redirect-URI validation in
its [OIDC login guide](https://zitadel.com/docs/guides/integrate/login/oidc/login-users),
project role assignments in its [roles guide](https://zitadel.com/docs/guides/manage/console/roles),
and resource-audience/claim behaviour in [Retrieve User Roles](https://zitadel.com/docs/guides/integrate/retrieve-user-roles).

## 6. Avanpost FAM/MFA+ 1.17 console example

Use this example only when FAM/MFA+ `1.17` is the selected issuer. FAM acts as
the IdP for the applications in this section. Do **not** configure
`Управление источниками пользователей` / OIDC Federation unless FAM itself
must federate an upstream identity source; that is a separate design.

### 6.1 Create the three OIDC applications

In `Администрирование -> 5.3 Управление приложениями`, click **Добавить
приложение** and choose `OAuth/OpenID Connect`. FAM documents the wizard as
**Основные настройки -> Настройки интеграции -> Настройки аутентификации ->
Завершение**.

Create separate applications for CMDBuild browser, BFF and native MCP:

| Wizard/profile field | CMDBuild browser app | BFF and native MCP apps |
| --- | --- | --- |
| `Наименование` | Distinct CMDBuild browser client name | Distinct BFF / MCP client names |
| `Тип` | `OAuth/OpenID Connect` | `OAuth/OpenID Connect` |
| `Redirect URIs` | Exact CMDBuild HTTPS callback | Exact BFF callback or OpenWebUI OAuth callback |
| `Base URL` / logout URLs | CMDBuild public URL | Corresponding BFF/OpenWebUI public URL |
| `Публичный` | Off; secret stays server-side | On; use Authorization Code with PKCE and no distributed secret |
| `Audience` | Browser-client value only if FAM requires it | The exact dedicated CMDBuild REST resource audience |
| `Audience type` | Match the chosen value | `Строка` for one CMDBuild resource audience |
| `Access token type` | Use the approved app policy | `JSON Web Token` |
| `JWT Signature Algorithm` | `RS256` | `RS256` |
| authentication process | Approved MFA/SSO policy | Approved MFA/SSO policy |

Do not activate the application until redirect URIs, client classification,
access policy and token fields have been peer-reviewed. In the created app
profile use tabs **Настройки**, **Scopes**, **Модель доступа** and
**Сертификаты**. Add only the scopes/claims that the flow requires. Ensure
`sub` remains the stable FAM subject and configure the flat group claim on
**Scopes** only if BFF/OpenWebUI needs it.

FAM's official `1.17` documentation confirms the UI navigation, wizard,
`Redirect URIs`, `Audience`, public-client control, JWT access-token type,
`RS256`, scopes and access model in [Управление OpenID Connect-приложениями](https://docs.avanpost.ru/fam/1.17/131139314.html).
It also documents `sub` as the unique case-sensitive JWT subject and claims
configuration on the **Scopes** tab in its [claims based authorization guide](https://docs.avanpost.ru/fam/1.17/125569833.html).

### 6.2 FAM pre-production proof

Before connecting FAM to CMDBuild, use its discovery/JWKS and a locally
verified test application to prove that BFF/MCP receive an **access JWT** with
the exact resource audience, immutable `sub`, expected expiry and `RS256`
signature. If FAM cannot issue the same dedicated resource audience to both
public clients, stop: do not substitute their client IDs, accept an ID token,
or add token exchange. Resolve the resource/audience design with the FAM
administrator first.

The FAM `OP_CUSTOM` adapter and CMDBuild browser flow have not been exercised
by this repository's POC. They are `staging required`, not production-ready,
until the complete section 8 acceptance matrix passes.

## 7. CMDBuild administration interface

Use the Administration Module while logged in as a CMDBuild administrator.
CMDBuild officially places users, groups/roles and permissions in that module;
localisation can change the label, but the security objects are the same. Do
not use direct SQL for users, groups, grants or authentication configuration.

### 7.1 Users, groups and grants

1. In the Administration Module security area, create separate groups for
   `reader` and `editor`. Start with no grants.
2. Give `reader` only read access to the allowlisted classes, views, reports
   and attributes. Deny create/update/delete and unrelated menus/processes.
3. Give `editor` only the minimum create/update access needed for the approved
   bounded write. Do not grant administration permissions.
4. Create an active local user for each approved IdP subject. Set the local
   username/login to the exact case-sensitive `sub` value, associate its one
   intended default group, and create no local password path for BFF/MCP use.
5. Create no local user/default group for the `unassigned` validation identity
   and one separately for the unmapped-user negative test. Verify that a user
   cannot inherit an unexpected group through a default setting.
6. Save, log out and review the effective group permissions with a second
   administrator before enabling external authentication.

CMDBuild's Administration Module is the supported area for security objects;
permissions are assigned to groups and users inherit them. See the official
[Administration Module overview](https://www.cmdbuild.org/en/project/features/administration-module)
and [user profiling description](https://www.cmdbuild.org/en/project/features/user-profiling-and-multitenant).

### 7.2 OAuth and Bearer configuration

The exact location of authentication parameter fields varies between CMDBuild
4.2 packages and localisations. First use the Administration Module to inspect
the active authentication methods and parameters. Record the before-state. The
following is the required value mapping; apply it through the authenticated
CMDBuild REST v3 `system/config` API used by
`scripts/configure-cmdbuild-bearer-auth.sh`, not by direct database editing.

| Purpose | Configuration key | Required value |
| --- | --- | --- |
| browser modules | `org.cmdbuild.auth.modules` | `default,oauth` only after approved browser cutover |
| browser protocol | `org.cmdbuild.auth.module.oauth.protocol` | `OP_CUSTOM` |
| browser client | `org.cmdbuild.auth.module.oauth.clientId` / `clientSecret` | confidential CMDBuild browser app values from secret store |
| local mapping | `org.cmdbuild.auth.module.oauth.login.attr` | `sub` |
| browser callback | `org.cmdbuild.auth.module.oauth.redirectUrl` | exact public CMDBuild callback |
| adapter | `org.cmdbuild.auth.module.oauth.serviceUrl` | reviewed allowlisted IdP compatibility-adapter URL |
| browser scope | `org.cmdbuild.auth.module.oauth.scope` | minimum browser scopes, normally `openid profile email` |
| enable Bearer | `org.cmdbuild.auth.bearer.enabled` | `true` only after prechecks |
| issuer/JWKS | `org.cmdbuild.auth.bearer.issuer` / `jwksUrl` | exact selected IdP HTTPS issuer/JWKS |
| API audience | `org.cmdbuild.auth.bearer.audience` | exact dedicated CMDBuild resource audience |
| API local mapping | fixed by the patch | immutable JWT `sub`; no configurable claim fallback |
| JWS policy | `org.cmdbuild.auth.bearer.allowedJwsAlgorithm` | `RS256` |
| deployment transport | `org.cmdbuild.auth.bearer.deploymentProfile` | `production`; requires HTTPS issuer/JWKS with no query, fragment or userinfo |
| time policy | `org.cmdbuild.auth.bearer.clockSkewSeconds` | approved bounded value; POC baseline is `30` |
| audit | `auditSinkUrl`, `auditSinkHmacKeyFile`, `diagnosticLevel` | approved internal sink, readable HMAC-key file, `off` normal diagnostics |

For the isolated Compose POC the following two scripts write that table's
parameters without printing secret values:

```bash
scripts/configure-cmdbuild-zitadel-oauth.sh
scripts/configure-cmdbuild-bearer-auth.sh
```

They are not a production FAM deployment script. For production apply the
same reviewed values through the site's CMDBuild administration method, reload
configuration, and record only the configuration hashes/flags in the change
evidence. The stock `4.2.0` CMDBuild WAR has no Bearer configuration keys;
configure them only after the patch version is healthy.

## 8. Acceptance and rollback decision

Run the complete matrix through the real public HTTPS routes. Record only date,
artifact digest, CMDBuild version, enabled modules, endpoint, HTTP status,
subject hash, token fingerprint, local role and grant decision.

| Scenario | Expected result |
| --- | --- |
| CMDBuild browser reader/editor | OIDC login reaches UI; `sessions/current` is the matching mapped local user and expected group. |
| BFF reader | `sessions/current` and allowlisted read are `200`; bounded write is denied and leaves no change. |
| BFF editor | bounded update, readback and rollback succeed with editor's CMDBuild grant. |
| native MCP reader/editor | same identity and grant outcomes as BFF, through OpenWebUI OAuth. |
| invalid/malformed/expired token | `401`, no CMDBuild operation. |
| wrong audience | `401`, no CMDBuild operation. |
| `unassigned` group | `403` before CMDBuild and no mutation. |
| valid but unmapped `sub` | `401`, no mutation. |
| audit readiness | stdout and external redacted audit sink receive no credential-bearing data; readiness is healthy. |

Declare `direct-user-api-pass` only when every applicable row passes on the
patched production-equivalent deployment. Browser success alone is
`session-only` evidence, not approval to remove a browser-session reverse
proxy. If any row fails, restore the prior WAR/image and configuration using
section 3, then document the redacted failure reason. Legacy compatibility is
not planned for this scope.

## References

- [CMDBuild 4.2 manuals](https://www.cmdbuild.org/en/documentation/manuals/manuals)
- [CMDBuild technical OAuth configuration reference](https://www.cmdbuild.org/file/manuali/technical-manual-in-english)
- [ZITADEL OIDC Authorization Code + PKCE](https://zitadel.com/docs/guides/integrate/login/oidc/login-users)
- [ZITADEL roles and role assignments](https://zitadel.com/docs/guides/manage/console/roles)
- [Avanpost FAM/MFA+ 1.17 OIDC applications](https://docs.avanpost.ru/fam/1.17/131139314.html)
- [Avanpost FAM/MFA+ 1.17 claims based authorization](https://docs.avanpost.ru/fam/1.17/125569833.html)

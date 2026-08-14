# Configure CMDBuild, IdP and applications

Language: [English](configuration.md) | [Русский](configuration.ru.md)

## 1. Common OIDC contract

Select exactly one issuer per CMDBuild deployment: ZITADEL or FAM/MFA+ 1.17.
Both BFF and native MCP must receive an RS256 JWT **access token** with exact
HTTPS `iss`, reachable HTTPS JWKS, a dedicated CMDBuild resource audience and
immutable case-sensitive `sub`. The audience is not an OIDC client ID. Do not
forward an ID token or introduce token exchange, Basic authentication, a
service account, copied CMDBuild cookies or a generic REST proxy.

Create separate public Authorization Code + PKCE clients for BFF and native
MCP. Register exact HTTPS callback URLs and a common resource scope/audience.
A flat reader/editor claim may drive BFF/OpenWebUI visibility; it never grants
CMDBuild access.

## 2. CMDBuild Administration Module

Sign in as a CMDBuild administrator. In the security area create `reader` and
`editor` groups, then assign only the required class/view/report/attribute
grants: reader is read-only; editor has only the approved bounded write. For
every approved IdP subject create an active local user whose login is exactly
the case-sensitive `sub`, with one intended default group. Leave the
unassigned and unmapped validation subjects without an accepted grant path.
Do not use direct SQL.

After the patched service is healthy, set the Bearer parameters through the
Administration Module's authentication/configuration area or the authenticated
REST v3 `system/config` procedure:

| Key | Required value |
| --- | --- |
| `org.cmdbuild.auth.bearer.enabled` | `true` after prechecks |
| `org.cmdbuild.auth.bearer.issuer` / `jwksUrl` | exact selected IdP HTTPS issuer/JWKS |
| `org.cmdbuild.auth.bearer.audience` | dedicated resource audience |
| local identity | fixed immutable JWT `sub` |
| `org.cmdbuild.auth.bearer.allowedJwsAlgorithm` | `RS256` |
| `org.cmdbuild.auth.bearer.deploymentProfile` | `production` |
| `org.cmdbuild.auth.bearer.clockSkewSeconds` | approved bounded value |
| audit parameters | approved sink, readable HMAC-key file, diagnostics `off` |

For the repository Compose contour, put non-secret values in protected `.env`,
keep the administrator password in a mode-`0600` external file, then run:

```bash
CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
  scripts/configure-cmdbuild-bearer-auth.sh
```

The helper reloads CMDBuild configuration without printing the password or a
JWT. In a customer topology use the same keys through the site's approved
administration method; do not run the POC Compose helper against another host.

## 3. FAM/MFA+ 1.17

Open `Администрирование -> 5.3 Управление приложениями -> Добавить приложение
-> OAuth/OpenID Connect`. Create two applications: BFF and OpenWebUI native
MCP. In the wizard **Основные настройки -> Настройки интеграции -> Настройки
аутентификации -> Завершение**, set a distinct name, exact callback, public
client, Authorization Code + PKCE `S256`, `JSON Web Token`, `RS256`, and the
dedicated CMDBuild resource audience with `Audience type=Строка`.

In **Настройки**, **Scopes**, **Модель доступа**, **Сертификаты**, verify stable
`sub`, minimal scopes, approved users/groups, signing key and discovery/JWKS.
Configure a flat group claim only if BFF/OpenWebUI consumes it. Do not configure
FAM federation merely to create these applications.

## 4. ZITADEL

In **Projects**, create an application project with `reader`, `editor` and
non-accepted `unassigned` roles. Create a separate resource project; its ID is
the CMDBuild audience. In **Actions**, attach a Complement Token Action to
**Pre Userinfo creation** and **Pre access token creation**; it must emit a
flat claim only from the application project. In **Applications**, create
separate public PKCE apps for BFF and native MCP. Each requests
`urn:zitadel:iam:org:project:id:<resource-project-id>:aud` and uses exact
HTTPS redirect URLs.

## 5. UI+BFF and OpenWebUI

Configure UI+BFF with the selected issuer discovery URL, public PKCE BFF
client ID, exact callback, trusted CA bundle and the resource scope. It must
forward the current user access token unchanged only to CMDBuild REST.

In OpenWebUI, open **Admin Panel -> Settings -> Authentication** and configure
the selected OIDC issuer/client/scopes/base URL. After SSO works, open
**Admin Panel -> Users and Groups -> Groups** and map/reconcile `reader` and
`editor`. Then open **External Tools** (or **Tools/MCP Servers**) -> **Add
Connection**, choose `MCP` with `OAuth 2.1`, set the exact protected-resource
URL, discovery metadata, native-MCP client and callback. Grant only the
allowlisted CMDBuild tools to `reader` and `editor`; do not grant them globally.

Continue with [acceptance](acceptance.md).

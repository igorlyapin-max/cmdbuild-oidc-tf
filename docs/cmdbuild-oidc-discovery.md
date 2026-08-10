# CMDBuild OIDC discovery protocol

The POC does not assume that CMDBuild 4.2 accepts a ZITADEL bearer token merely because browser OIDC is enabled. Browser login, CMDBuild internal user mapping, and REST bearer-token validation are separate facts to prove.

The POC Postgres service intentionally does **not** pre-create `cmdbuild_oidc_tf`: CMDBuild's `dbconfig create` owns database creation and demo-dump import. Pre-creating it leaves only bootstrap tables and makes patching fail.

## Required evidence

| Check | Expected evidence | Failure interpretation |
|---|---|---|
| Browser OIDC | Login reaches CMDBuild UI and returns a mapped CMDBuild user | CMDBuild OIDC/module mapping is incomplete. |
| Gateway `cmdbuild_whoami` | HTTP 200 and CMDBuild current user equals the ZITADEL caller | Native user-token forwarding works. |
| Reader read | `cmdbuild_read_demo_cards` succeeds | Least-privilege read mapping works. |
| Reader write | Gateway returns `group_does_not_allow_write` before CMDBuild call | Gateway group policy works. |
| Editor write | Bounded demo update succeeds then read shows changed value | CMDBuild permits that user and write grant. |
| BFF `/api/cmdbuild/whoami` | Same caller returned through direct no-proxy BFF | Custom-page analogue works. |

## Observed result and fail-closed rule

The isolated stock CMDBuild `4.2.0` now has `default,oauth` with the `OP_CUSTOM` OAuth module configured as a confidential ZITADEL client. A small edge compatibility route maps only the module's `/auth`, `/token`, and `/userinfo` convention to ZITADEL's actual endpoints; it never proxies CMDBuild, BFF, or custom-page traffic.

The interactive `cmdbuild-oidc-tf-reader` flow still returns to the CMDBuild UI shell,
but a post-login CMDBuild `v4/sessions/current` request returns HTTP `400`; no
mapped local CMDBuild user or CMDBuild authorization/session value was
observed. Browser OAuth-module mapping is therefore not proven.

The separate source-backed local `4.2.0-bearer.1` fork changes only the REST
resource-server path. With the BFF's current ZITADEL reader access token,
`GET /cmdbuild/services/rest/v3/sessions/current` returns HTTP `200` and the
existing local CMDBuild user `cmdbuild-oidc-tf-reader`. The request uses neither Basic
credentials, a service account, copied cookies, token exchange, automatic
provisioning, nor a reverse proxy. The fork validates the JWT and maps the
configured `cmdbuild_username` claim to a local active user/default group;
normal CMDBuild RBAC then applies. It creates a server-side request session
only for the request lifecycle and deletes it before return; no session token
is sent to the BFF.

`401` and `403` are reported as `cmdbuild_rejected_forwarded_user_token`; other HTTP failures remain `cmdbuild_api_error`. Every outcome is fail-closed and must not be hidden by a local CMDBuild password, `CMDBuild-Authorization` cookie, or a service-account fallback.

For stock CMDBuild, and for any fork configuration that cannot validate a
ZITADEL access token, record:

- CMDBuild exact version and authentication module;
- endpoint and response status;
- access-token `iss`, `aud`, and custom-group presence as redacted metadata;
- whether a supported token-exchange/introspection configuration exists.

Only after that evidence exists may a separately approved architecture consider
an authorization bridge. Such a bridge is outside this POC.

## No-reverse-proxy decision

The CMDBuild OAuth login experiment and the direct BFF experiment have different acceptance conditions:

- `direct-user-api-pass`: browser OIDC succeeds, direct `sessions/current` with the BFF's current user token returns the matching mapped CMDBuild user, and CMDBuild grants pass reader/editor scenarios. Only this outcome permits a complete replacement of the CMDBuild session-proxy pattern.
- `session-only`: browser OIDC establishes a mapped CMDBuild session but the direct BFF cannot authenticate to CMDBuild REST as that user. A narrow same-origin reverse proxy remains necessary when a companion backend needs the CMDBuild session.
- `bearer-unsupported`: direct bearer authentication fails. Do not replace it with Basic credentials, a service account, copied session cookies, or a generic REST proxy.

The stock result is `bearer-unsupported`. The local fork has a **partial
direct-BFF pass**, while UI mapping remains incomplete; it is not
`session-only` and not yet the formal `direct-user-api-pass`. A direct
token-forwarding BFF is technically proven for the target custom-page analogue,
but do not remove a CMDBuild/session reverse proxy from a real deployment until
the complete protocol in
`.agents/skills/cmdbuild-oidc-no-proxy/references/verification-protocol.md`
passes. Store the redacted result in the matching `current-evidence.md`
reference and update this document and the validation matrix together.

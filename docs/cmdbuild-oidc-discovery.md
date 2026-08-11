# CMDBuild OIDC discovery protocol

The POC treats browser login, local CMDBuild mapping and REST Bearer
validation as separate facts. Browser OIDC alone is not evidence that a BFF or
MCP may call CMDBuild REST as the same person.

The POC Postgres service intentionally does **not** pre-create
`cmdbuild_oidc_tf`: CMDBuild's `dbconfig create` owns database creation and
demo-dump import. Pre-creating it leaves only bootstrap tables and makes
patching fail.

## Required evidence

| Check | Required result |
|---|---|
| Browser OIDC | Reader and editor reach CMDBuild UI, each has a mapped current session and only the matching CMDBuild role. |
| Direct BFF | `sessions/current` returns the same immutable OIDC `sub` that identifies the local CMDBuild user. |
| Native MCP | `cmdbuild_whoami` returns that same mapped identity. |
| Reader | Read succeeds; bounded write is denied before a CMDBuild mutation. |
| Editor | Bounded update, readback and rollback succeed. |
| Negative boundary | Missing/malformed/wrong-audience tokens and an unknown group fail closed; a valid subject without a local CMDBuild mapping is rejected. |

## Pre-hardening observed result and fail-closed rule

Before the P1/P2 resource-audience hardening, on 2026-08-11 the isolated local `4.2.0-bearer.1` fork reached
`direct-user-api-pass`. CMDBuild `default,oauth` with `OP_CUSTOM` maps the
standard immutable OIDC `sub` to explicit local users/default groups. Reader
and editor both completed browser authorization-code login to the internal POC
address, reached the UI, and received current-session `200` with their matching
CMDBuild role.

The same `sub` mapping is used by the direct Bearer filter. BFF and native
OpenWebUI MCP forward only the current user's JWT: reader current-user/read is
`200` and its bounded write is denied; editor update/readback/rollback passes.
There are no Basic credentials, service accounts, copied cookies, token
exchange, automatic provisioning or generic REST proxy in those paths. The
fork creates a server-side CMDBuild request session only for the request
lifecycle; its token never leaves CMDBuild.

The observed fail-closed boundaries are: missing/malformed Bearer `401`, valid
token against a deliberately unrelated audience `401`, valid `unassigned`
group `403` before CMDBuild, and valid reader without a local CMDBuild user
`401` without mutation. The ZITADEL Action emits only the flat group claim;
there is no mutable username-claim or legacy mapping fallback.

The isolated stock `4.2.0` image remains the `bearer-unsupported` baseline.
The small edge route translates only CMDBuild OAuth-module `/auth`, `/token`
and `/userinfo` conventions to ZITADEL; it never proxies CMDBuild REST, BFF,
MCP or custom-page traffic.

## No-reverse-proxy decision

Before the current resource-audience hardening, the isolated POC met
`direct-user-api-pass`: browser OIDC creates a mapped
CMDBuild session and direct user-token REST calls are authorized with normal
CMDBuild grants. A custom-page backend/BFF and native OpenWebUI MCP may use the
direct Bearer pattern. Rerun the full matrix, including the resource-audience
rejection/restore boundary, before carrying that conclusion forward.

This does not authorize a production cutover by itself. The POC callback uses
an internal HTTP address; production still requires a protected FQDN/TLS
callback, a perimeter review and a scoped migration of local CMDBuild users and
grants. Do not introduce Basic, a service account, copied cookies, token
exchange or a generic proxy as a compatibility fallback.

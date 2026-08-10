# Current evidence: CMDBuild OIDC without reverse proxy

## Status

`partial-pass` — the maintained local CMDBuild `4.2.0-bearer.1` fork accepts
the forwarded ZITADEL reader access token and maps it to the existing local
CMDBuild user. This is a pass for the **Direct BFF API** row only. It is not
the protocol outcome `direct-user-api-pass`: UI OIDC mapping, CMDBuild reader
read/editor-write grants, and native OpenWebUI MCP OAuth remain unverified.

The isolated stock CMDBuild `4.2.0` image remains the baseline
`bearer-unsupported` result.

## Configuration under test

| Date | CMDBuild | Authentication module | OIDC client | Endpoint compatibility |
|---|---|---|---|---|
| 2026-08-10 | stock 4.2.0 | `default,oauth`, `OP_CUSTOM` | confidential `idptest-cmdbuild` ZITADEL client | edge route maps only CMDBuild's `/auth`, `/token`, `/userinfo` convention; it does not proxy CMDBuild, BFF, or custom-page traffic |
| 2026-08-10 | local `4.2.0-bearer.1` fork | stock module unchanged plus enabled Bearer resource-server filter | `idptest-bff` ZITADEL JWT access token | direct BFF to CMDBuild REST; no reverse proxy, Basic, session cookie, service account, token exchange, or auto-provisioning |

## Redacted results

| Layer | Scenario | Result | Meaning |
|---|---|---|---|
| Browser OIDC | `idptest-reader` interactive authorization-code login returns to `http://127.0.0.1:18090/cmdbuild/ui/` | UI shell HTTP `200`; subsequent current-session call HTTP `400`; no CMDBuild authorization header or CMDBuild session cookie | Browser OAuth-module mapping is still not proven. |
| Direct BFF API, stock | Forward the authenticated reader's unchanged ZITADEL access token to `GET /cmdbuild/services/rest/v3/sessions/current` | HTTP `400` generic CMDBuild error | Stock CMDBuild does not accept the forwarded user bearer. |
| Direct BFF API, fork | Same endpoint with the same current-reader token | HTTP `200`; mapped local user `idptest-reader` | JWT validation, immutable claim mapping and local CMDBuild RBAC session creation work without a reverse proxy. |
| Invalid Bearer, fork | Malformed `Authorization: Bearer` | HTTP `401` | The fork fails closed before a CMDBuild operation. |
| Gateway group boundary | Reader attempts bounded MCP write | denied as `group_does_not_allow_write` before CMDBuild | Gateway remains fail-closed; no credential fallback exists. |
| Operational audit | valid and invalid fork requests | redacted `bearer.auth.accepted` / `bearer.auth.rejected` records in stdout and `log-collector` | No raw token, authorization header, password or cookie was emitted. |

## Architecture decision

The experiment proves that a custom-page **backend/BFF** can call CMDBuild REST
as the current ZITADEL user without a CMDBuild-session reverse proxy, when it
uses this fork and the direct Bearer contract. It does **not** prove that the
browser CMDBuild UI can drop its own OAuth/session topology, nor authorise a
change to the running `cmdbcustompages` deployment.

Do not label the target architecture `direct-user-api-pass` or remove the
existing production proxy pattern until the remaining protocol rows pass. In
particular, confirm least-privilege reader read, editor bounded write/read-back
and the native OpenWebUI-to-MCP identity path with the same CMDBuild identity.

The small `idp-test-edge` compatibility route is not a replacement for a
proxy pattern: it only translates CMDBuild OAuth-module endpoint paths to
ZITADEL endpoint paths. It never forwards CMDBuild REST, BFF, or custom-page
requests.

## Next safe experiment

Grant the disposable `McpReader` local CMDBuild group only the required demo
read privilege, then run reader read and reader denied-write. Create a separate
least-privilege editor mapping for the one allowlisted attribute and run the
write/read-back row. Do not introduce Basic credentials, service accounts,
copied cookies, token exchange, or a generic REST proxy.

# Current evidence: CMDBuild OIDC without reverse proxy

## Status

`direct-user-api-pass` for the isolated local POC on 2026-08-11. The local
CMDBuild `4.2.0-bearer.1` fork accepts current-user ZITADEL JWTs, while the
unmodified CMDBuild OAuth module creates browser sessions for the same immutable
OIDC `sub` mapping. Reader/editor browser, BFF and native OpenWebUI MCP paths
all pass. No Basic credential, service account, copied cookie, token exchange,
generic proxy or automatic provisioning participates in those paths.

This is POC evidence only. The internal HTTP address used here is not a
production browser-session deployment approval; a production cutover still
requires a protected FQDN/TLS perimeter and its own change review.

The isolated stock CMDBuild `4.2.0` image remains the baseline
`bearer-unsupported` result.

## Configuration under test

| Date | CMDBuild | OIDC and identity mapping | Endpoint compatibility |
|---|---|---|---|
| 2026-08-11 | local `4.2.0-bearer.1` fork | `default,oauth`, `OP_CUSTOM`; confidential CMDBuild client; browser and Bearer local usernames map directly to standard OIDC `sub` | the edge translates only CMDBuild OAuth-module `/auth`, `/token`, `/userinfo` conventions to ZITADEL; it never proxies CMDBuild REST, BFF, MCP, or custom-page traffic |

The `cmdbuild_oidc_tf_flat_groups` Action emits only the flat authorization
group claim. It no longer emits a mutable username claim; local CMDBuild users
are created explicitly from the OIDC subject.

## Redacted results

| Layer | Scenario | Result | Meaning |
|---|---|---|---|
| Browser OIDC | Reader and editor complete authorization-code login to `http://192.168.202.35:18090/cmdbuild/ui/` | UI `200`; current session `200`; expected local subject is mapped; one matching CMDBuild role is available | CMDBuild browser OIDC/session mapping is proven for both approved roles. |
| Direct BFF API | Reader current-user/read/write and editor current-user/update/readback/rollback | Reader `200`/`200`/`403`; editor operations `200`, followed by rollback | Current-user Bearer forwarding and CMDBuild RBAC work without a session reverse proxy. |
| Native OpenWebUI MCP | Each role completes native OAuth then invokes CMDBuild tools | Reader subject match/read pass and write denied; editor subject match/update/readback/rollback pass | Dedicated public PKCE client and MCP gateway preserve the caller's identity. |
| Missing or malformed credential | MCP request without credential; CMDBuild malformed Bearer | `401`; `401` | Both entry points fail closed before CMDBuild work. |
| Wrong audience | Valid native OpenWebUI token while gateway is briefly configured with an unrelated audience | `401`; after restoration the same current-client contract initializes with `200` | Audience validation is live and fail closed. |
| Unrecognized group | Valid POC user with only an `unassigned` project role | BFF `403`; CMDBuild call not attempted | Authorization boundary rejects an otherwise authenticated subject. |
| Missing CMDBuild mapping | Valid reader-role POC user intentionally has no local CMDBuild user/default group | BFF forwarded call `401`; no mutation | CMDBuild does not auto-provision or fall back to another local identity. |
| Operational audit | Accepted and rejected Bearer requests | redacted stdout records and `log-collector` records | No token, password, cookie, Authorization header, or raw subject is evidence output. |

## Architecture decision

The isolated POC meets `direct-user-api-pass`: a custom-page backend/BFF and
OpenWebUI native MCP may call CMDBuild REST as the current ZITADEL user without
a CMDBuild-session reverse proxy. CMDBuild's own browser UI also creates its
normal mapped session through OIDC. The compatibility edge remains an
OAuth-endpoint adapter only, not an application/API reverse proxy.

Do not apply this local HTTP topology to `cmdbcustompages` or production
directly. There is no legacy username-claim fallback in this POC.

# Validation matrix

## Completed baseline

| Item | Result | Evidence |
|---|---|---|
| TypeScript typecheck | pass | `npm run typecheck` |
| Group parser/policy unit tests | pass, 4 tests | `npm test` |
| Existing OpenWebUI health | pass | `http://127.0.0.1:13001/health` returned `200` before POC edge start |
| Existing ZITADEL readiness | pass | `http://127.0.0.1:18080/debug/healthz` returned `200` before POC edge start |
| Existing ZITADEL discovery | pass with configured Host | issuer is `http://192.168.202.35:8084` |
| Existing public `8083/8084` route | absent before POC edge start | no listener on either port; POC edge supplies routes |
| Isolated Compose syntax | pass | `docker compose --env-file .env -f compose.yml config --quiet` |

## 2026-08-10 naming and state cutover

| Item | Result | Evidence |
|---|---|---|
| Local workspace identity | pass | folder, package, Compose project, containers, images, network, volumes, cookies and local Memora profile use `cmdbuild-oidc-tf` / `cmdbuild_oidc_tf` |
| Logical database migration | pass | verified custom-format PostgreSQL dump restored into `cmdbuild_oidc_tf`; target has 214 non-system tables |
| Audit-log migration | pass | one redacted JSONL file copied into `cmdbuild-oidc-tf_logs`; old volume remains intact |
| New CMDBuild local mapping | pass | `CmdbOidcTfReader` and `cmdbuild-oidc-tf-reader` created without data privileges |
| New ZITADEL project/apps/users | pass | isolated project, BFF, CMDBuild client and three users created; secrets/state remain local and are not printed |
| Active ZITADEL group-claim trigger | pass | both `Complement Token` rows now use `cmdbuild_oidc_tf_flat_groups`; the old Action object is detached and retained only for rollback record |
| New user interactive validation | pending | newly provisioned users are blocked by required first-password change in the ZITADEL Login v2 page; do not mark BFF or OpenWebUI group sync as passed until that flow completes |

## Runtime evidence

| Check | Result | Evidence | Notes |
|---|---|---|---|
| ZITADEL flat group and CMDBuild mapping Action | pass | redacted reader flow reaches CMDBuild mapping claim; direct BFF API maps to `cmdbuild-oidc-tf-reader` | The Action is attached to `Complement Token`: `Pre Userinfo creation` and `Pre access token creation`; it reads the user with `ctx.v1.getUser()` for access-token creation. |
| OpenWebUI reader SSO and group sync | pass | Browser E2E: role `user`, OpenWebUI group `reader` | The current OpenWebUI OIDC application has `User roles inside ID Token` enabled. |
| OpenWebUI local authentication | disabled | `ENABLE_LOGIN_FORM=false`, `ENABLE_PASSWORD_AUTH=false` | SSO is the sole browser login path. |
| BFF reader login and group claim | pass | redacted `/api/oidc/authorization-summary` | Access token has no roles; UserInfo and ID token do. |
| MCP reader write | pass / denied as intended | HTTP `200`, MCP tool error `group_does_not_allow_write` | Denied before any CMDBuild write. |
| CMDBuild OAuth client and module | configured | ZITADEL confidential client; CMDBuild `default,oauth` / `OP_CUSTOM`; endpoint-only compatibility route | The route maps only OAuth-module endpoints; it is not a CMDBuild reverse proxy. |
| CMDBuild interactive OIDC mapping | negative result | Reader returns to UI shell, then `v4/sessions/current` is HTTP `400`; no mapped local CMDBuild user proven | This is not a successful browser SSO or `session-only` result. |
| Stock user-token forwarding into CMDBuild | negative baseline | BFF `v3/sessions/current` gets HTTP `400 generic error` from stock CMDBuild 4.2 | No Basic/session/service-account fallback was added. |
| Fork direct user-token forwarding into CMDBuild | pass for Direct BFF API | BFF `v3/sessions/current` HTTP `200`; mapped local user `cmdbuild-oidc-tf-reader` | Local `4.2.0-bearer.1` validates the forwarded ZITADEL JWT, maps only an existing local user/default group, then deletes its server-side request session before return. |
| Fork malformed Bearer | pass / denied as intended | HTTP `401`; redacted `signature_or_jwks_validation_failed` audit event | Fail closed before CMDBuild work; no raw credential logged. |
| Fork stdout and operational audit sink | pass | CMDBuild stdout plus redacted `log-collector` records for accepted and rejected Bearer requests | Diagnostic mode remains `off`; collector is the second operational delivery point. |
| Native OpenWebUI MCP OAuth registration | pending | administrator procedure is documented | Needs a separately provisioned static OAuth client and interactive per-user authorization. |

## CMDBuild no-reverse-proxy decision

| Outcome | Current status | Evidence required before changing architecture |
|---|---|---|
| `direct-user-api-pass` | not yet proven | Direct BFF `sessions/current` identity match passes in the fork; browser OIDC and reader/editor CMDBuild grant rows must also pass without session-cookie, Basic, or service-account fallback. |
| `session-only` | not proven | Browser OIDC must first establish a mapped CMDBuild session; direct user-token REST must then still fail. Retain a narrow same-origin proxy for that session pattern. |
| `bearer-unsupported` | stock baseline only | Stock `4.2.0` responds HTTP `400` to the forwarded reader token; the local fork has a Direct BFF API pass but is not a full architecture pass. |

The detailed protocol and the latest redacted record are in `.agents/skills/cmdbuild-oidc-no-proxy/references/`.

## Remaining acceptance cases

| User group | OpenWebUI login | MCP read | MCP demo write | CMDBuild identity result |
|---|---:|---:|---:|---|
| `admin` | configured; login regression check pending | pending | pending | CMDBuild grant matrix pending |
| `editor` | configured; login regression check pending | pending | gateway allows, then CMDBuild grant matrix pending | Direct bearer mapping needs separate local user/group. |
| `reader` | pass | CMDBuild read grant pending | denied at gateway | Direct `sessions/current` maps to `cmdbuild-oidc-tf-reader`; no CMDBuild read grant has been assigned yet. |
| no recognized group | denied | denied | denied | no CMDBuild call |

Record a row only with HTTP status and redacted structured log request/token fingerprints. Never attach a raw access token, password, cookie, or authorization header.

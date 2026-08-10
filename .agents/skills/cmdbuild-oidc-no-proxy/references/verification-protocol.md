# CMDBuild OIDC no-proxy verification protocol

## Preconditions and rollback

Use an isolated CMDBuild instance. Capture the current authentication-module configuration and the existing local-user/group mapping as redacted metadata before modification. Define how to restore the prior module list and redirect URL before enabling the OAuth module.

Do not alter the running `cmdbcustompages` deployment. Do not place a production CMDBuild password, access token, cookie, OAuth code, client secret, or raw API payload in any evidence file.

## Test sequence

| Layer | Scenario | Required evidence | Failure meaning |
|---|---|---|---|
| UI OIDC | Login through ZITADEL into CMDBuild UI | mapped CMDBuild username/subject hash and assigned role | OAuth module, callback, mapping, or grants are incomplete |
| Direct BFF API | BFF sends its current user's access token to `GET /cmdbuild/services/rest/v3/sessions/current` | HTTP 200 and CMDBuild user equals the ZITADEL subject mapping | browser login did not establish direct user API authentication |
| Reader | Read only an allowlisted demo object | allowed read plus least-privilege CMDBuild grant | mapping/grant mismatch |
| Reader write | Attempt bounded demo write | denied before or by CMDBuild, no change persists | least-privilege failure |
| Editor write | Update one allowlisted demo attribute, then read it | write and read both succeed under editor mapping | user-token API or editor grants are incomplete |
| Invalid token | Missing, expired, or wrong-audience token | 401/403, no CMDBuild call or mutation | token validation boundary failed if accepted |
| Unknown group | Valid token without recognised role | denied, no mutation | group policy/mapping boundary failed if accepted |

Run the native OpenWebUI-to-MCP path only after direct BFF API authentication succeeds. It must prove the identity observed by CMDBuild, not byte-for-byte reuse of the OpenWebUI SSO token.

## Outcome classification

| Outcome | Conditions | Architecture decision |
|---|---|---|
| `direct-user-api-pass` | UI OIDC, `sessions/current`, user identity, and least-privilege grants all pass with a forwarded user token | A direct BFF/custom page can replace the session-cookie reverse-proxy pattern. |
| `session-only` | UI OIDC passes but direct BFF bearer API does not | Keep a narrow same-origin reverse proxy when the backend must use the CMDBuild browser session. |
| `bearer-unsupported` | Direct bearer API rejects the token or no supported validation exists | Do not remove the reverse proxy on this basis. Do not add Basic, service-account, session-cookie, or generic-proxy fallback. |

## Evidence contract

For every row record date, CMDBuild version, enabled authentication module, endpoint, HTTP status, subject hash, token fingerprint, mapped CMDBuild role, and outcome. Never record the underlying identifier, credential, token, cookie, header, or card payload.

Update these sources together:

- `references/current-evidence.md` for the latest durable result;
- `docs/cmdbuild-oidc-discovery.md` for the human-readable protocol and conclusion;
- `docs/validation-matrix.md` for the role matrix.

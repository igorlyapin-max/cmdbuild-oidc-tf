---
name: cmdbuild-oidc-no-proxy
description: "Validate whether a CMDBuild custom page or BFF can use OIDC and call CMDBuild REST as the current user without a reverse proxy. Use when configuring CMDBuild OAuth/OIDC, testing direct user-token forwarding or SSO webservice authentication, deciding whether same-origin CMDBuild session forwarding is required, or recording a fail-closed result."
---

# CMDBuild OIDC Without Reverse Proxy

Use this procedure only against an isolated or otherwise approved CMDBuild instance. It distinguishes browser OIDC, local-user mapping, and REST authentication; success in one layer does not prove another.

## Workflow

1. Read `references/verification-protocol.md` before changing authentication configuration.
2. Preserve the pre-change CMDBuild authentication configuration as redacted evidence and define a rollback action.
3. Configure the CMDBuild OAuth module as a ZITADEL client. Map immutable `sub` to a local CMDBuild user and assign CMDBuild grants; do not derive permissions solely from an untrusted upstream group claim.
4. Prove browser OIDC independently: an interactive login reaches the CMDBuild UI and yields the expected local CMDBuild user.
5. Prove direct API separately through the external BFF: send only the authenticated person's access token to `sessions/current`, then run the allowed read/write role scenarios.
6. Run the required negative cases. Reject fallback to Basic credentials, a service account, a copied `CMDBuild-Authorization` cookie, or a generic REST proxy.
7. Classify the result and update both `references/current-evidence.md` and the project documentation named in the protocol.

## Decision

- `direct-user-api-pass`: CMDBuild accepts the forwarded user token, returns the mapped local user from `sessions/current`, and enforces that user's CMDBuild grants. A direct BFF/custom page does not need a reverse proxy for CMDBuild session propagation.
- `session-only`: browser OIDC works but the external BFF cannot authenticate to REST as the user. A same-origin reverse proxy remains required for the session-cookie pattern.
- `bearer-unsupported`: direct REST rejects the user token. Keep the failure fail-closed and record the exact version, module, endpoint, status, and redacted token metadata. Do not introduce a fallback.

## Evidence rules

- Record only outcome, HTTP status, CMDBuild version/authenticator, subject hash, token fingerprint, role, and grant decision.
- A successful CMDBuild UI login or an accepted MCP token alone is not acceptance evidence for removing a reverse proxy.
- Keep `references/current-evidence.md` aligned with `docs/cmdbuild-oidc-discovery.md` and `docs/validation-matrix.md`.

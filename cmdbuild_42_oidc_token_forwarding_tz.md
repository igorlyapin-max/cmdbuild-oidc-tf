# Technical specification: CMDBuild OIDC token forwarding

Language: [English](cmdbuild_42_oidc_token_forwarding_tz.md) | [Русский](cmdbuild_42_oidc_token_forwarding_tz.ru.md)

This is the English navigation version of the canonical Russian technical
specification. It preserves the scope and acceptance boundary; API paths,
environment variables, identifiers, command names and error strings remain
verbatim in the Russian source.

## Objective

Validate authorization of two application paths through OIDC without using a
CMDBuild service account, Basic fallback, copied CMDBuild browser session,
token exchange or a generic REST reverse proxy:

```text
UI -> BFF -> CMDBuild REST API
OpenWebUI -> native MCP -> CMDBuild REST API
```

The current POC uses ZITADEL; the customer FAM path uses only FAM OIDC for API
flows. Native CMDBuild browser UI and SAML are a separate administrator-owned
scope and are not acceptance evidence for BFF/MCP.

## Mandatory identity and authorization contract

- Forward only the current user's JWT **access token** to CMDBuild REST.
- Validate signature, exact issuer, audience, time claims and fixed `RS256`.
- Map only immutable, case-sensitive OIDC `sub` to an existing active
  non-service CMDBuild user with one default group.
- Let CMDBuild local groups/grants make the final authorization decision;
  IdP group claims do not provision CMDBuild users or grants.
- Fail closed for missing/malformed/wrong-audience tokens, unknown/missing
  mapping, inactive/service/no-default-group local users and unassigned policy.
- Keep structured redacted logging on stdout and the configured external audit
  sink. Debug is off by default; `basic` is temporary, `verbose` remains redacted.

## Acceptance

`direct-user-api-pass` requires actual HTTPS evidence for both paths: reader
identity/read, reader write denial, editor bounded write/readback/rollback, and
all negative boundaries with no mutation. `patch-conformance-pass` from the
isolated RS256/JWKS integration gate is necessary but not sufficient.

For the exact normative requirements, implementation details, test matrix,
rollback boundaries and all commands, use the [Russian specification](cmdbuild_42_oidc_token_forwarding_tz.ru.md).

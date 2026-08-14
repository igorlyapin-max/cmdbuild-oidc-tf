# CMDBuild 4.2 Bearer resource-server fork

Language: [English](cmdbuild-bearer-fork.md) | [Русский](cmdbuild-bearer-fork.ru.md)

## Scope and identity boundary

This POC builds a maintained local fork from the exact vendor archive
`cmdbuild-4.2.0-src.zip` (SHA-256
`7d9e08fc9674bc241b8b35d09183ba04e7d5d9024dba182acfde6cfdb5704f61`).
The fork implements direct, synchronous REST authentication of an OIDC access
token. It is not a browser OAuth-login replacement and does not change the
existing `default,oauth` browser module.

For every valid request CMDBuild:

1. verifies the JWT signature against the configured JWKS and the fixed
   `RS256` JWS algorithm;
2. verifies `iss`, that `aud` contains the configured audience, `exp`, `nbf`,
   `iat`, and a bounded clock skew;
3. maps only the standard immutable OIDC `sub`, requires an existing active,
   non-service CMDBuild user with a default group, and creates a
   server-side CMDBuild session only for the request lifecycle; it is deleted
   before the response returns and its token never leaves the server;
4. executes normal CMDBuild RBAC for that local user's group and grants.

There is no token exchange, token introspection, service account, Basic
fallback, session-cookie fallback, automatic user/group provisioning, or claim
to CMDBuild-role provisioning. A valid Bearer request carrying a
`CMDBuild-Authorization` header, parameter, or cookie is rejected as mixed
credentials. The validated `Authorization` header is stripped before the
legacy `SessionTokenFilter`; it cannot be parsed as Basic.

One CMDBuild instance has one active Bearer IdP profile. FAM and ZITADEL use
the same schema in separate deployments; they are not trusted simultaneously.

## Build and configuration

The vendor archive has a POM entry for the absent
`utils/bugreportcollector` reactor module. The fork removes only that invalid
build entry. The archive also declares `java-saml` artifacts that are no
longer available from Maven Central; the build stage imports the matching
3.9.0 JARs from the exact `itmicus/cmdbuild:4.2.0` vendor runtime image before
compiling. Its Geotools coordinates are fetched from the official OSGeo release
repository, added explicitly to the fork parent POM. CMDBuild 4.2 requires
the unavailable proprietary Sencha Cmd to rebuild its UI, so the Docker build
imports the unchanged `/ui` directory from the same pinned stock image and
builds only the source-backed backend WAR. `compose/Dockerfile.cmdbuild-bearer`
then replaces the stock exploded webapp. The running POC no longer mounts the old
Tomcat volume because a named volume at `/usr/local/tomcat` would hide the
forked WAR. The source archive also lacks its `.mvn/jvm.config`, required only
by its CLI self-extractor; that packaging step is omitted because this image
deploys the WAR directly to Tomcat.

Set these non-secret values in `.env`; do not put tokens or client secrets in
them:

```dotenv
CMDBUILD_BEARER_ENABLED=true
CMDBUILD_BEARER_ISSUER=http://192.168.202.35:8084
CMDBUILD_BEARER_JWKS_URL=http://192.168.202.35:8084/oauth/v2/keys
# A dedicated ZITADEL project resource, never an OIDC client ID.
CMDBUILD_RESOURCE_AUDIENCE=<resource-audience>
OIDC_RESOURCE_SCOPE=<resource-scope>
CMDBUILD_BEARER_AUDIENCE=<resource-project-id>
CMDBUILD_BEARER_DEPLOYMENT_PROFILE=poc-http
CMDBUILD_BEARER_CLOCK_SKEW_SECONDS=30
CMDBUILD_BEARER_ALLOWED_JWS_ALGORITHM=RS256
CMDBUILD_BEARER_AUDIT_SINK_URL=http://log-collector:18101/v1/logs
CMDBUILD_BEARER_AUDIT_HMAC_KEY_FILE=/run/secrets/log_collector_hmac_key
CMDBUILD_BEARER_DIAGNOSTIC_LEVEL=off
```

`CMDBUILD_RESOURCE_AUDIENCE` and `CMDBUILD_BEARER_AUDIENCE` must be the same
dedicated resource audience and must be present in the forwarded **access
token**, not an ID token or a client ID. `OIDC_RESOURCE_SCOPE` is the
IdP-configured scope requested by BFF and advertised by MCP. This POC maps the standard immutable OIDC `sub`
directly to an explicitly created local CMDBuild user/default group. The
ZITADEL Complement Token Action emits only `cmdbuild_oidc_tf_groups`; it does
not create CMDBuild users or grants and must not introduce a mutable
username-claim fallback. For FAM, set issuer, JWKS URL and audience to its
documented values. `production` is the default
Bearer deployment profile and requires HTTPS issuer/JWKS URLs; `poc-http` is
the explicit isolated-test exception. Use HTTPS outside this POC.

```bash
scripts/prepare-runtime.sh
docker compose --env-file .env -f compose.yml build cmdbuild
docker compose --env-file .env -f compose.yml up -d --force-recreate log-collector cmdbuild mcp-gateway cmdb-oidc-bff
scripts/configure-cmdbuild-bearer-auth.sh
```

The configuration script refuses placeholders, a mismatched resource audience,
and an unreadable audit HMAC key; it never prints credentials or JWTs. Bearer authentication is disabled by default. `diagnosticLevel` accepts
`off`, `basic`, and temporary `verbose`; diagnostic records contain neither
raw identity values nor credentials.

## IdP-neutral patch conformance

`npm run verify:cmdbuild-bearer-artifact` rebuilds the patched image from the
checksum-verified vendor source and verifies its provenance labels.
`npm run test:cmdbuild-bearer:integration` starts a separate short-lived
CMDBuild system with an internal RS256/JWKS fixture; it is not an IdP emulator
for browser login and does not access ZITADEL, FAM, OpenWebUI or persistent POC
volumes. It proves direct Bearer behaviour with a mapped local `sub`, exact
issuer/audience, expiry/time checks, signature/algorithm rejection, JWKS key
rotation, mixed-credential rejection, inactive/service/no-default-group users,
session-token non-leakage and the HMAC-protected audit sink.

Passing this gate is `patch-conformance-pass`, not `direct-user-api-pass`: the
latter additionally requires the selected live IdP and browser/BFF/MCP matrix.

Bootstrap the disposable mapping separately. The preferred administrator
password input is a secret-mounted file; the `CMDBUILD_BOOTSTRAP_PASSWORD`
environment variable exists only for an isolated interactive POC and must not
be committed or logged:

```bash
CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
  scripts/provision-cmdbuild-poc-grants.sh
```

The script creates (or reuses) card-scoped reader/editor groups and matching
active local users for the disposable card. Generated local passwords are
intentionally unrecoverable and are never used by BFF or MCP.

## Audit and diagnostics

Every accepted or rejected Bearer request emits a parameterized stdout audit
event containing only a short one-way local username fingerprint (when a
mapping exists) and a fixed reason category. When `auditSinkUrl` is set, the
same redacted structured event is delivered asynchronously to
`log-collector` with an HMAC signature shared through a Docker secret. The
collector is on the CMDBuild Docker network and is only published on host
loopback. It rejects unsigned records, rotates local files, and reports
non-writable storage as not ready. Failure of the audit sink never authenticates
a request and never recursively logs an outbound failure.

CMDBuild's ordinary logging remains controlled by its supported deployment
logging configuration. The Bearer fork emits its own redacted audit records to
the configured CMDBuild logger and, when configured, to the signed audit sink.
The deployment acceptance test must prove both routes; configuration alone is
not evidence.
The fork also treats an `Authorization: Bearer` value as non-legacy in request
tracking and masks credential-bearing headers and all cookie values in trace
diagnostics; neither the JWT nor a legacy credential is logged.

## Validation contract

Before classifying the architecture as `direct-user-api-pass`, prove all rows
without Basic, service accounts, copied cookies, a generic proxy, or a token
exchange:

| Scenario | Expected result |
|---|---|
| BFF `sessions/current` with reader token | `200`, mapped CMDBuild user is that user's immutable OIDC `sub` |
| Reader read of the isolated demo class | allowed by CMDBuild RBAC |
| Reader bounded write | denied, no mutation |
| Editor bounded write and read-back | allowed only with CMDBuild editor grant |
| Invalid/malformed Bearer | `401` and no CMDBuild operation |
| Valid token with unknown mapped user/default group | `401` and no operation |
| Existing browser OIDC | reader and editor create a matching CMDBuild browser session |

Before resource-audience hardening, the isolated fork protocol passed: browser OIDC
reader/editor sessions are mapped by `sub`; BFF and native OpenWebUI MCP reader
current-user/read returned `200` and writer boundaries were enforced; editor
completed the allowlisted update, readback and rollback. Missing/malformed and
wrong-audience tokens returned `401`; unknown group and missing local mapping
were denied. Stdout and `log-collector` received only redacted audit records.
After a resource-audience or client configuration change, rerun the complete
contract, including `scripts/e2e-resource-audience-boundary.sh`; do not carry
the previous result forward without that evidence.

The implementation covers HTTP REST. Async jobs and WebSocket authorization
are out of scope and require a separate validation before any production use.

## Maintenance

Keep the patch small and rebase it on the exact next CMDBuild vendor release.
For every upgrade, rebuild, rerun the validation contract, and retain the
AGPL-required notices from the vendor source. Do not transplant this POC
configuration into a production CMDBuild instance without a separate security
review and local-user/grant migration plan.

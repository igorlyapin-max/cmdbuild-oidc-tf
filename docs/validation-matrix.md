# Validation matrix

## Baseline and runtime

| Item | Result | Evidence |
|---|---|---|
| TypeScript typecheck and tests | pass | `npm run typecheck`; `npm test` |
| Isolated Compose syntax | pass | `docker compose --env-file .env -f compose.yml config --quiet` |
| Patched CMDBuild image build | pass | clean vendor-archive patch dry-run; Maven `BUILD SUCCESS`; image labels contain source and patch SHA-256. |
| Local CMDBuild fork runtime | pending recreate | Do not recreate with a placeholder audience; first capture rollback, provision the resource audience, then configure CMDBuild. |
| Diagnostics and external log point | local smoke pass / runtime pending | structured stdout plus redacted `log-collector`; signed record `202`, unsigned `401`; runtime restart remains pending resource configuration. |
| BFF write default | pass | recreated runtime has `BFF_POC_WRITE_ENABLED=false`; removed legacy GET mutation route returns `404` |
| Resource audience | pending rerun | Dedicated resource-project audience replaces all BFF/native-MCP client audiences; verify with `scripts/e2e-resource-audience-boundary.sh`. |
| Signed audit sink | pending rerun | Producers HMAC-sign records; collector rejects unsigned records and readiness fails on storage failure. |

## 2026-08-11 pre-hardening `sub` cutover

| Check | Result | Evidence |
|---|---|---|
| Immutable local mapping | pass | CMDBuild browser OAuth and Bearer filter configured with `sub`; explicit reader/editor local users are named by their OIDC subjects. |
| Browser CMDBuild OIDC | pass | Reader and editor each reach UI `200`, current session `200`, matching subject and one CMDBuild role. |
| Direct BFF reader/editor | pass | Reader `whoami=200`, read `200`, write `403`; editor update/readback/rollback `200`. |
| Native OpenWebUI MCP reader/editor | pass | Each interactive native OAuth client obtains a user token; reader subject/read pass and write is denied; editor subject/update/readback/rollback pass. |
| No recognised group | pass / denied | Valid `unassigned` POC user gets BFF `403`; no CMDBuild call. |
| No local CMDBuild mapping | pass / denied | Valid reader-role POC user without a CMDBuild user/default group gets BFF `401`; no mutation. |
| Missing/malformed credential | pass / denied | MCP unauthenticated request `401`; malformed Bearer to CMDBuild `401`. |
| Wrong audience | pass / denied | Valid native token against a temporary unrelated gateway audience `401`; restored configured audience initializes `200`. |
| Legacy mutable identity claim | removed | ZITADEL Action emits only `cmdbuild_oidc_tf_groups`; no `cmdbuild_username` compatibility mapping remains. |

## Decision

`direct-user-api-pass` was proven for the pre-hardening isolated POC. The
resource-audience/client/collector hardening changes require a full rerun before
the conclusion can be promoted again. The stock CMDBuild `4.2.0` image remains
`bearer-unsupported`; the source-backed `4.2.0-bearer.1` fork is required for
direct REST Bearer forwarding.

The browser callback is an internal HTTP POC address. Production proxy removal
still needs a protected FQDN/TLS callback, production grants/user migration and
perimeter approval. Do not add Basic, service accounts, copied CMDBuild
cookies, token exchange or a generic REST proxy as fallback.

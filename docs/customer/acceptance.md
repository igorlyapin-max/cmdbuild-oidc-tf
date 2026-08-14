# Customer acceptance and rollback checklist

Language: [English](acceptance.md) | [Русский](acceptance.ru.md)

Run this checklist on the customer's approved HTTPS environment. Record only artifact digest, date, endpoint, HTTP status, token fingerprint, subject hash, mapped group and grant outcome. Never record raw credentials, tokens, cookies, authorization codes or user data.

| Check | Expected result |
| --- | --- |
| Artifact and runtime | Approved WAR/image digest is running; health/readiness are healthy. |
| Bearer configuration | Exact issuer/JWKS/audience, `RS256`, `production`, diagnostics `off`; audit sink ready. |
| BFF reader | Current identity and allowlisted read succeed; bounded write is denied without mutation. |
| BFF editor | Bounded write, readback and rollback succeed only through editor grant. |
| OpenWebUI MCP reader/editor | Same CMDBuild mapped identity and grant outcome as the respective BFF role. |
| Negative tokens | Missing, malformed, expired or wrong-audience token returns `401` without CMDBuild operation. |
| Negative identities | Unassigned policy is denied before CMDBuild; unmapped/inactive/service/no-default-group local user returns `401`. |
| Logging | Structured redacted records reach stdout and the approved external sink; no credential-bearing data appears. |

Declare customer API integration accepted only when all applicable rows pass. If a negative boundary is accepted, audit is unavailable, artifact identity is wrong, or configuration cannot be restored: stop the change, restore the prior WAR/image and approved configuration snapshot, verify stock health, then record the redacted failure reason. Browser UI login is not a substitute for this API acceptance.

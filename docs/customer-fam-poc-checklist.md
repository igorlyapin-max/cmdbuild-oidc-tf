# Customer FAM POC checklist

Language: [English](customer-fam-poc-checklist.md) | [Русский](customer-fam-poc-checklist.ru.md)

Use this checklist with [the customer FAM POC runbook](customer-fam-poc-runbook.md).
Native CMDBuild UI/SAML is outside this checklist.

| Order | Owner | Where to go / action | Expected evidence |
| --- | --- | --- | --- |
| 1 | Change owner | Record approved artifact digest, backup reference, rollback owner and four disposable users. | Change record is complete. |
| 2 | FAM admin | `Администрирование -> Управление приложениями -> Добавить приложение -> OAuth/OpenID Connect`. Create separate BFF and OpenWebUI MCP apps. | Exact HTTPS callbacks, JWT access tokens, RS256 and dedicated CMDBuild audience. |
| 3 | FAM admin | Open app **Scopes**, **Модель доступа**, **Сертификаты**. | Stable `sub`, reader/editor claim if used, unassigned denied, discovery/JWKS reachable. |
| 4 | CMDBuild admin | Administration Module security: groups, users, default groups and least-privilege grants. | Local login equals FAM `sub`; reader/editor grants are distinct. |
| 5 | CMDBuild operator | Apply verified WAR/image, wait for health, then configure Bearer. | Patched artifact identity, issuer/JWKS/audience/RS256 accepted; audit sink ready. |
| 6 | UI/BFF operator | Configure FAM discovery, public PKCE client, resource scope and CA trust. | Reader BFF login returns to UI. |
| 7 | OpenWebUI admin | `Admin Panel -> Settings -> Authentication`: enable FAM OIDC; sign out and use **Continue with SSO**. | Reader returns to OpenWebUI. |
| 8 | OpenWebUI admin | `Admin Panel -> Users and Groups -> Groups`: create/reconcile reader/editor. | Unassigned receives no tool access. |
| 9 | OpenWebUI admin | `Admin Panel -> Settings -> External Tools/Tools/MCP Servers -> Add Connection`: add OAuth 2.1 MCP connection and group grants. | Reader/editor can authorize the named MCP server. |

## Acceptance matrix

| Scenario | Expected result |
| --- | --- |
| BFF reader `sessions/current` and bounded read | `200`; mapped CMDBuild reader and allowed object only. |
| BFF reader bounded write | Denied; no change persists. |
| BFF editor bounded write/readback/rollback | Write, readback and rollback succeed through editor CMDBuild grant. |
| OpenWebUI reader MCP | Same mapped CMDBuild reader/read result as BFF. |
| OpenWebUI editor MCP | Same bounded write/readback/rollback result as BFF editor. |
| Wrong/missing/expired/malformed token | `401`; no CMDBuild mutation. |
| Wrong audience | `401`; no CMDBuild mutation. |
| FAM `unassigned` group | Denied before CMDBuild; no mutation. |
| Valid FAM `sub` with no CMDBuild user | `401`; no mutation. |
| Inactive/service/no-default-group local user | `401`; no mutation. |
| Audit/diagnostics | Redacted accepted/rejected events reach stdout and external sink; no credential-bearing data. |

## Result

- Mark `direct-user-api-pass` only if every applicable row passes through real
  public HTTPS routes.
- Mark `failed` and execute the prepared rollback if a negative token is
  accepted, an identity/grant is wrong, an audit sink is unavailable, or the
  artifact/configuration cannot be restored.
- Do not classify browser SAML login to native CMDBuild UI as BFF/MCP API
  acceptance evidence.

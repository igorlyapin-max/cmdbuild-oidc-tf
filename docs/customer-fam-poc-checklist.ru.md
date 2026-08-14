# Checklist customer FAM POC

Language: [English](customer-fam-poc-checklist.md) | [Русский](customer-fam-poc-checklist.ru.md)

Используйте этот checklist вместе с [runbook customer FAM POC](customer-fam-poc-runbook.ru.md).
Штатный CMDBuild UI/SAML не входит в этот checklist.

| Порядок | Владелец | Куда перейти / действие | Ожидаемое evidence |
| --- | --- | --- | --- |
| 1 | Change owner | Зафиксировать approved artifact digest, backup reference, rollback owner и четыре disposable users. | Change record заполнен. |
| 2 | FAM admin | `Администрирование -> Управление приложениями -> Добавить приложение -> OAuth/OpenID Connect`. Создать отдельные BFF и OpenWebUI MCP apps. | Точные HTTPS callbacks, JWT access tokens, RS256 и dedicated CMDBuild audience. |
| 3 | FAM admin | В приложении открыть **Scopes**, **Модель доступа**, **Сертификаты**. | Stable `sub`, reader/editor claim при использовании, `unassigned` denied, discovery/JWKS доступны. |
| 4 | CMDBuild admin | Security в Administration Module: groups, users, default groups и least-privilege grants. | Local login равен FAM `sub`; reader/editor grants различны. |
| 5 | CMDBuild operator | Применить verified WAR/image, дождаться health, затем настроить Bearer. | Patched artifact identity, issuer/JWKS/audience/RS256 приняты; audit sink ready. |
| 6 | UI/BFF operator | Настроить FAM discovery, public PKCE client, resource scope и CA trust. | Login reader через BFF возвращает в UI. |
| 7 | OpenWebUI admin | `Admin Panel -> Settings -> Authentication`: включить FAM OIDC; выйти и выбрать **Continue with SSO**. | Reader возвращается в OpenWebUI. |
| 8 | OpenWebUI admin | `Admin Panel -> Users and Groups -> Groups`: создать/reconcile reader/editor. | `unassigned` не получает доступ к tools. |
| 9 | OpenWebUI admin | `Admin Panel -> Settings -> External Tools/Tools/MCP Servers -> Add Connection`: добавить OAuth 2.1 MCP connection и group grants. | Reader/editor могут авторизовать именованный MCP server. |

## Матрица приёмки

| Сценарий | Ожидаемый результат |
| --- | --- |
| BFF reader `sessions/current` и bounded read | `200`; mapped CMDBuild reader и только разрешённый объект. |
| BFF reader bounded write | Denied; изменение не сохраняется. |
| BFF editor bounded write/readback/rollback | Write, readback и rollback проходят через editor CMDBuild grant. |
| OpenWebUI reader MCP | Тот же mapped CMDBuild reader/read result, что через BFF. |
| OpenWebUI editor MCP | Тот же bounded write/readback/rollback result, что через BFF editor. |
| Wrong/missing/expired/malformed token | `401`; CMDBuild mutation отсутствует. |
| Wrong audience | `401`; CMDBuild mutation отсутствует. |
| FAM `unassigned` group | Denied до CMDBuild; mutation отсутствует. |
| Valid FAM `sub` без CMDBuild user | `401`; mutation отсутствует. |
| Inactive/service/no-default-group local user | `401`; mutation отсутствует. |
| Audit/diagnostics | Redacted accepted/rejected events поступают в stdout и external sink; credential-bearing data отсутствуют. |

## Результат

- Отмечайте `direct-user-api-pass` только если каждая применимая строка проходит через реальные public HTTPS routes.
- Отмечайте `failed` и выполняйте подготовленный rollback, если negative token принят, identity/grant неверен, audit sink недоступен или artifact/configuration нельзя восстановить.
- Не считайте browser SAML login в штатный CMDBuild UI evidence приёмки BFF/MCP API.

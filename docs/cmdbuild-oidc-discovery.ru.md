# Протокол discovery CMDBuild OIDC

Language: [English](cmdbuild-oidc-discovery.md) | [Русский](cmdbuild-oidc-discovery.ru.md)

POC рассматривает browser login, local CMDBuild mapping и REST Bearer validation
как отдельные факты. Успешный browser OIDC сам по себе не доказывает, что BFF
или MCP могут вызывать CMDBuild REST от имени того же пользователя.

Postgres POC намеренно не создаёт `cmdbuild_oidc_tf` заранее: database creation
и demo-dump import принадлежат `dbconfig create` CMDBuild. Предварительное
создание оставляет только bootstrap tables и ломает patching.

## Требуемые evidence

| Проверка | Требуемый результат |
| --- | --- |
| Browser OIDC | Reader и editor достигают CMDBuild UI, имеют mapped current session и только соответствующую CMDBuild role. |
| Direct BFF | `sessions/current` возвращает immutable OIDC `sub`, идентифицирующий local CMDBuild user. |
| Native MCP | `cmdbuild_whoami` возвращает тот же mapped identity. |
| Reader | Read успешен; bounded write отклонён до CMDBuild mutation. |
| Editor | Bounded update, readback и rollback успешны. |
| Negative boundary | Missing/malformed/wrong-audience tokens и unknown group fail closed; valid subject без local CMDBuild mapping отклоняется. |

## Наблюдённый до hardening результат и fail-closed rule

До P1/P2 resource-audience hardening, 2026-08-11, isolated local fork
`4.2.0-bearer.1` достиг `direct-user-api-pass`. `default,oauth` CMDBuild с
`OP_CUSTOM` сопоставлял standard immutable OIDC `sub` с explicit local
users/default groups. Reader и editor завершали browser authorization-code
login и получали current-session `200` с соответствующей CMDBuild role.

Такое же `sub` mapping использует direct Bearer filter. BFF и native OpenWebUI
MCP передают только JWT текущего пользователя: reader current-user/read — `200`,
bounded write denied; editor update/readback/rollback проходит. Не используются
Basic credentials, service accounts, copied cookies, token exchange, automatic
provisioning или generic REST proxy. Server-side request session существует
только в request lifecycle, его token не покидает CMDBuild.

Observed boundaries: missing/malformed Bearer — `401`; valid token с unrelated
audience — `401`; valid `unassigned` group — `403` до CMDBuild; valid reader
без local CMDBuild user — `401` без mutation. ZITADEL Action выдаёт только flat
group claim; mutable username-claim и legacy mapping fallback отсутствуют.

## Решение без reverse proxy

До resource-audience hardening POC соответствовал `direct-user-api-pass`:
browser OIDC создаёт mapped CMDBuild session, а direct user-token REST calls
авторизуются обычными CMDBuild grants. BFF и native OpenWebUI MCP могут
использовать direct Bearer pattern. До переноса вывода повторите полную matrix,
включая resource-audience rejection/restore boundary.

Это не разрешает production cutover: нужны protected FQDN/TLS callback,
perimeter review и scoped migration local CMDBuild users/grants. Не добавляйте
Basic, service account, copied cookies, token exchange или generic proxy как
compatibility fallback.

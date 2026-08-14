# Checklist приёмки и rollback заказчика

Language: [English](acceptance.md) | [Русский](acceptance.ru.md)

Выполняйте checklist на approved HTTPS environment заказчика. Фиксируйте только artifact digest, date, endpoint, HTTP status, token fingerprint, subject hash, mapped group и grant outcome. Никогда не записывайте raw credentials, tokens, cookies, authorization codes или user data.

| Проверка | Ожидаемый результат |
| --- | --- |
| Artifact и runtime | Запущен approved WAR/image digest; health/readiness healthy. |
| Bearer configuration | Exact issuer/JWKS/audience, `RS256`, `production`, diagnostics `off`; audit sink ready. |
| BFF reader | Current identity и allowlisted read успешны; bounded write denied без mutation. |
| BFF editor | Bounded write, readback и rollback успешны только через editor grant. |
| OpenWebUI MCP reader/editor | Та же CMDBuild mapped identity и grant outcome, что у соответствующей BFF role. |
| Negative tokens | Missing, malformed, expired или wrong-audience token возвращает `401` без CMDBuild operation. |
| Negative identities | Unassigned policy denied до CMDBuild; unmapped/inactive/service/no-default-group local user возвращает `401`. |
| Logging | Structured redacted records поступают в stdout и approved external sink; credential-bearing data отсутствуют. |

Объявляйте customer API integration accepted только при прохождении всех применимых строк. При ошибке остановите change, верните prior WAR/image и approved configuration snapshot, проверьте stock health и зафиксируйте redacted failure reason. Browser UI login не заменяет эту API acceptance.

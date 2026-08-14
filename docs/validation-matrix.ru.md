# Матрица валидации

Language: [English](validation-matrix.md) | [Русский](validation-matrix.ru.md)

| Проверка | Статус | Evidence |
| --- | --- | --- |
| TypeScript typecheck и tests | pass | `npm run typecheck`; `npm test` |
| Isolated Compose syntax | pass | `docker compose --env-file .env -f compose.yml config --quiet` |
| Patched CMDBuild image build | pass | clean vendor-archive patch dry-run; Maven `BUILD SUCCESS`; image labels содержат source и patch SHA-256. |
| IdP-neutral patch conformance | pending first run | `npm run test:cmdbuild-bearer:integration` использует isolated RS256/JWKS fixture; это не live-IdP/browser proof. |
| Local CMDBuild fork runtime | pending recreate | Не пересоздавайте с placeholder audience: сначала capture rollback, provision resource audience, затем configure CMDBuild. |
| Diagnostics и external log point | local smoke pass / runtime pending | structured stdout плюс redacted `log-collector`; signed record `202`, unsigned `401`; runtime restart ожидает resource configuration. |

## Решение

`patch-conformance-pass` означает, что patched CMDBuild resource-server filter
проходит isolated local issuer matrix. Это намеренно уже, чем
`direct-user-api-pass`: для последнего также нужны selected live IdP и
browser/BFF/MCP matrix.

`direct-user-api-pass` был доказан для pre-hardening isolated POC. Changes
resource-audience/client/collector требуют полного повторного запуска перед
повышением вывода. Stock CMDBuild `4.2.0` остаётся `bearer-unsupported` baseline.
Полную актуальную матрицу сценариев, включая строки, не сокращённые в русском
обзоре, см. в [English canonical version](validation-matrix.md).

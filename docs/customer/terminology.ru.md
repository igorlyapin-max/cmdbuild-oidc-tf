# Термины customer deployment kit

Язык: [English](terminology.md) | [Русский](terminology.ru.md)

- **Поставщик идентичности (IdP)** — ZITADEL или FAM; выдаёт access token после входа пользователя.
- **Issuer** — HTTPS-идентификатор IdP в claim `iss`; CMDBuild принимает token только от точно указанного issuer.
- **JWKS** — HTTPS-набор публичных ключей IdP; по нему CMDBuild проверяет подпись token.
- **Resource audience** — значение claim `aud` для API CMDBuild, отдельное от `client_id`; связывает token именно с этим API.
- **`sub`** — неизменяемый идентификатор пользователя IdP; он должен в точности совпадать с login локального пользователя CMDBuild.
- **Локальная группа и grant** — CMDBuild groups и permissions, которые окончательно решают доступ к данным; IdP group claim не заменяет их.
- **BFF** — backend-for-frontend: получает token текущего пользователя от UI и передаёт неизменённым только в CMDBuild REST API.
- **MCP** — protocol connection OpenWebUI к CMDBuild tools; использует отдельный OIDC client и token текущего пользователя.
- **Redacted snapshot** — запись конфигурации с hashes/flags вместо secrets, token и passwords; нужна для проверки и rollback.
- **Проверка готовности** — запрос health/readiness endpoint, подтверждающий запуск сервиса до следующего изменения.

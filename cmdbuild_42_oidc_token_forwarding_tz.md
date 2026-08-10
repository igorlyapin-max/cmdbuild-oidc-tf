# Техническое задание

## Поддержка OIDC/OAuth2 Bearer Token Forwarding в REST API CMDBuild 4.2

**Версия документа:** 1.0\
**Целевая версия:** CMDBuild 4.2.x\
**Цель:** обеспечить выполнение REST API CMDBuild от имени конечного
пользователя при вызовах через BFF и MCP/OpenWebUI без Token Exchange.

------------------------------------------------------------------------

## 1. Целевые сценарии

### Сценарий 1 --- UI → BFF → CMDBuild

``` text
User
  │
  ▼
UI ── OIDC ──► IdP
  │
  ▼
BFF
  │ Authorization: Bearer <user_access_token>
  ▼
CMDBuild REST API
  │
  ▼
CMDBuild User + RBAC
```

### Сценарий 2 --- OpenWebUI → MCP → CMDBuild

``` text
User
  │
  ▼
OpenWebUI ── OIDC ──► IdP
  │
  ▼
MCP Server
  │ Authorization: Bearer <user_access_token>
  ▼
CMDBuild REST API
  │
  ▼
CMDBuild User + RBAC
```

Во всех компонентах используется один корпоративный IdP.

------------------------------------------------------------------------

## 2. Основной архитектурный принцип

CMDBuild должен выступать как **OAuth Resource Server** для REST API.

BFF и MCP не должны выполнять вход в CMDBuild под технической учетной
записью. Идентичность пользователя определяется непосредственно по
переданному Access Token.

``` text
                   Corporate IdP
                        │
                  Access Token
                        │
             ┌──────────┴──────────┐
             │                     │
             ▼                     ▼
            BFF                   MCP
             │                     │
             └──────────┬──────────┘
                        │
                Bearer Access Token
                        │
                        ▼
                  CMDBuild REST
                        │
                  JWT validation
                        │
                   User mapping
                        │
                  CMDBuild RBAC
```

------------------------------------------------------------------------

## 3. Token Exchange

RFC 8693 Token Exchange в данной реализации **не используется**.

IdP должен выдавать Access Token сразу с аудиториями Resource Servers,
которым токен должен предъявляться.

Для BFF:

``` json
{
  "iss": "https://idp.company",
  "sub": "user-id",
  "preferred_username": "ivanov",
  "aud": ["bff-api", "cmdb-api"]
}
```

Для OpenWebUI/MCP:

``` json
{
  "iss": "https://idp.company",
  "sub": "user-id",
  "preferred_username": "ivanov",
  "aud": ["openwebui-api", "mcp-api", "cmdb-api"]
}
```

CMDBuild должен принимать токен, если `aud` **содержит** `cmdb-api`.
Проверка не должна требовать точного равенства `aud == cmdb-api`.

------------------------------------------------------------------------

## 4. Требования к IdP

Целевая архитектура должна поддерживать как минимум:

-   Avanpost FAM;
-   ZITADEL.

IdP должен обеспечивать:

-   OAuth 2.x / OpenID Connect;
-   Authorization Code Flow;
-   PKCE там, где применимо;
-   JWT Access Token;
-   JWKS endpoint;
-   несколько значений `aud` в Access Token;
-   configurable claims/scopes;
-   стандартные временные claims `exp`, при наличии `nbf`, `iat`.

Для Avanpost FAM допускается штатная конфигурация
`Audience type = Массив`.

Для ZITADEL допускается формирование необходимых audiences средствами
Projects/Audience scopes.

------------------------------------------------------------------------

## 5. Требования к Access Token

Предпочтительный формат --- подписанный JWT Access Token.

Минимально используемые claims:

``` text
iss
sub
preferred_username (или другой configurable identity claim)
aud
exp
nbf (если присутствует)
iat (если присутствует)
scope (если используется)
```

------------------------------------------------------------------------

## 6. Доработка REST authentication CMDBuild

В authentication chain REST API необходимо реализовать:

``` text
HTTP request
     │
     ▼
Authorization header
     │
     ▼
Bearer Token Authenticator
     │
     ├── extract token
     ├── verify signature
     ├── validate issuer
     ├── validate audience
     ├── validate expiration
     ├── validate nbf
     └── extract identity
     │
     ▼
CMDBuild User Resolver
     │
     ▼
CMDBuild User
     │
     ▼
Existing CMDBuild Groups / RBAC
     │
     ▼
REST operation
```

Рекомендуемое рабочее название нового компонента:
`BearerTokenAuthenticator`.

Точное место интеграции и имена изменяемых классов должны быть
определены после анализа официального `cmdbuild-4.2.x-src.zip`.
Существующие механизмы OAuth/session authentication CMDBuild не должны
изменяться без необходимости.

------------------------------------------------------------------------

## 7. Проверка JWT

### Подпись

Публичные ключи должны получаться через JWKS корпоративного IdP. Должна
поддерживаться ротация ключей по `kid`.

### Issuer

``` text
iss == configuredIssuer
```

### Audience

``` text
configuredAudience ∈ aud
```

Например:

``` text
configuredAudience = cmdb-api
```

Токен:

``` json
"aud": ["openwebui-api", "mcp-api", "cmdb-api"]
```

должен успешно пройти проверку.

### Срок действия

Проверяются:

``` text
exp > current time
nbf <= current time   (если claim присутствует)
```

Допускается configurable clock skew.

------------------------------------------------------------------------

## 8. Mapping пользователя

Claim для сопоставления пользователя должен быть configurable:

``` properties
org.cmdbuild.auth.bearer.userClaim=preferred_username
```

Рекомендуемое значение по умолчанию --- `preferred_username`.

Пример:

``` json
{
  "sub": "17ac8231-...",
  "preferred_username": "ivanov"
}
```

должен разрешаться в `CMDBuild User = ivanov`.

Не следует жестко предполагать, что OIDC `sub` совпадает с login
пользователя CMDBuild.

------------------------------------------------------------------------

## 9. Авторизация

IdP отвечает за подтверждение идентичности пользователя. CMDBuild
остается системой принятия решения о доступе к объектам CMDBuild.

``` text
Access Token
     │
     ▼
Identity = ivanov
     │
     ▼
CMDBuild User
     │
     ▼
CMDBuild Groups
     │
     ▼
CMDBuild Permissions
```

Существующая модель RBAC CMDBuild должна продолжать действовать без
изменений.

В первой версии не требуется автоматически преобразовывать IdP groups в
CMDBuild groups.

------------------------------------------------------------------------

## 10. Scopes

Поддержка OAuth scopes должна быть предусмотрена архитектурно, но может
быть вынесена во второй этап.

Если scopes используются:

``` text
OAuth scope ∩ CMDBuild RBAC = Effective permission
```

OAuth scope не должен расширять права, предоставленные CMDBuild.

------------------------------------------------------------------------

## 11. Stateless REST authentication

Для запроса с Bearer Token создание отдельной CMDBuild web session не
должно быть обязательным.

``` text
request
  ↓
Bearer token
  ↓
validation
  ↓
request security context
  ↓
CMDBuild user
  ↓
operation
```

После завершения запроса request authentication context должен быть
уничтожен.

------------------------------------------------------------------------

## 12. Совместимость

Должны одновременно работать:

``` text
CMDBuild UI
    ↓
existing authentication/session

External BFF
    ↓
Bearer authentication

MCP
    ↓
Bearer authentication
```

Новая Bearer authentication является дополнительным способом
аутентификации REST API и не должна ломать существующий UI/login.

------------------------------------------------------------------------

## 13. Конфигурация

Предлагаемый набор параметров:

``` properties
org.cmdbuild.auth.bearer.enabled=true
org.cmdbuild.auth.bearer.issuer=https://idp.company
org.cmdbuild.auth.bearer.jwksUrl=https://idp.company/.../jwks
org.cmdbuild.auth.bearer.audience=cmdb-api
org.cmdbuild.auth.bearer.userClaim=preferred_username
org.cmdbuild.auth.bearer.clockSkewSeconds=30
```

Конкретные имена properties должны соответствовать стилю конфигурации
CMDBuild 4.2.

------------------------------------------------------------------------

## 14. Ошибки

-   нет Bearer header --- запрос может быть передан существующему
    authentication chain;
-   неверная подпись --- `401 Unauthorized`;
-   неверный issuer --- `401 Unauthorized`;
-   `cmdb-api` отсутствует в `aud` --- `401 Unauthorized`;
-   token expired / not yet valid --- `401 Unauthorized`;
-   пользователь отсутствует в CMDBuild --- `401 Unauthorized` либо
    согласованная authentication error;
-   пользователь существует, но операция запрещена RBAC ---
    `403 Forbidden`.

Необходимо четко различать 401 (authentication) и 403 (authorization).

------------------------------------------------------------------------

## 15. Безопасность и логирование

Запрещено логировать:

``` text
access_token
refresh_token
id_token
Authorization header
client_secret
```

Допускается:

``` text
issuer
user
subject (при необходимости)
audience validation result
endpoint
HTTP method
authentication result
correlation id
```

------------------------------------------------------------------------

## 16. Запрет service-account fallback

При отказе пользовательской авторизации запрещено автоматически
повторять операцию от имени технической учетной записи.

``` text
user token → 403 → caller receives 403
```

------------------------------------------------------------------------

## 17. Требования к BFF

BFF передает пользовательский Access Token:

``` http
Authorization: Bearer <user_access_token>
```

Токен должен содержать `cmdb-api` в `aud`, например:

``` json
"aud": ["bff-api", "cmdb-api"]
```

------------------------------------------------------------------------

## 18. Требования к OpenWebUI / MCP

Целевая цепочка:

``` text
User → OpenWebUI → MCP → CMDBuild REST API
```

На участке MCP → CMDBuild передается пользовательский Access Token:

``` http
Authorization: Bearer <user_access_token>
```

Пример аудитории:

``` json
"aud": ["openwebui-api", "mcp-api", "cmdb-api"]
```

Отдельным интеграционным тестом необходимо подтвердить, что используемая
версия OpenWebUI/MCP позволяет передать пользовательский Access Token до
MCP и далее в CMDBuild.

Если OpenWebUI использует отдельную OAuth-сессию для MCP, это не меняет
контракт CMDBuild: на вход CMDBuild должен поступить валидный Access
Token с `aud`, содержащим `cmdb-api`.

------------------------------------------------------------------------

## 19. Acceptance tests

1.  **BFF authentication:** REST-запрос выполняется от имени
    соответствующего CMDBuild User.
2.  **MCP authentication:** запрос через OpenWebUI/MCP выполняется от
    имени конечного пользователя.
3.  **Multi-audience:** `aud=["mcp-api","cmdb-api"]` принимается.
4.  **Missing audience:** `aud=["mcp-api"]` отклоняется с 401.
5.  **Wrong issuer:** JWT другого issuer отклоняется.
6.  **Invalid signature:** JWT с неверной подписью отклоняется.
7.  **Expired token:** просроченный JWT отклоняется.
8.  **Unknown user:** валидный JWT неизвестного CMDBuild пользователя не
    предоставляет доступ.
9.  **CMDBuild RBAC:** пользователь может выполнять только разрешенные
    его profile/groups операции.
10. **Two users:** параллельные запросы A и B не смешивают security
    context.
11. **Existing UI:** штатная аутентификация CMDBuild продолжает
    работать.
12. **No token leakage:** Access Token отсутствует в
    application/audit/debug логах.
13. **403 propagation:** отказ RBAC не вызывает service-account
    fallback.
14. **JWKS rotation:** новый `kid` принимается после штатной ротации
    ключей IdP.

------------------------------------------------------------------------

## 20. Анализ исходного кода перед разработкой

Перед реализацией необходимо разобрать официальный
`cmdbuild-4.2.x-src.zip` и определить:

1.  REST authentication filter chain;
2.  роль `SessionTokenFilter`;
3.  использование `RequestAuthUtils`;
4.  registry существующих authentication providers/authenticators;
5.  механизм создания текущего CMDBuild security/user context;
6.  механизм разрешения CMDBuild User по login;
7.  точки применения CMDBuild RBAC к REST API.

Предпочтительно реализовать минимальное расширение:

``` text
Existing REST authentication chain
             │
             ├── existing authentication
             │
             └── BearerTokenAuthenticator   ← NEW
                       │
                       ├── JwtValidator      ← NEW
                       ├── JwksProvider      ← NEW / library
                       └── UserResolver      ← reuse existing
```

Цель --- минимизировать изменения ядра и упростить перенос patch на
будущие версии CMDBuild.

------------------------------------------------------------------------

## 21. Что не входит в первую версию

-   RFC 8693 Token Exchange;
-   service-account fallback;
-   автоматический provisioning пользователей;
-   автоматическое создание CMDBuild groups из IdP groups;
-   изменение штатного RBAC CMDBuild;
-   передача bearer token обратно в браузер средствами CMDBuild;
-   глобальное ослабление audience validation;
-   изменение штатного CMDBuild UI, если это не требуется для
    совместимости.

------------------------------------------------------------------------

## 22. Критерий готовности

Решение считается готовым, если один и тот же пользователь
корпоративного IdP может обращаться к REST API CMDBuild:

``` text
User → UI → BFF → CMDBuild
```

и:

``` text
User → OpenWebUI → MCP → CMDBuild
```

при этом CMDBuild в обоих случаях:

1.  получает Bearer Access Token;
2.  самостоятельно проверяет JWT;
3.  подтверждает `iss`;
4.  подтверждает наличие `cmdb-api` в `aud`;
5.  определяет CMDBuild User;
6.  применяет существующий CMDBuild RBAC;
7.  не использует техническую учетную запись вместо пользователя;
8.  не требует Token Exchange.

------------------------------------------------------------------------

## 23. Первоисточники

-   CMDBuild --- официальный сайт и загрузка исходного кода:
    https://www.cmdbuild.org/
-   CMDBuild --- Technical Manual:
    https://www.cmdbuild.org/file/manuali/technical-manual-in-english
-   Avanpost FAM --- официальная документация:
    https://docs.avanpost.ru/fam/
-   ZITADEL --- официальная документация: https://zitadel.com/docs/
-   OAuth 2.0 JWT Access Token Profile --- RFC 9068:
    https://datatracker.ietf.org/doc/rfc9068/
-   OAuth 2.0 Resource Indicators --- RFC 8707:
    https://datatracker.ietf.org/doc/rfc8707/

> Примечание: точные имена изменяемых Java-классов и методов CMDBuild
> 4.2 должны быть подтверждены анализом конкретного официального
> исходного архива 4.2.x. В документе намеренно не фиксируются
> неподтвержденные внутренние API.

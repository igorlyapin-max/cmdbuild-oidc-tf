# CMDBuild 4.2 Bearer resource-server fork

Language: [English](cmdbuild-bearer-fork.md) | [Русский](cmdbuild-bearer-fork.ru.md)

POC собирает maintained local fork из exact vendor archive `cmdbuild-4.2.0-src.zip`
с зафиксированной SHA-256. Fork выполняет direct synchronous REST authentication
OIDC access token; он не заменяет browser OAuth login и не изменяет browser module
`default,oauth`.

Для valid request CMDBuild проверяет JWT signature по configured JWKS и fixed
`RS256`, `iss`, configured audience в `aud`, `exp`, `nbf`, `iat` и bounded clock
skew. Он сопоставляет только immutable OIDC `sub` с existing active non-service
CMDBuild user, имеющим default group; server-side session существует только в
request lifecycle и её token не покидает server. Затем применяются normal
CMDBuild RBAC groups/grants.

Token exchange, introspection, service account, Basic fallback, session-cookie
fallback, automatic user/group provisioning и claim-to-role provisioning отсутствуют.
Bearer request с `CMDBuild-Authorization` header, parameter или cookie отклоняется
как mixed credentials; validated `Authorization` strip выполняется до legacy
`SessionTokenFilter`.

Один CMDBuild instance имеет один active Bearer IdP profile: FAM и ZITADEL
используют same schema в отдельных deployments, но не доверяются одновременно.

## Build и configuration

Vendor archive имеет invalid POM entry для absent `utils/bugreportcollector`;
fork удаляет только эту entry. Build imports unavailable `java-saml` 3.9.0 JARs
из exact `itmicus/cmdbuild:4.2.0` vendor runtime image, получает Geotools из
official OSGeo release repository и использует unchanged `/ui` pinned stock
image, потому что CMDBuild 4.2 требует proprietary Sencha Cmd для UI rebuild.
`compose/Dockerfile.cmdbuild-bearer` заменяет stock exploded webapp; old Tomcat
volume не монтируется, иначе он скрывает forked WAR.

Set non-secret `.env` values как в [English canonical version](cmdbuild-bearer-fork.md).
`CMDBUILD_RESOURCE_AUDIENCE` и `CMDBUILD_BEARER_AUDIENCE` должны совпадать и
быть в forwarded **access token**, а не ID token или client ID. `OIDC_RESOURCE_SCOPE`
запрашивают BFF и MCP. `production` profile требует HTTPS issuer/JWKS; `poc-http`
— явное isolated-test exception. Bearer authentication выключена по умолчанию.

Configuration script отклоняет placeholders, mismatched resource audience и
unreadable audit HMAC key; credentials/JWT не выводятся. `diagnosticLevel`
принимает `off`, `basic`, temporary `verbose`; diagnostic records не содержат
raw identity values и credentials.

## IdP-neutral patch conformance

`npm run verify:cmdbuild-bearer-artifact` rebuilds patched image из
checksum-verified vendor source и проверяет provenance labels. `npm run
test:cmdbuild-bearer:integration` запускает short-lived isolated CMDBuild с
internal RS256/JWKS fixture; он не эмулирует browser login и не обращается к
ZITADEL, FAM, OpenWebUI или persistent POC volumes. Проверяются mapped local
`sub`, exact issuer/audience, expiry/time, signature/algorithm rejection,
JWKS rotation, mixed credentials, inactive/service/no-default-group users,
session-token non-leakage и HMAC-protected audit sink.

Этот gate — `patch-conformance-pass`, а не `direct-user-api-pass`: для второго
также нужны selected live IdP и browser/BFF/MCP matrix. Async jobs и WebSocket
authorization находятся вне scope и требуют отдельной проверки до production use.

Для точных bootstrap, full acceptance matrix и upgrade procedure см.
[English canonical version](cmdbuild-bearer-fork.md).

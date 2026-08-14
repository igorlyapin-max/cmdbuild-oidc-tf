# Production runbook: CMDBuild Bearer patch и OIDC

Language: [English](production-cmdbuild-oidc-runbook.md) | [Русский](production-cmdbuild-oidc-runbook.ru.md)

Этот runbook описывает безопасное применение Bearer patch к уже развёрнутому
CMDBuild и настройку OIDC для BFF и native MCP. Он не превращает isolated POC
в production acceptance: production release требует change approval, backup,
rollback, TLS/perimeter review, operational logging и customer-specific E2E.

## Перед изменением

1. Назначьте change/rollback owner, maintenance window и approved artifact digest.
2. Зафиксируйте CMDBuild version, deployment mode, existing WAR/image digest,
   database backup reference и current authentication configuration; проверьте
   restore procedure заказчика.
3. Подтвердите public HTTPS FQDN, CA trust CMDBuild/BFF/MCP/OpenWebUI к IdP и
   отсутствие wildcard redirect URIs. Не отключайте TLS validation.
4. Выполните redacted rollback snapshot до изменения и подготовьте previous
   verified artifact. Не сохраняйте passwords, tokens, cookies, client secrets
   или authorization headers в evidence.

## Artifact и deployment

Собирайте только в approved CI из checksum-verified vendor source и repository
patch. Перед promotion подтвердите artifact checksum, source SHA, patch SHA,
SBOM/attestation и результат `npm run verify:cmdbuild-bearer-artifact`.

Для Tomcat/systemd остановите service, выполните atomic WAR swap через
`scripts/apply-existing-cmdbuild-patch.sh`, затем запустите service и проверьте
public health/readiness route и deployed checksum. Helper сохраняет previous WAR
в `backup/` и отказывается менять running service. Для rollback используйте
`scripts/rollback-existing-cmdbuild-patch.sh`, затем подтвердите previous runtime.

Для container deployment продвигайте immutable image digest; изменяйте только
CMDBuild image reference, пересоздавайте только CMDBuild workload и проверяйте
observed digest. Existing database/application volumes сохраняются. При failure
восстановите previous digest и redacted snapshot; не редактируйте таблицы
CMDBuild напрямую.

## Общий контракт IdP и CMDBuild

IdP должен выпускать RS256 JWT **access token** с exact HTTPS issuer, reachable
HTTPS JWKS, dedicated opaque `CMDBUILD_RESOURCE_AUDIENCE` и immutable,
case-sensitive OIDC `sub`. Audience не является client ID. Bearer patch
сопоставляет `sub` только с existing active non-service local CMDBuild user,
у которого есть default group; groups/grants назначаются в CMDBuild, не claims
IdP. Unknown, inactive, service, no-default-group и unmapped subjects fail
closed.

Настройте `CMDBUILD_BEARER_DEPLOYMENT_PROFILE=production`, exact issuer/JWKS,
resource audience и `CMDBUILD_BEARER_DIAGNOSTIC_LEVEL=off`; production не
принимает HTTP IdP URLs. Diagnostic `basic` включайте временно; `verbose`
также обязан redacted. Structured logs должны идти в stdout и configured
HMAC-protected external audit sink.

В CMDBuild Administration Module создайте least-privilege groups `reader` и
`editor`, explicit local users для approved IdP `sub`, один default group на
user и только требуемые grants. Не включайте Basic fallback, service account,
token exchange, copied browser cookie или generic REST proxy.

## ZITADEL и Avanpost FAM

Для ZITADEL создайте separate resource project/audience, public PKCE clients
для BFF и native MCP, exact callbacks и project-scoped flat group action.
Usernames CMDBuild остаются immutable `sub`; не вводите mutable username fallback.

Для Avanpost FAM/MFA+ 1.17 создайте два отдельных OAuth/OpenID Connect public
applications: BFF и OpenWebUI MCP. В интерфейсе FAM откройте
`Администрирование -> 5.3 Управление приложениями -> Добавить приложение -> OAuth/OpenID Connect`.
Укажите Authorization Code + PKCE `S256`, JWT access tokens, `RS256`, exact
HTTPS callbacks, dedicated audience, minimum scopes и disposable POC users/groups.
До активации проверьте **Настройки**, **Scopes**, **Модель доступа**,
**Сертификаты**, discovery/JWKS и stable `sub`.

FAM browser UI/SAML и CMDBuild `OP_CUSTOM` не входят в API POC. Не включайте
их как evidence BFF/MCP. Полная последовательность UI steps приведена в
[customer FAM POC runbook](customer-fam-poc-runbook.ru.md).

## BFF, OpenWebUI и MCP

BFF — public PKCE client: запросите user access token и без изменения
пересылайте его только CMDBuild REST. Group policy может отклонить пользователя
до вызова, но final authorization остаётся за CMDBuild grants.

В OpenWebUI: **Admin Panel -> Settings -> Authentication**, включите OIDC SSO,
задайте IdP discovery/issuer, client, scopes и exact public base URL; выйдите и
проверьте **Continue with SSO**. В **Users and Groups -> Groups** создайте
`reader`/`editor`. В **External Tools / Tools / MCP Servers -> Add Connection**
добавьте MCP OAuth 2.1 connection с exact protected-resource URL, discovery,
public MCP client и callback. Выдавайте видимость только allowlisted tools
группам `reader` и `editor`; stale OAuth sessions удаляйте только для этой
connection и затем повторно авторизуйте users.

## Приёмка и rollback

Проверьте через public HTTPS routes: BFF и MCP `reader` current identity/read;
reader write denied; `editor` bounded write/readback/rollback; wrong/missing/
expired/malformed token `401`; wrong audience `401`; `unassigned` denied до
CMDBuild; unmapped/inactive/service/no-default-group local user `401`; stdout
и external sink получают только redacted audit events.

Объявляйте `direct-user-api-pass` только после прохождения всех применимых
строк обоими paths. При любой негативной acceptance, недоступном audit sink или
невозможности вернуть artifact/configuration выполните prepared rollback и
запишите failure без sensitive data. Полные командные примеры и vendor-specific
детали см. в [English canonical version](production-cmdbuild-oidc-runbook.md).

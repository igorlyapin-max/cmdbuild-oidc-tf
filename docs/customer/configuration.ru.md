# Настройка CMDBuild, IdP и приложений

Язык: [English](configuration.md) | [Русский](configuration.ru.md)

Этот документ связывает пять зон ответственности: IdP выпускает access token;
UI+BFF и OpenWebUI получают его для текущего пользователя; MCP/BFF передают
его в CMDBuild; CMDBuild по `sub` находит локального пользователя и применяет
его группы и права. Настраивайте разделы строго сверху вниз: следующий раздел
использует значения, созданные в предыдущем.

## 1. Общий OIDC-контракт

Для одного CMDBuild deployment выберите ровно один issuer: ZITADEL или
FAM/MFA+ 1.17. BFF и native MCP должны получать RS256 JWT **access token** с
точным HTTPS `iss`, доступным HTTPS JWKS, dedicated CMDBuild resource audience
и immutable case-sensitive `sub`. Audience — не OIDC client ID. Не передавайте
ID token и не добавляйте token exchange, Basic authentication, service account,
скопированные CMDBuild cookies или generic REST proxy.

Создайте отдельные public Authorization Code + PKCE clients для BFF и native
MCP. Зарегистрируйте точные HTTPS callbacks и общий resource scope/audience.
Плоский reader/editor claim может определять BFF/OpenWebUI visibility, но не
выдаёт CMDBuild access.

## 2. Administration Module CMDBuild

**Цель.** В IdP определяют личность, но не права на данные CMDBuild. Поэтому
сначала создаются локальные пользователи и минимальные grants, а Bearer filter
только связывает проверенный `sub` с этим локальным пользователем.

Войдите как CMDBuild administrator. В security area создайте groups `reader`
и `editor`, затем назначьте только нужные class/view/report/attribute grants:
reader — только read, editor — только approved bounded write. Для каждого
approved IdP subject создайте active local user с login, точно равным
case-sensitive `sub`, и одним intended default group. Оставьте unassigned и
unmapped validation subjects без accepted grant path. Не используйте direct SQL.

**Где задавать параметры.** После запуска patched service откройте
Authentication/Configuration в Administration Module, сохраните текущие
значения в change record и задайте Bearer parameters. Если labels отличаются
из-за локализации/сборки, ориентируйтесь на configuration key, а не на перевод
названия поля.

После healthy patched service задайте Bearer parameters в Authentication/
Configuration интерфейсе Administration Module либо через authenticated REST v3
`system/config`:

| Key | Требуемое значение |
| --- | --- |
| `org.cmdbuild.auth.bearer.enabled` | `true` после prechecks |
| `org.cmdbuild.auth.bearer.issuer` / `jwksUrl` | точные HTTPS issuer/JWKS выбранного IdP |
| `org.cmdbuild.auth.bearer.audience` | dedicated resource audience |
| local identity | fixed immutable JWT `sub` |
| `org.cmdbuild.auth.bearer.allowedJwsAlgorithm` | `RS256` |
| `org.cmdbuild.auth.bearer.deploymentProfile` | `production` |
| `org.cmdbuild.auth.bearer.clockSkewSeconds` | approved bounded value |
| audit parameters | approved sink, readable HMAC-key file, diagnostics `off` |

### Воспроизводимый командный способ

Этот способ нужен, когда change procedure должна быть повторяемой и есть
разрешение использовать account администратора через CMDBuild REST v3. Он
работает с **существующим** CMDBuild по public HTTPS URL и не использует
repository Compose, Docker или POC host. Сначала снимите redacted snapshot:

```bash
CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
CMDBUILD_API_BASE_URL=https://cmdb.example.org/cmdbuild \
  scripts/capture-existing-cmdbuild-bearer-config.sh > cmdbuild-bearer-before.redacted.json
```

Затем задайте значения из разделов IdP ниже: `CMDBUILD_BEARER_ISSUER`,
`CMDBUILD_BEARER_JWKS_URL`, `CMDBUILD_RESOURCE_AUDIENCE`, audit sink и путь к
его HMAC key. При private CA задайте `CMDBUILD_CA_BUNDLE` — файл CA bundle,
которому доверяет shell host. Script `scripts/configure-existing-cmdbuild-bearer-auth.sh` принимает только HTTPS, `RS256` и profile
`production`, проверяет совпадение audience, применяет keys, выполняет reload
и не выводит password/JWT.

```bash
CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
CMDBUILD_API_BASE_URL=https://cmdb.example.org/cmdbuild \
CMDBUILD_BEARER_ISSUER=https://idp.example.org \
CMDBUILD_BEARER_JWKS_URL=https://idp.example.org/.well-known/jwks.json \
CMDBUILD_RESOURCE_AUDIENCE=cmdbuild-api \
CMDBUILD_BEARER_AUDIENCE=cmdbuild-api \
CMDBUILD_BEARER_AUDIT_SINK_URL=https://audit.example.org/v1/logs \
CMDBUILD_BEARER_AUDIT_HMAC_KEY_FILE=/run/secrets/cmdbuild_audit_hmac \
  scripts/configure-existing-cmdbuild-bearer-auth.sh
```

Не используйте `scripts/configure-cmdbuild-bearer-auth.sh` из POC: он обращается
внутрь repository Compose container и не предназначен для customer system.

## 3. FAM/MFA+ 1.17

Откройте `Администрирование -> 5.3 Управление приложениями -> Добавить
приложение -> OAuth/OpenID Connect`. Создайте два applications: BFF и
OpenWebUI native MCP. В мастере **Основные настройки -> Настройки интеграции
-> Настройки аутентификации -> Завершение** задайте отдельное имя, точный
callback, public client, Authorization Code + PKCE `S256`, `JSON Web Token`,
`RS256`, dedicated CMDBuild resource audience и `Audience type=Строка`.

В **Настройки**, **Scopes**, **Модель доступа**, **Сертификаты** проверьте
stable `sub`, minimum scopes, approved users/groups, signing key и discovery/JWKS.
Настройте flat group claim только если его читает BFF/OpenWebUI. Не настраивайте
FAM federation только ради создания этих applications.

## 4. ZITADEL

В **Projects** создайте application project с roles `reader`, `editor` и
non-accepted `unassigned`. Создайте отдельный resource project; его ID —
CMDBuild audience. В **Actions** attach Complement Token Action к **Pre Userinfo
creation** и **Pre access token creation**: он должен выдавать flat claim
только из application project. В **Applications** создайте отдельные public
PKCE apps для BFF и native MCP. Каждый запрашивает
`urn:zitadel:iam:org:project:id:<resource-project-id>:aud` и использует exact
HTTPS redirect URLs.

## 5. UI+BFF и OpenWebUI

Настройте UI+BFF: discovery URL выбранного issuer, public PKCE BFF client ID,
точный callback, trusted CA bundle и resource scope. BFF обязан без изменения
передавать access token текущего пользователя только в CMDBuild REST.

В OpenWebUI откройте **Admin Panel -> Settings -> Authentication**, настройте
OIDC issuer/client/scopes/base URL. После успешного SSO откройте **Admin Panel
-> Users and Groups -> Groups** и map/reconcile `reader`/`editor`. Затем
**External Tools** (или **Tools/MCP Servers**) -> **Add Connection**, выберите
`MCP` с `OAuth 2.1`, укажите exact protected-resource URL, discovery metadata,
native-MCP client и callback. Выдайте только allowlisted CMDBuild tools группам
`reader` и `editor`, но не глобально.

Далее выполните [приёмку](acceptance.ru.md).

# Runbook customer POC: FAM, BFF, OpenWebUI MCP и CMDBuild API

Language: [English](customer-fam-poc-runbook.md) | [Русский](customer-fam-poc-runbook.ru.md)

Этот runbook готовит контролируемый customer POC для двух authenticated paths:

```text
Avanpost FAM/MFA+ -> UI -> BFF -> CMDBuild REST API
Avanpost FAM/MFA+ -> OpenWebUI -> native MCP -> CMDBuild REST API
```

FAM/MFA+ 1.17 — единственный OIDC issuer. Штатный browser UI CMDBuild не является частью POC.
Его FAM/SAML configuration, browser login и support model принадлежат администраторам CMDBuild и FAM заказчика. Не включайте CMDBuild `OP_CUSTOM`, не разворачивайте FAM compatibility adapter и не используйте успешный browser SAML login как evidence для двух API paths.

## 1. Роли, значения и жёсткие границы

Заполните worksheet до изменения окружения. Secrets храните в customer secret store; этот документ фиксирует только identifiers и hashes.

| Значение | Владелец | Требуемая форма |
| --- | --- | --- |
| `FAM_ISSUER` | FAM administrator | Точный HTTPS issuer URL из FAM discovery metadata. |
| `FAM_JWKS_URL` | FAM administrator | Точный HTTPS JWKS URL, которому доверяют CMDBuild, BFF и MCP. |
| `CMDBUILD_RESOURCE_AUDIENCE` | FAM + CMDBuild administrators | Одна dedicated opaque audience string; никогда не client ID. |
| `BFF_REDIRECT_URI` | UI/BFF operator | Точный public HTTPS callback без wildcard. |
| `OPENWEBUI_REDIRECT_URI` | OpenWebUI administrator | `https://<openwebui-fqdn>/oauth/clients/mcp:<server-id>/callback`. |
| `MCP_RESOURCE_URL` | MCP operator | Точный public HTTPS MCP protected-resource URL. |
| `CMDBUILD_BASE_URL` | CMDBuild administrator | Public HTTPS CMDBuild REST base URL. |
| `FAM_SUB` | FAM + CMDBuild administrators | Immutable, case-sensitive OIDC `sub`; local CMDBuild login имеет точно это значение. |

Patch принимает только RS256 JWT **access tokens** с точными issuer, audience и `sub`. Он не выполняет token exchange, не создаёт users, не сопоставляет groups с CMDBuild grants, не принимает Basic authentication, service accounts или скопированные browser cookies CMDBuild.

## 2. До изменения и rollback

1. Назначьте change owner, rollback owner и POC window. Подготовьте четыре disposable FAM users: `reader`, `editor`, `unassigned` и `unmapped`.
2. Зафиксируйте CMDBuild `4.2.0`, current WAR/image digest, deployment mode, database-backup reference и current authentication configuration. Проверьте восстановление database backup стандартной процедурой заказчика.
3. Проверьте approved CA chains от CMDBuild, BFF, MCP и OpenWebUI к FAM. Не отключайте certificate validation для private CA.
4. До изменения зафиксируйте redacted snapshot конфигурации CMDBuild:

   ```bash
   CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
     scripts/capture-cmdbuild-oauth-rollback.sh > cmdbuild-before.redacted.json
   ```

5. Подготовьте previous verified WAR/image digest и rollback command. Остановите изменение при отсутствии artifact checksum, backup или TLS precondition.

## 3. Применение patch к существующему развёртыванию CMDBuild

Собирайте artifact в approved CI, а не на production host. Repository содержит только source patch material; vendor source archive, WAR и customer secrets намеренно не включены.

```bash
npm run verify:cmdbuild-bearer-artifact
scripts/build-cmdbuild-bearer-war.sh
sha256sum -c artifacts/cmdbuild-4.2.0-bearer.1.war.sha256
```

### Tomcat / systemd

Остановите service, затем выполните atomic WAR swap. Helper откажется заменять running service и сохранит предыдущий WAR в `backup/`.

```bash
CMDBUILD_HOME=/opt/cmdbuild/tomcat/webapps \
CMDBUILD_SERVICE=cmdbuild \
CMDBUILD_PATCH_WAR=/secure/artifacts/cmdbuild-4.2.0-bearer.1.war \
CMDBUILD_PATCH_WAR_SHA256=/secure/artifacts/cmdbuild-4.2.0-bearer.1.war.sha256 \
  scripts/apply-existing-cmdbuild-patch.sh
systemctl start cmdbuild
```

Подтвердите public health/readiness route и deployed WAR checksum до изменения identity settings. Для rollback остановите service и запустите `scripts/rollback-existing-cmdbuild-patch.sh` с теми же `CMDBUILD_HOME` и `CMDBUILD_SERVICE`, затем запустите и проверьте предыдущий service.

### Container deployment

Продвигайте только approved immutable image digest с source SHA, patch SHA и SBOM/attestation. Изменяйте только CMDBuild image reference, пересоздавайте только CMDBuild workload и проверяйте observed digest. Сохраняйте existing database и application volumes. При ошибке восстановите previous digest и redacted configuration snapshot; не редактируйте таблицы CMDBuild напрямую.

## 4. Настройка FAM/MFA+ 1.17

FAM administrator создаёт два отдельных приложения. В FAM откройте `Администрирование -> 5.3 Управление приложениями`, выберите **Добавить приложение**, затем **OAuth/OpenID Connect**.

### 4.1 Приложение BFF

В мастере **Основные настройки -> Настройки интеграции -> Настройки аутентификации -> Завершение** настройте:

| Поле/tab | Значение |
| --- | --- |
| `Наименование` | Отличающееся имя приложения BFF. |
| `Redirect URIs` | Точный `BFF_REDIRECT_URI`. |
| `Публичный` | Включено. |
| flow | Authorization Code with PKCE `S256`; без distributed client secret. |
| `Access token type` | `JSON Web Token`. |
| `JWT Signature Algorithm` | `RS256`. |
| `Audience` / `Audience type` | `CMDBUILD_RESOURCE_AUDIENCE` как string audience. |
| `Scopes` | Minimum OIDC scopes плюс approved CMDBuild resource scope. |
| `Модель доступа` | Только disposable POC users/groups. |

### 4.2 Приложение OpenWebUI native MCP

Создайте второе public OIDC application с той же JWT/audience policy и точным `OPENWEBUI_REDIRECT_URI`. Не используйте BFF client повторно. На tab **Scopes** публикуйте плоский approved group claim для `reader`/`editor` только если OpenWebUI использует его для tool visibility. FAM `sub` остаётся единственным local CMDBuild identity mapping.

До активации обоих apps откройте **Настройки**, **Scopes**, **Модель доступа** и **Сертификаты**. Проверьте HTTPS redirect URI, RS256 signing key, JWT access-token type, resource audience, user access и stable `sub`. FAM administrator предоставляет discovery/JWKS URLs и локально проверяет fresh access token, не копируя его в ticket или внешний decoder.

## 5. Настройка CMDBuild

CMDBuild administrator входит в Administration Module.

1. В security section создайте groups `reader` и `editor`. Reader получает только approved CMDBuild read permissions; editor — одно bounded update permission, требуемое POC. Не предоставляйте administration rights.
2. Создайте active local users для FAM subjects `reader` и `editor`. Для каждого local login задайте точно case-sensitive FAM `sub` и один intended default group. Оставьте `unmapped` отсутствующим, а `unassigned` — без accepted grant path.
3. Настройте только Bearer patch. Не меняйте существующие browser SAML settings и не включайте `default,oauth`/`OP_CUSTOM` для этого POC.

Для repository Compose example скопируйте `.env.example` в защищённый `.env`, задайте ниже non-secret Bearer values, затем пересоздайте только CMDBuild workload, чтобы значения попали в его process environment. Password храните вне `.env` в root-readable secret file:

```bash
CMDBUILD_BEARER_ENABLED=true
CMDBUILD_BEARER_DEPLOYMENT_PROFILE=production
CMDBUILD_BEARER_ISSUER=<FAM_ISSUER>
CMDBUILD_BEARER_JWKS_URL=<FAM_JWKS_URL>
CMDBUILD_RESOURCE_AUDIENCE=<CMDBUILD_RESOURCE_AUDIENCE>
CMDBUILD_BEARER_AUDIENCE=<CMDBUILD_RESOURCE_AUDIENCE>
CMDBUILD_BEARER_DIAGNOSTIC_LEVEL=off
```

```bash
docker compose --env-file .env -f compose.yml up -d --force-recreate cmdbuild
CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
  scripts/configure-cmdbuild-bearer-auth.sh
```

Helper использует authenticated REST v3 `system/config` API CMDBuild и временный netrc file с mode `0600` внутри container; credentials и JWT не выводятся. Убедитесь, что diagnostic mode по умолчанию `off`, включайте `basic` только для временной диагностики и держите external HMAC-protected audit sink готовым.

## 6. Настройка UI/BFF

UI/BFF operator задаёт FAM discovery issuer, public PKCE BFF client ID, точный BFF callback, approved CA bundle и dedicated resource scope. BFF должен запросить user access token и без изменения передавать его только в CMDBuild REST. Он может отклонить unassigned group до вызова CMDBuild, но финальное authorisation decision остаётся за CMDBuild local groups/grants.

Не настраивайте token exchange, static CMDBuild password, service account, copied CMDBuild session cookie или generic REST proxy.

## 7. Перевод OpenWebUI на FAM OIDC и регистрация MCP

Метки немного различаются между releases OpenWebUI. Войдите как system administrator и откройте **Admin Panel -> Settings -> Authentication**.

1. Включите OAuth/OIDC SSO и задайте FAM discovery/issuer URL, OIDC client ID, secret только если выбранный confidential-client mode требует его, scopes и точный public OpenWebUI base URL. Предпочитайте public Authorization Code + PKCE, когда deployed OpenWebUI version его поддерживает.
2. Сохраните, выйдите, затем выберите **Continue with SSO** на OpenWebUI login page. Подтвердите, что disposable reader возвращается в OpenWebUI.
3. Откройте **Admin Panel -> Users and Groups -> Groups**. Создайте `reader` и `editor`; сопоставьте или reconcile approved FAM flat group claim. Убедитесь, что `unassigned` не получает tool grant.
4. Откройте **Admin Panel -> Settings -> External Tools** (в некоторых releases называется **Tools** или **MCP Servers**). Нажмите **Add Connection** и выберите `MCP` с `OAuth 2.1`.
5. Укажите точные HTTPS `MCP_RESOURCE_URL`, stable server ID, OAuth discovery metadata, public FAM MCP client ID и точный `OPENWEBUI_REDIRECT_URI`. Включите только `cmdbuild_whoami`, `cmdbuild_read_demo_cards` и bounded update tool POC. Предоставьте tool visibility группам OpenWebUI `reader` и `editor`, но не глобально.
6. Сохраните connection, затем отдельно авторизуйте его от reader и editor. При изменении issuer, client ID, callback или scope удаляйте только stale OAuth sessions этой MCP connection и повторно авторизуйте users.

Не редактируйте encrypted OpenWebUI OAuth-session/configuration records напрямую.

## 8. Evidence и решение

Используйте [checklist customer FAM POC](customer-fam-poc-checklist.ru.md) по порядку. Фиксируйте только date, artifact digest, CMDBuild version, endpoint, HTTP status, token fingerprint, subject hash, mapped group и grant outcome. Никогда не записывайте tokens, cookies, passwords, client secrets, authorization codes или user data.

Объявляйте `direct-user-api-pass` только когда и BFF, и OpenWebUI native MCP paths доказывают совпадающую mapped CMDBuild identity и least-privilege grants. Evidence штатного CMDBuild UI SAML принадлежит заказчику и не меняет этого решения.

## References

- [FAM/MFA+ 1.17 OIDC applications](https://docs.avanpost.ru/fam/1.17/131139314.html)
- [FAM/MFA+ 1.17 claim-based authorisation](https://docs.avanpost.ru/fam/1.17/125569833.html)
- [CMDBuild Administration Module](https://www.cmdbuild.org/en/project/features/administration-module)

# cmdbuild-oidc-tf: OIDC, групповые claims и forwarding токена MCP

Language: [English](README.md) | [Русский](README.ru.md)

Руководство по развёртыванию customer POC только для API с FAM находится в
[runbook customer FAM POC](docs/customer-fam-poc-runbook.ru.md) и
[checklist выполнения](docs/customer-fam-poc-checklist.ru.md). Штатный browser UI
CMDBuild и SAML явно не входят в scope этого POC.

Изолированный POC проверяет авторизацию приложений через существующий ZITADEL:

- OpenWebUI работает через OIDC, local password form отключена;
- OpenWebUI RBAC и доступ к MCP определяются плоским custom claim `cmdbuild_oidc_tf_groups`;
- MCP gateway передаёт в CMDBuild только access token текущего пользователя;
- отдельный CMDBuild 4.2 и BFF-аналог custom page не затрагивают рабочие CMDBuild и `cmdbcustompages`.

Исходники POC хранятся в Git как patch поверх checksum-verified official
CMDBuild 4.2.0 source; upstream archive и распакованный vendor source не
хранятся в репозитории. Пароли и токены не выводятся и не хранятся в документации.

## Архитектура

```text
Browser
  |-- :8083 --> cmdbuild-oidc-tf edge --> existing OpenWebUI :13001
  |-- :8084 --> cmdbuild-oidc-tf edge --> existing ZITADEL API :18080 / login :13000
  |-- :8085 --> cmdbuild-oidc-tf edge --> MCP gateway :18100
  `-- :18086 -----------------> OIDC BFF analogue (direct; no reverse proxy)

OpenWebUI -- OAuth access token --> MCP gateway -- same Bearer token --> isolated CMDBuild :18090
MCP gateway + BFF -- structured redacted logs --> local log collector :18101 --> named volume
```

`cmdbuild-oidc-tf edge` только восстанавливает уже настроенные public URLs
существующего стека. Он не меняет его исходники, volumes, secrets или containers.
BFF на `:18086` намеренно работает без reverse proxy.

## Запуск

1. Выполните настройку ZITADEL и OpenWebUI из [administrator runbook](docs/administrator-runbook.ru.md).
   Существующий OpenWebUI OIDC client использует `cmdbuild_oidc_tf_groups`; local password login остаётся отключённым.
2. Храните `secrets/` локально. Создайте isolated external volumes и HMAC key с правами `0600`, требуемый log collector:

   ```bash
   scripts/prepare-runtime.sh
   ```

3. До запроса нового resource audience или изменения OAuth configuration
   CMDBuild зафиксируйте текущую конфигурацию, указав доступный хосту файл
   administrator password. Snapshot выводит только hashes и flags; пароль,
   secret, cookie и token не выводятся.
4. Создайте dedicated ZITADEL project resource, запишите его точный ID в локальный
   `.env` и обновите project-scoped role action. Resource ID — это access-token
   audience, а не OIDC client ID.

   ```bash
   CMDBUILD_BOOTSTRAP_PASSWORD_FILE=/secure/path/cmdbuild-admin-password \
     scripts/capture-cmdbuild-oauth-rollback.sh
   node scripts/create-zitadel-cmdbuild-oidc-tf-resource-project.mjs
   scripts/configure-resource-audience.sh
   node scripts/update-zitadel-cmdbuild-oidc-tf-flat-groups-action.mjs
   ```

5. До запуска OAuth-configured CMDBuild запустите `oidc-edge` и provision/reconcile
   dedicated CMDBuild и native-MCP clients. Создаются локальные файлы `0600`
   `secrets/cmdbuild_oidc_tf_client_id` и `secrets/cmdbuild_oidc_tf_client_secret`;
   они не отслеживаются и не выводятся. Если confidential CMDBuild client был
   создан до записи identity state, один раз выполните reconcile с
   `CMDBUILD_ROTATE_CLIENT_SECRET=true`.

   ```bash
   docker compose --env-file .env -f compose.yml up -d oidc-edge
   CMDBUILD_ROTATE_CLIENT_SECRET=true \
     node scripts/provision-zitadel-cmdbuild-oidc-tf-cmdbuild-client.mjs
   node scripts/provision-zitadel-cmdbuild-oidc-tf-native-mcp-client.mjs
   node scripts/configure-zitadel-cmdbuild-oidc-tf-native-mcp-token-settings.mjs
   node scripts/configure-openwebui-native-mcp.mjs
   ```

6. Проверьте конфигурацию и запустите сервис. OAuth и Bearer modules CMDBuild
   перенастраивайте только после health fork:

   ```bash
   docker compose --env-file .env -f compose.yml config --quiet
   docker compose --env-file .env -f compose.yml up -d --build
   scripts/configure-cmdbuild-zitadel-oauth.sh
   scripts/configure-cmdbuild-bearer-auth.sh
   ```

   Если `boot/status` сообщает `WAITING_FOR_PATCH_MANAGER`, перед следующим
   application start выполните isolated maintenance job:

   ```bash
   docker compose --env-file .env -f compose.yml stop cmdbuild
   docker compose --env-file .env -f compose.yml --profile maintenance run --rm cmdbuild-db-patch
   docker compose --env-file .env -f compose.yml up -d cmdbuild
   ```

7. Выполните focused checks:

   ```bash
   npm run typecheck
   npm test
   MCP_SMOKE_URL=http://127.0.0.1:18100 npm run smoke:mcp
   docker compose --env-file .env -f compose.yml ps
   ```

   IdP-neutral gates для Bearer patch отделены от live ZITADEL POC:

   ```bash
   npm run verify:cmdbuild-bearer-artifact
   npm run test:cmdbuild-bearer:integration
   ```

   Integration command создаёт временный isolated Docker project с локальным
   RS256/JWKS fixture. Он не использует ZITADEL, OpenWebUI, FAM или POC volumes
   и удаляет собственный project и volumes после результата.

Первая инициализация CMDBuild может занять несколько минут. Data volumes:
`cmdbuild-oidc-tf_cmdbuild_db` и `cmdbuild-oidc-tf_logs`; они отделены от
rollback volumes предыдущего POC и существующего CMDBuild stack.

## Гарантии и намеренные ограничения

- Gateway проверяет JWT signature, issuer, audience и expiry, затем разбирает standard ZITADEL project-role claim. Если в verified access token нет ролей, он читает UserInfo того же subject. Unknown или отсутствующая группа отклоняется.
- `reader` может вызывать только read tools. `editor` и `admin` могут выполнять ограниченное demo update. Tool разрешает только одну configured demo card и allowlisted attributes.
- Gateway и BFF не имеют CMDBuild service-account fallback. Stock CMDBuild 4.2 не поддерживает Bearer; forwarded user access token проверяет только checksum-verified local fork.
- До P1/P2 resource-audience hardening изолированный POC доказал browser mapping по immutable `sub` и `direct-user-api-pass`. Результат надо повторно подтвердить командами runbook до использования; он не разрешает removal production proxy.
- JWT, passwords, cookies, auth headers, OAuth codes и secrets редактируются в stdout и log collector.
- Нормальный `DIAGNOSTIC_LEVEL=basic`. `verbose` временный и также redacted.
- OpenWebUI использует стабильный Docker secret `WEBUI_SECRET_KEY`. При первом rollout очищаются только stale encrypted `oauth_session`; пользователи должны войти снова. Не ротируйте этот key без необходимости: он шифрует OAuth sessions и MCP OAuth client data.
- HTTP предназначен только для текущего private test host. Production требует HTTPS, secure cookies, hardened external log sink и secrets manager.

См. [entry points](docs/entrypoints.ru.md), POC [administrator runbook](docs/administrator-runbook.ru.md),
[CMDBuild OIDC discovery](docs/cmdbuild-oidc-discovery.ru.md) и [validation matrix](docs/validation-matrix.ru.md).
Завершённый naming/data cutover и rollback boundary записаны в [rename migration](docs/rename-migration.ru.md).

Для уже развёрнутого CMDBuild используйте отдельный [production patch and OIDC
runbook](docs/production-cmdbuild-oidc-runbook.ru.md). Он описывает verified
artifact delivery, Tomcat/systemd и Docker rollback, общие требования IdP,
примеры консолей ZITADEL и FAM/MFA+ 1.17, а также настройку CMDBuild
Administration Module. Он не выдаёт isolated POC за production result.

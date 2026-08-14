# Runbook администратора

Language: [English](administrator-runbook.md) | [Русский](administrator-runbook.ru.md)

Runbook относится к isolated `cmdbuild-oidc-tf` POC: в нём нет production
credentials и fallback authentication paths. Для existing production CMDBuild
используйте [production patch and OIDC runbook](production-cmdbuild-oidc-runbook.ru.md):
HTTP addresses POC, Compose build path и historical E2E result не являются
production change procedure.

## ZITADEL

1. В project `cmdbuild-oidc-tf` создайте roles `admin`, `editor`, `reader`.
   Назначьте reader/editor test users ровно одну соответствующую role. Local
   CMDBuild usernames — immutable ZITADEL user IDs (`sub`), а не login names.
2. Для negative authorization check создайте `unassigned` role и disposable user
   только с этой role: BFF/MCP policy намеренно не принимает его.
3. Attach `cmdbuild_oidc_tf_flat_groups` к **Complement Token → Pre Userinfo creation**
   и **Pre access token creation**. Он должен выдавать groups только exact
   `cmdbuild-oidc-tf` project и не должен добавлять mutable username claim.
4. BFF — public PKCE client с callback `http://192.168.202.35:18086/oauth/callback`;
   confidential CMDBuild client callback — `http://192.168.202.35:18090/cmdbuild/oauth2/callback`.
   Это internal HTTP POC values.
5. Создайте separate project resource и используйте его ID как resource audience.
   Не переиспользуйте BFF, browser или MCP client ID.
6. Native MCP client — отдельный public PKCE client. Настраивайте его через
   `scripts/configure-openwebui-native-mcp.mjs`, не редактируя encrypted database напрямую.

## CMDBuild

1. `CMDBUILD_BIND_HOST` и `CMDBUILD_BASE_URL` должны содержать один approved
   internal address; `CMDBUILD_BASE_URL` не может оставаться loopback, потому что
   BFF и gateway используют host networking.
2. Bearer сопоставляет только immutable `sub`. Для isolated POC используйте
   `CMDBUILD_BEARER_DEPLOYMENT_PROFILE=poc-http`; audience должен совпадать с
   dedicated resource audience forwarded access tokens. ID token client этому
   контракту не соответствует.
3. Provision explicit disposable local reader/editor users и grants. Это единственный
   admin-bootstrap path; BFF/MCP не используют пароль администратора.
4. До configuration change capture redacted OAuth/Bearer rollback snapshot;
   затем reconcile clients/resource audience/callback и CMDBuild OAuth module
   скриптами из [English runbook](administrator-runbook.md).

## Проверка и операции

Запустите полный набор `e2e-*` scripts и `npm run smoke:mcp` из English version.
`e2e-bff-cmdbuild-grants.mjs` выполняет ограниченный editor update/rollback:
установите `BFF_POC_WRITE_ENABLED=true` только на его запуск, пересоздайте BFF,
затем верните `false` и пересоздайте BFF снова.

Проверяйте runtime через:

```bash
docker compose --env-file .env -f compose.yml ps
docker compose --env-file .env -f compose.yml logs --tail=200 mcp-gateway cmdb-oidc-bff log-collector
```

Structured logs идут в stdout и redacted `log-collector`. Сохраняйте
`DIAGNOSTIC_LEVEL=basic`, Bearer diagnostics `off`; `verbose` временный и не
должен записывать tokens, passwords, cookies или headers.

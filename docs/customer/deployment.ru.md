# Применение CMDBuild Bearer patch

Язык: [English](deployment.md) | [Русский](deployment.ru.md)

## Предварительные условия

Patch заменяет только application artifact CMDBuild `4.2.0`; database schema и
данные не меняются напрямую. Поэтому его можно безопасно откатить только когда
предыдущий artifact, backup и исходная authentication configuration зафиксированы.
До изменения назначьте владельцев изменения и rollback, проверьте восстановление
database backup, зафиксируйте running WAR/image digest и соберите artifact в
approved CI, но не на production host.

```bash
npm run verify:cmdbuild-bearer-artifact
scripts/build-cmdbuild-bearer-war.sh
sha256sum -c artifacts/cmdbuild-4.2.0-bearer.1.war.sha256
```

В change record сохраните Git revision, vendor-source SHA-256, patch SHA-256 и
checksum WAR либо immutable image digest. Это связывает работающий CMDBuild с
проверенным исходным patch; mutable registry tag не является artifact identity.

## Tomcat / systemd

Выберите этот путь, если CMDBuild работает как WAR под Tomcat/systemd.
Остановите CMDBuild и запустите atomic helper: он откажется работать с active
service, проверит checksum и сохранит prior WAR в `backup/` до замены.

```bash
CMDBUILD_HOME=/opt/cmdbuild/tomcat/webapps \
CMDBUILD_SERVICE=cmdbuild \
CMDBUILD_PATCH_WAR=/secure/artifacts/cmdbuild-4.2.0-bearer.1.war \
CMDBUILD_PATCH_WAR_SHA256=/secure/artifacts/cmdbuild-4.2.0-bearer.1.war.sha256 \
  scripts/apply-existing-cmdbuild-patch.sh
systemctl start cmdbuild
```

Проверьте health и deployed checksum до изменения identity settings. Для
rollback остановите service, выполните `scripts/rollback-existing-cmdbuild-patch.sh`
с теми же `CMDBUILD_HOME` и `CMDBUILD_SERVICE`, запустите CMDBuild и восстановите
approved authentication snapshot.

## Docker / Compose

Выберите этот путь, если customer CMDBuild уже запускается из image.
Продвигайте approved immutable image digest. Измените только CMDBuild `image:`
reference в deployment manifest заказчика, сохраните database/application volumes
и пересоздайте только CMDBuild workload. Проверьте running digest и health/readiness
endpoint. При ошибке верните previous digest и configuration snapshot.
Repository `compose.yml` использует `build:` и host networking только для
verification; это не customer manifest.

К [настройке](configuration.ru.md) переходите только после healthy patched runtime.

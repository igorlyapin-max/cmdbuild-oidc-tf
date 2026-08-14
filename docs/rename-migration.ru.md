# Миграция имён и состояния: `idpTest` → `cmdbuild-oidc-tf`

Language: [English](rename-migration.md) | [Русский](rename-migration.ru.md)

Этот документ фиксирует завершённый naming/data cutover и его rollback boundary.
Конкретные команды, container/volume names и доказательства остаются в
[English canonical version](rename-migration.md), чтобы не расходиться с
исполняемыми идентификаторами.

Не удаляйте legacy state до подтверждённого rollback window. Новый POC не
должен изменять working CMDBuild, `cmdbcustompages`, их secrets или volumes.

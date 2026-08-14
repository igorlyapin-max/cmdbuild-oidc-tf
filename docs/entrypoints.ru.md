# Точки входа и credentials

Language: [English](entrypoints.md) | [Русский](entrypoints.ru.md)

Используйте этот документ только вместе с защищённым `.env` и локальным `secrets/`.
Никогда не помещайте реальные passwords, tokens, cookies или client secrets в Git,
issue, ticket или runbook.

Все browser endpoints и service ports, назначение credentials, owner и порядок
получения приведены в [English canonical version](entrypoints.md). Значения в
этой таблице являются environment-specific: перед запуском сверяйте их с
rendered Compose configuration и approved change record.

Для customer FAM POC используйте [customer runbook](customer-fam-poc-runbook.ru.md),
а не адреса isolated ZITADEL POC.

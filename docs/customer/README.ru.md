# Комплект развертывания для заказчика

Language: [English](README.md) | [Русский](README.ru.md)

Комплект поставляет Bearer patch для CMDBuild 4.2 и эксплуатационные инструкции
для подготовки собственного окружения заказчика. Это не инструкция по
воспроизведению isolated POC из repository.

Поддерживаемые API paths:

```text
UI -> BFF -> CMDBuild REST API
OpenWebUI -> native MCP -> CMDBuild REST API
```

Browser SSO CMDBuild, SAML и `OP_CUSTOM` находятся вне scope этой поставки.

Выполняйте инструкции по порядку:

1. [Применить patch](deployment.ru.md) к существующему CMDBuild в Tomcat/systemd или Docker/Compose.
2. [Настроить CMDBuild, IdP и приложения](configuration.ru.md): FAM/MFA+ 1.17, ZITADEL, UI+BFF и OpenWebUI native MCP.
3. Выполнить customer [checklist приёмки и rollback](acceptance.ru.md).

Historical POC commands, addresses и evidence не являются customer defaults;
используйте [verification appendix](../verification/README.md) только для
расследования regression patch.

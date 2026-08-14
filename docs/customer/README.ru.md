# Комплект развертывания для заказчика

Язык: [English](README.md) | [Русский](README.ru.md)

Комплект поставляет Bearer patch для CMDBuild 4.2 и эксплуатационные инструкции
для подготовки собственного окружения заказчика. Это не инструкция по
воспроизведению isolated POC из repository.

Результат работы комплекта — два API paths с авторизацией текущего пользователя:

```text
UI -> BFF -> CMDBuild REST API
OpenWebUI -> native MCP -> CMDBuild REST API
```

Browser SSO CMDBuild, SAML и `OP_CUSTOM` находятся вне scope этой поставки.

### Роли и порядок работ

- Оператор поставки применяет patch и готовит rollback.
- Администратор CMDBuild создаёт local users, groups и grants.
- Администратор IdP выпускает токены и clients.
- Операторы UI/BFF и OpenWebUI подключают свои applications к IdP и MCP.

Выполняйте инструкции по порядку: каждая роль передаёт следующей проверяемые
значения `issuer`, JWKS URL, audience, `sub`, callbacks и group claim.

Используйте [сквозной пример FAM deployment](fam-example.ru.md): он показывает,
как один набор значений проходит от FAM до CMDBuild и OpenWebUI MCP.

1. [Применить patch](deployment.ru.md) к существующему CMDBuild в Tomcat/systemd или Docker/Compose.
2. [Настроить CMDBuild, IdP и приложения](configuration.ru.md): FAM/MFA+ 1.17, ZITADEL, UI+BFF и OpenWebUI native MCP.
3. Выполнить customer [checklist приёмки и rollback](acceptance.ru.md).

Historical POC commands, addresses и evidence не являются customer defaults;
используйте [verification appendix](../verification/README.md) только для
расследования regression patch.

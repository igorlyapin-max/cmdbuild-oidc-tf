# Customer deployment kit

Language: [English](README.md) | [Русский](README.ru.md)

This kit delivers a CMDBuild 4.2 Bearer patch and the operational instructions
to prepare a customer's own environment. It is not a recipe for recreating the
repository's isolated POC.

Supported API paths are:

```text
UI -> BFF -> CMDBuild REST API
OpenWebUI -> native MCP -> CMDBuild REST API
```

CMDBuild browser SSO, SAML and `OP_CUSTOM` are outside this delivery scope.

Follow the guides in order:

1. [Apply the patch](deployment.md) on an existing Tomcat/systemd or Docker/Compose CMDBuild deployment.
2. [Configure CMDBuild, IdP and applications](configuration.md), including FAM/MFA+ 1.17, ZITADEL, UI+BFF and OpenWebUI native MCP.
3. Run the customer [acceptance and rollback checklist](acceptance.md).

Historical POC commands, addresses and evidence are not customer defaults; see
[verification appendix](../verification/README.md) only when investigating a
patch regression.

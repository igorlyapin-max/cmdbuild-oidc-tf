# Сквозной пример FAM deployment

Язык: [English](fam-example.md) | [Русский](fam-example.ru.md)

Это один логически согласованный customer deployment. Все значения fictional:
заказчик заменяет их **как единый набор**, не смешивая с ZITADEL.

| Назначение | Значение в примере | Где используется |
| --- | --- | --- |
| CMDBuild REST API | `https://cmdb.example.org/cmdbuild` | `CMDBUILD_API_BASE_URL`, BFF target |
| FAM issuer | `https://fam.example.org` | claim `iss`, `CMDBUILD_BEARER_ISSUER` |
| FAM JWKS | URL из FAM discovery для issuer | `CMDBUILD_BEARER_JWKS_URL` |
| Resource audience/scope | `cmdbuild-api` | FAM `Audience`, BFF/MCP scope, обе CMDBuild audience variables |
| BFF callback | `https://bff.example.org/oauth/callback` | FAM BFF application |
| OpenWebUI URL | `https://openwebui.example.org` | OpenWebUI base URL |
| MCP server ID | `cmdbuild-mcp` | OpenWebUI MCP connection |
| MCP callback | `https://openwebui.example.org/oauth/clients/mcp:cmdbuild-mcp/callback` | FAM MCP application |
| MCP resource | `https://mcp.example.org` | OpenWebUI protected-resource URL |
| Audit sink | `https://audit.example.org/v1/logs` | `CMDBUILD_BEARER_AUDIT_SINK_URL` |
| Reader/editor `sub` | `fam-reader-001` / `fam-editor-001` | local CMDBuild logins |

FAM administrator получает фактический JWKS URL из discovery metadata. Не
угадывайте URL и не указывайте `client_id` вместо `cmdbuild-api`.

## Пример последовательности

1. Создайте public BFF application: callback `https://bff.example.org/oauth/callback`, `Audience type=Строка`, audience `cmdbuild-api`, `JSON Web Token`, `RS256`.
2. Создайте отдельное public MCP application: callback `https://openwebui.example.org/oauth/clients/mcp:cmdbuild-mcp/callback`, те же audience и algorithm.
3. В CMDBuild создайте local users `fam-reader-001` и `fam-editor-001`, назначьте им группы `reader` и `editor`.
4. В Bearer configuration задайте FAM issuer, discovery JWKS URL и audience `cmdbuild-api`.
5. В OpenWebUI зарегистрируйте resource `https://mcp.example.org` с server ID `cmdbuild-mcp`.

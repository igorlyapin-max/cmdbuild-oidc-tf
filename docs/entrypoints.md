# Entry points and credentials

The table gives every operator entry point. Password values are intentionally never printed; use the indicated secret location or the organization secret store.

| Surface | URL | Login | Password source / status |
|---|---|---|---|
| OpenWebUI | `http://192.168.202.35:8083` | ZITADEL user: `cmdbuild-oidc-tf-admin`, `cmdbuild-oidc-tf-editor`, `cmdbuild-oidc-tf-reader` | POC secret `secrets/zitadel_cmdbuild_oidc_tf_<role>_password`; never print it or enter it in disabled OpenWebUI local auth. SSO is configured. |
| ZITADEL Console | `http://192.168.202.35:8084/ui/console/` | `openwebui-admin` | Existing stack secret: `/home/lsk/projects/ubuntu/openwebui-zitadel/secrets/zitadel_admin_password`. Do not print it. |
| MCP resource | `http://192.168.202.35:8085/mcp` | OAuth access token issued for the individual user | No password at MCP. Native OpenWebUI registration is documented but not yet accepted as runtime evidence. |
| MCP metadata | `http://192.168.202.35:8085/.well-known/oauth-protected-resource/mcp` | none | Read-only discovery endpoint. |
| Direct OIDC BFF analogue | `http://192.168.202.35:18086` | Same ZITADEL test user | Browser goes to ZITADEL. Current BFF client is public PKCE; no static secret is used. |
| Isolated CMDBuild UI | `http://127.0.0.1:18090/cmdbuild/ui` | CMDBuild POC local administrator, only during bootstrap | Create/rotate in isolated CMDBuild. Do not reuse production credentials; this UI is not yet OIDC-only. |
| Isolated CMDBuild REST | `http://127.0.0.1:18090/cmdbuild/services/rest/v3` | forwarded ZITADEL access token | No local password permitted in gateway/BFF. |
| POC diagnostics | `http://127.0.0.1:18100/health`, `/ready`; `http://127.0.0.1:18101/health` | none | Host-local only. |

OpenWebUI maps `cmdbuild_oidc_tf_groups`: `admin` becomes system `admin`; `editor` and `reader` remain system `user` and are synchronized into same-named OpenWebUI groups. OpenWebUI does not auto-sync group memberships for its system administrators, which is expected because they already bypass normal RBAC.

The edge proxy binds `8083`, `8084`, and `8085`; verify those ports are free before startup. The BFF uses public port `18086` directly, by design.

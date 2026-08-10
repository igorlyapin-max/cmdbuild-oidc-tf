# Candidate global-skill updates after POC evidence

POC evidence now exists for OpenWebUI SSO/group sync, native Streamable HTTP MCP authorization, and the CMDBuild negative result. Do **not** promote these notes to global skills yet: native OpenWebUI MCP OAuth registration and CMDBuild user-token acceptance remain incomplete.

1. `mcp-integration-contracts`: add OpenWebUI native MCP OAuth guidance that distinguishes identity continuity from byte-identical SSO-token forwarding, requires protected-resource metadata, and disallows automatic tool enablement.
2. `cmdbuild-integration`: add a CMDBuild OIDC verification checklist separating browser authentication, local-user mapping, REST bearer validation, and per-user grants; document fail-closed outcome when bearer forwarding is unsupported.
3. `embedded-ui-reverse-proxy`: add the direct-BFF/no-reverse-proxy validation pattern where OIDC callback URLs, cookies, and CMDBuild API calls are verified independently.

4. `openwebui`/MCP guidance: OpenWebUI v0.8.0 interprets `OAUTH_GROUPS_CLAIM` as a dot path. Use a flat key such as `cmdbuild_oidc_tf_groups`, not a URL claim containing dots. Set a stable `WEBUI_SECRET_KEY` before configuring OAuth-protected MCP servers; otherwise encrypted OAuth session/client data cannot survive a restart.

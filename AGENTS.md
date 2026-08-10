# cmdbuild-oidc-tf

## Persistent project memory

- Canonical project ID: `cmdbuild-oidc-tf`; this is an intentionally local, non-Git workspace.
- Retrieve `memora_project_cmdbuild_oidc_tf` first. Use `memora_global` only for relevant reusable domain knowledge.
- All project memories use `scope=project`, `project=cmdbuild-oidc-tf`, project-prefixed tags, and selective durable facts only.
- Do not store secrets, tokens, credentials, transient outputs, or speculative implementation claims.
- Current workspace files and authoritative documentation override stale memories; search for duplicates before creating or superseding a memory.

## Experiment scope

- Validate application authorization through the zatadel identity provider with OpenWebUI, CMDBuild, and MCP accessed from OpenWebUI.
- Evaluate OIDC flows, including token forwarding and applications that consume the `group` claim.

## Project-local knowledge

- Use `.agents/skills` for fragile POC procedures. Select the smallest matching skill; read its `SKILL.md` before the linked reference files.
- Use `cmdbuild-oidc-no-proxy` for a CMDBuild OIDC, direct-BFF, bearer-forwarding, or reverse-proxy-removal decision.
- Keep durable POC evidence in `docs/`; never record credentials, raw tokens, cookies, authorization headers, or unredacted logs in skills or docs.

# Naming and state migration: `idpTest` to `cmdbuild-oidc-tf`

Performed on 2026-08-10. This record is the sole local reference to the former POC identifiers; it exists to define rollback, not to provide a legacy runtime alias.

## Active identity

- Workspace: `/home/lsk/projects/cmdbuild-oidc-tf`.
- Compose project and images: `cmdbuild-oidc-tf`.
- Persistent active volumes: `cmdbuild-oidc-tf_cmdbuild_db` and `cmdbuild-oidc-tf_logs`.
- Database: `cmdbuild_oidc_tf`.
- ZITADEL users: `cmdbuild-oidc-tf-admin`, `cmdbuild-oidc-tf-editor`, `cmdbuild-oidc-tf-reader`.
- Flat group claim: `cmdbuild_oidc_tf_groups`; immutable user mapping claim remains `cmdbuild_username`.

## Preserved rollback snapshot

- The old stopped containers, images and named volumes prefixed `idp-test` were not removed.
- A logical custom-format PostgreSQL dump was verified and stored only in Docker volume `cmdbuild-oidc-tf_migration_backup`; its contents must not be printed or copied to documentation.
- The old audit volume is preserved and its redacted JSONL was copied into the new active log volume.
- Old ZITADEL users, applications and Action are retained but are not valid active entry points after cutover.

## Cleanup boundary

Do not delete the rollback containers, images, volumes, dump or ZITADEL objects until the new-user browser validation, MCP registration and group synchronization are accepted. Cleanup is a separate explicit operation. No legacy hostname, cookie, claim, login or Docker resource is supported by the active POC.

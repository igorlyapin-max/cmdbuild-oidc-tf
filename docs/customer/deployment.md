# Apply the CMDBuild Bearer patch

Language: [English](deployment.md) | [Русский](deployment.ru.md)

## Preconditions

The patch applies only to CMDBuild `4.2.0`. Before the change, name the change
and rollback owners, restore-test the database backup, record the running
WAR/image digest and authentication configuration, and prepare the previous
artifact for rollback. Build in approved CI, never on the production host.

```bash
npm run verify:cmdbuild-bearer-artifact
scripts/build-cmdbuild-bearer-war.sh
sha256sum -c artifacts/cmdbuild-4.2.0-bearer.1.war.sha256
```

Store the Git revision, vendor-source SHA-256, patch SHA-256 and resulting WAR
checksum or immutable image digest in the change record. Do not accept a
mutable registry tag as artifact identity.

## Tomcat / systemd

Stop CMDBuild, then run the atomic helper. It refuses an active service,
verifies the checksum and retains the prior WAR in `backup/`.

```bash
CMDBUILD_HOME=/opt/cmdbuild/tomcat/webapps \
CMDBUILD_SERVICE=cmdbuild \
CMDBUILD_PATCH_WAR=/secure/artifacts/cmdbuild-4.2.0-bearer.1.war \
CMDBUILD_PATCH_WAR_SHA256=/secure/artifacts/cmdbuild-4.2.0-bearer.1.war.sha256 \
  scripts/apply-existing-cmdbuild-patch.sh
systemctl start cmdbuild
```

Verify health and the deployed checksum before changing identity settings. To
rollback, stop the service, run `scripts/rollback-existing-cmdbuild-patch.sh`
with the same `CMDBUILD_HOME` and `CMDBUILD_SERVICE`, start CMDBuild, then
restore the approved authentication snapshot.

## Docker / Compose

Promote an approved immutable image digest. Change only the CMDBuild `image:`
reference in the customer's deployment manifest; preserve database and
application volumes; recreate only the CMDBuild workload. Verify the running
digest and health/readiness endpoint. On failure restore the preceding digest
and the configuration snapshot. The repository `compose.yml` uses `build:` and
host networking for verification only; it is not a customer manifest.

Continue with [configuration](configuration.md) only after the patched runtime
is healthy.

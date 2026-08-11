#!/bin/sh
set -eu

: "${CMDBUILD_HOME:?Set CMDBUILD_HOME to the stopped CMDBuild/Tomcat webapps directory}"
: "${CMDBUILD_SERVICE:?Set CMDBUILD_SERVICE to the systemd unit name}"
WAR=${CMDBUILD_PATCH_WAR:-"$(pwd)/artifacts/cmdbuild-4.2.0-bearer.1.war"}
WAR_SHA256=${CMDBUILD_PATCH_WAR_SHA256:-"$WAR.sha256"}
TARGET="$CMDBUILD_HOME/cmdbuild.war"
BACKUP="$CMDBUILD_HOME/backup/cmdbuild-4.2.0-$(date +%Y%m%d%H%M%S).war"

test -r "$WAR"
test -r "$WAR_SHA256"
sha256sum -c "$WAR_SHA256" >/dev/null
systemctl is-active --quiet "$CMDBUILD_SERVICE" && { echo "Refusing: stop $CMDBUILD_SERVICE first" >&2; exit 1; }
test -e "$TARGET" || { echo "Refusing: expected $TARGET" >&2; exit 1; }
mkdir -p "$(dirname "$BACKUP")"
cp --preserve=mode,ownership,timestamps "$TARGET" "$BACKUP"
install -m 0644 "$WAR" "$TARGET.new"
mv -f "$TARGET.new" "$TARGET"
printf '%s\n' "$BACKUP" > "$CMDBUILD_HOME/.cmdbuild-oidc-tf-last-backup"
echo "Applied verified WAR. Start $CMDBUILD_SERVICE, verify health and direct-user API, then retain $BACKUP for rollback."

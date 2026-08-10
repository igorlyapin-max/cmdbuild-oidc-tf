#!/bin/sh
set -eu

: "${CMDBUILD_HOME:?Set CMDBUILD_HOME}"
: "${CMDBUILD_SERVICE:?Set CMDBUILD_SERVICE}"
TARGET="$CMDBUILD_HOME/cmdbuild.war"
BACKUP=${CMDBUILD_PATCH_BACKUP:-"$(cat "$CMDBUILD_HOME/.cmdbuild-oidc-tf-last-backup")"}

test -r "$BACKUP"
systemctl is-active --quiet "$CMDBUILD_SERVICE" && { echo "Refusing: stop $CMDBUILD_SERVICE first" >&2; exit 1; }
install -m 0644 "$BACKUP" "$TARGET.new"
mv -f "$TARGET.new" "$TARGET"
echo "Rollback staged from $BACKUP. Start $CMDBUILD_SERVICE and verify stock health."

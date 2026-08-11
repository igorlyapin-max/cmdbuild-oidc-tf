#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE=${CMDBUILD_BEARER_BUILD_IMAGE:-cmdbuild-oidc-tf-cmdbuild-build:4.2.0-bearer.1}
OUT=${CMDBUILD_BEARER_ARTIFACT_DIR:-"$ROOT/artifacts"}
EXPORT_NAME="cmdbuild-oidc-tf-war-export-$$-$(date +%s)"

mkdir -p "$OUT"
docker build --target build -f "$ROOT/compose/Dockerfile.cmdbuild-bearer" -t "$IMAGE" "$ROOT"
trap 'docker rm -f "$EXPORT_NAME" >/dev/null 2>&1 || true' EXIT
docker create --name "$EXPORT_NAME" "$IMAGE" >/dev/null
docker cp "$EXPORT_NAME":/src/cmdbuild/target/cmdbuild.war "$OUT/cmdbuild-4.2.0-bearer.1.war"
sha256sum "$OUT/cmdbuild-4.2.0-bearer.1.war" > "$OUT/cmdbuild-4.2.0-bearer.1.war.sha256"

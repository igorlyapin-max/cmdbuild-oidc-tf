#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
IMAGE=${CMDBUILD_BEARER_BUILD_IMAGE:-cmdbuild-oidc-tf-cmdbuild-build:4.2.0-bearer.1}
OUT=${CMDBUILD_BEARER_ARTIFACT_DIR:-"$ROOT/artifacts"}

mkdir -p "$OUT"
docker build --target build -f "$ROOT/compose/Dockerfile.cmdbuild-bearer" -t "$IMAGE" "$ROOT"
docker create --name cmdbuild-oidc-tf-war-export "$IMAGE" >/dev/null
trap 'docker rm -f cmdbuild-oidc-tf-war-export >/dev/null 2>&1 || true' EXIT
docker cp cmdbuild-oidc-tf-war-export:/src/cmdbuild/target/cmdbuild.war "$OUT/cmdbuild-4.2.0-bearer.1.war"
sha256sum "$OUT/cmdbuild-4.2.0-bearer.1.war" > "$OUT/cmdbuild-4.2.0-bearer.1.war.sha256"

#!/bin/sh
# Entrypoint of the seaweedfs service (R0.5, architecture decision record (ADR) 0019). SeaweedFS reads its S3 (Simple Storage Service)
# identities from a static JSON (JavaScript Object Notation) file and expands no environment variables in
# it, so this script renders the read-only template s3-identities.json with the credentials from .env into
# a writable path, then starts SeaweedFS in single-server mode: master, volume server, filer and the S3
# gateway in one process over the one /data volume.
#
# Identity model (02 section 6.4, O-28): admin holds every action on every bucket and is used only by the
# bucket-init one-shot and the smoke script; library holds Read, Write, List and Tagging on the bucket
# library only; reference-private holds the same four actions on the bucket reference-private only. A
# bucket-scoped action is written Action:bucket in the SeaweedFS identity file.
set -eu

TEMPLATE=/etc/seaweedfs/s3-identities.json
RENDERED=/tmp/s3-identities.json
ADVERTISED_IP="${SEAWEEDFS_ADVERTISED_HOST:-seaweedfs}"

set --
for name in S3_ADMIN_ACCESS_KEY S3_ADMIN_SECRET_KEY \
            S3_LIBRARY_ACCESS_KEY S3_LIBRARY_SECRET_KEY \
            S3_REFERENCE_ACCESS_KEY S3_REFERENCE_SECRET_KEY; do
  eval "value=\${$name:-}"
  if [ -z "$value" ]; then
    echo "seaweedfs start: $name is not set; the Compose file passes it from .env" >&2
    exit 1
  fi
  # The value becomes a sed replacement and a JSON string, so only characters that need no escaping in
  # either are accepted; the generated .env uses hex and .env.example uses change-me-<name>.
  case "$value" in
    *[!A-Za-z0-9_-]*)
      echo "seaweedfs start: $name may contain only letters, digits, - and _" >&2
      exit 1
      ;;
  esac
  set -- "$@" -e "s|__${name}__|${value}|g"
done

sed "$@" "$TEMPLATE" > "$RENDERED"
if grep -q '__S3_' "$RENDERED"; then
  echo "seaweedfs start: a placeholder in $TEMPLATE was not rendered" >&2
  exit 1
fi

# -ip is the name the other containers and the in-process volume server reach this one by (the Compose
# service name or its network alias); -ip.bind=0.0.0.0 also answers on loopback for the health check.
exec weed server \
  -ip="$ADVERTISED_IP" \
  -ip.bind=0.0.0.0 \
  -dir=/data \
  -filer \
  -s3 \
  -s3.port=8333 \
  -s3.config="$RENDERED"

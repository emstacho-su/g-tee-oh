#!/bin/sh
# One-shot bucket-init service (R0.5, 02 section 6.4): waits for the S3 (Simple Storage Service) gateway,
# then creates the buckets library and reference-private with the admin identity so "just dev-up" leaves
# both present. curl signs every request with Amazon Web Services (AWS) Signature Version 4 (SigV4), the
# scheme the SeaweedFS gateway verifies, so no S3 client library is needed. An HTTP (Hypertext Transfer
# Protocol) HEAD first keeps the script idempotent: a bucket that already exists is reported and left
# alone, and only a 404 leads to a PUT.
set -eu

ENDPOINT="${S3_INTERNAL_ENDPOINT:-http://seaweedfs:8333}"
AUTH="${S3_ADMIN_ACCESS_KEY:?S3_ADMIN_ACCESS_KEY is not set}:${S3_ADMIN_SECRET_KEY:?S3_ADMIN_SECRET_KEY is not set}"
SIGV4="aws:amz:us-east-1:s3"
MAX_TRIES=30

# The health check on seaweedfs already gates this service; the loop covers a restart race.
tries=0
until curl -s -o /dev/null "$ENDPOINT/"; do
  tries=$((tries + 1))
  if [ "$tries" -ge "$MAX_TRIES" ]; then
    echo "bucket-init: the S3 gateway at $ENDPOINT did not answer after $MAX_TRIES tries" >&2
    exit 1
  fi
  sleep 1
done

status_of() {
  curl -s -o /dev/null -w '%{http_code}' --aws-sigv4 "$SIGV4" --user "$AUTH" "$@"
}

for bucket in library reference-private; do
  code=$(status_of -I "$ENDPOINT/$bucket")
  case "$code" in
    200)
      echo "bucket-init: $bucket present"
      ;;
    404)
      code=$(status_of -X PUT "$ENDPOINT/$bucket")
      if [ "$code" != "200" ]; then
        echo "bucket-init: creating $bucket returned HTTP $code" >&2
        exit 1
      fi
      echo "bucket-init: $bucket created"
      ;;
    *)
      echo "bucket-init: HEAD $bucket returned HTTP $code" >&2
      exit 1
      ;;
  esac
done

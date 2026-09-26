#!/bin/sh
# Runs automatically once LocalStack's S3 service is ready (LocalStack init-hooks).
# Creates the dev uploads bucket. Deliberately PRIVATE, not public-read: this
# bucket holds payment proof screenshots alongside anything else the API
# stores, and every access goes through StorageService's presigned URLs
# (time-limited, generated on demand for an authorized staff/customer
# request) rather than a permanently guessable public URL.
set -e

BUCKET="${S3_BUCKET:-sqlm-uploads}"

awslocal s3 mb "s3://${BUCKET}" || true

echo "[localstack-init] bucket ${BUCKET} ready (private)"

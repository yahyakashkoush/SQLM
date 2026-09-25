#!/bin/sh
# Runs automatically once LocalStack's S3 service is ready (LocalStack init-hooks).
# Creates and public-reads the dev uploads bucket so the API doesn't have to.
set -e

BUCKET="${S3_BUCKET:-sqlm-uploads}"

awslocal s3 mb "s3://${BUCKET}" || true
awslocal s3api put-bucket-policy --bucket "${BUCKET}" --policy '{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::'"${BUCKET}"'/*"
  }]
}'

echo "[localstack-init] bucket ${BUCKET} ready"

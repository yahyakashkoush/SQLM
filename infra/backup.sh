#!/usr/bin/env bash
# Database backup script for SQLM.
#
# Usage (cron, daily at 03:00):
#   0 3 * * * /opt/sqlm/infra/backup.sh >> /var/log/sqlm-backup.log 2>&1
#
# Environment variables (read from /opt/sqlm/.env if present):
#   DATABASE_URL    — postgres DSN (required)
#   BACKUP_DIR      — local directory to write dumps (default: /opt/sqlm/backups)
#   BACKUP_RETAIN   — number of local daily dumps to keep (default: 7)
#   BACKUP_S3_BUCKET — S3/MinIO bucket for off-server retention (optional, e.g. s3://my-bucket/sqlm)
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION — if using S3
#   S3_ENDPOINT_URL — set for MinIO / compatible S3 (e.g. https://minio.example.com)
#
# Restore test (dry-run, no data written):
#   BACKUP_RESTORE_TEST=1 /opt/sqlm/infra/backup.sh
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/sqlm/.env}"
[ -f "$ENV_FILE" ] && set -a && source "$ENV_FILE" && set +a

BACKUP_DIR="${BACKUP_DIR:-/opt/sqlm/backups}"
BACKUP_RETAIN="${BACKUP_RETAIN:-7}"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
DUMP_FILE="$BACKUP_DIR/sqlm_${TIMESTAMP}.dump"

say() { printf '\n[%s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { printf '[%s] ERROR: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; exit 1; }

[ -n "${DATABASE_URL:-}" ] || die "DATABASE_URL is not set"

mkdir -p "$BACKUP_DIR"

# ── 1. pg_dump (custom format, compressed) ──────────────────────────────────
say "Dumping database to $DUMP_FILE"
docker exec sqlm-postgres pg_dump \
  --format=custom \
  --compress=9 \
  --no-password \
  --dbname="$DATABASE_URL" \
  > "$DUMP_FILE" \
  || (say "docker exec failed, trying pg_dump directly"; \
      pg_dump --format=custom --compress=9 --dbname="$DATABASE_URL" > "$DUMP_FILE")

DUMP_SIZE=$(du -sh "$DUMP_FILE" | cut -f1)
say "Dump complete: $DUMP_SIZE"

# ── 2. Restore test ─────────────────────────────────────────────────────────
if [ "${BACKUP_RESTORE_TEST:-0}" = "1" ]; then
  say "Running restore test (pg_restore --list only, no data written)"
  pg_restore --list "$DUMP_FILE" | wc -l | xargs printf '%s objects listed in dump\n'
  say "Restore test PASSED"
fi

# ── 3. Off-server retention — S3 / MinIO ────────────────────────────────────
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  say "Uploading to $BACKUP_S3_BUCKET"
  S3_ARGS=()
  [ -n "${S3_ENDPOINT_URL:-}" ] && S3_ARGS+=(--endpoint-url "$S3_ENDPOINT_URL")
  aws s3 cp "${S3_ARGS[@]}" "$DUMP_FILE" "${BACKUP_S3_BUCKET}/$(basename "$DUMP_FILE")"
  say "Upload complete"
fi

# ── 4. Prune old local dumps ─────────────────────────────────────────────────
say "Pruning local dumps older than $BACKUP_RETAIN days"
find "$BACKUP_DIR" -name 'sqlm_*.dump' -type f \
  | sort \
  | head -n "-${BACKUP_RETAIN}" \
  | xargs -r rm -v

say "Backup finished: $DUMP_FILE"

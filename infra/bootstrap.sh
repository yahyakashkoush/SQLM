#!/usr/bin/env bash
# One-command install/update of SQLM on a fresh Ubuntu server:
#
#   curl -fsSL https://raw.githubusercontent.com/yahyakashkoush/SQLM/claude/gifted-pasteur-kpxp3n/infra/bootstrap.sh | bash
#
# Safe to re-run: an existing .env and database are kept, the code is
# updated and the stack rebuilt. Secrets are generated on the server or typed
# here; none of them ever touch the repository.
set -euo pipefail

REPO_URL="https://github.com/yahyakashkoush/SQLM.git"
BRANCH="${SQLM_BRANCH:-claude/gifted-pasteur-kpxp3n}"
DIR="/opt/sqlm"
ENV_FILE="$DIR/.env"
COMPOSE=(sudo docker compose -f "$DIR/docker-compose.prod.yml" --project-directory "$DIR")

say() { printf '\n\033[1;36m>>> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!!! %s\033[0m\n' "$*"; }
ask() { local v; read -r -p "$1" v </dev/tty; printf '%s' "$v"; }
rand_hex() { openssl rand -hex "$1"; }

# --- 1. System packages -------------------------------------------------------
say "Installing Docker, Git and tools"
export DEBIAN_FRONTEND=noninteractive
sudo apt-get update -y -q
sudo apt-get install -y -q git curl openssl ca-certificates
if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get install -y -q docker.io docker-compose-v2 docker-buildx \
    || curl -fsSL https://get.docker.com | sudo sh
fi
if ! sudo docker compose version >/dev/null 2>&1; then
  sudo apt-get install -y -q docker-compose-v2 docker-buildx \
    || curl -fsSL https://get.docker.com | sudo sh
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER" || true

# Next.js builds are memory hungry; small instances need swap or the build is OOM-killed.
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 6000000 ] && [ "$(swapon --show | wc -l)" -eq 0 ]; then
  say "Adding 4G swap"
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# --- 2. Code ----------------------------------------------------------------
say "Fetching code ($BRANCH)"
sudo mkdir -p "$DIR"
sudo chown -R "$USER:$USER" "$DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$DIR" checkout -B "$BRANCH" FETCH_HEAD
  git -C "$DIR" reset --hard FETCH_HEAD
else
  git clone --depth 1 -b "$BRANCH" "$REPO_URL" "$DIR"
fi
echo "Deploying commit $(git -C "$DIR" rev-parse --short HEAD)"

# --- 3. Environment -----------------------------------------------------------
OWNER_EMAIL=""
OWNER_PASSWORD=""
if [ -f "$ENV_FILE" ]; then
  say "Keeping existing $ENV_FILE"
else
  say "First install — a few questions (Enter accepts the [default])"
  DOMAIN=$(ask "Main domain [subsc.tech]: "); DOMAIN=${DOMAIN:-subsc.tech}
  BOT_TOKEN=""
  while [ -z "$BOT_TOKEN" ]; do BOT_TOKEN=$(ask "Telegram bot token (from @BotFather): "); done
  ACME=$(ask "Email for SSL certificates [yahyaemad999@gmail.com]: "); ACME=${ACME:-yahyaemad999@gmail.com}
  OWNER_EMAIL=$(ask "Admin dashboard login email [$ACME]: "); OWNER_EMAIL=${OWNER_EMAIL:-$ACME}
  while :; do
    OWNER_PASSWORD=$(ask "Admin dashboard password (10+ characters): ")
    [ ${#OWNER_PASSWORD} -ge 10 ] && break
    warn "That was ${#OWNER_PASSWORD} characters — use at least 10."
  done
  echo "Crypto auto-confirm keys (read-only). Press Enter to skip any of them."
  BINANCE_KEY=$(ask "  Binance API key: ")
  BINANCE_SECRET=$( [ -n "$BINANCE_KEY" ] && ask "  Binance API secret: " || true)
  BYBIT_KEY=$(ask "  Bybit API key: ")
  BYBIT_SECRET=$( [ -n "$BYBIT_KEY" ] && ask "  Bybit API secret: " || true)

  DB_PASS=$(rand_hex 24)
  WEBHOOK_SECRET=$(rand_hex 24)
  umask 077
  cat >"$ENV_FILE" <<EOF
NODE_ENV=production

POSTGRES_USER=sqlm
POSTGRES_PASSWORD=$DB_PASS
POSTGRES_DB=sqlm
DATABASE_URL=postgresql://sqlm:$DB_PASS@postgres:5432/sqlm?schema=public&connection_limit=10&pool_timeout=20

REDIS_PASSWORD=$(rand_hex 24)

JWT_ACCESS_SECRET=$(rand_hex 48)
JWT_REFRESH_SECRET=$(rand_hex 48)
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
INVENTORY_ENCRYPTION_KEY=$(rand_hex 32)

TELEGRAM_BOT_TOKEN=$BOT_TOKEN
TELEGRAM_WEBHOOK_SECRET=$WEBHOOK_SECRET
TELEGRAM_WEBHOOK_URL=https://api.$DOMAIN/api/v1/telegram/webhook/$WEBHOOK_SECRET

BINANCE_API_KEY=$BINANCE_KEY
BINANCE_API_SECRET=$BINANCE_SECRET
BYBIT_API_KEY=$BYBIT_KEY
BYBIT_API_SECRET=$BYBIT_SECRET

# Blank S3 = uploads stored on the server's "uploads" Docker volume.
S3_ENDPOINT=

WEB_DOMAIN=$DOMAIN
API_DOMAIN=api.$DOMAIN
ADMIN_DOMAIN=admin.$DOMAIN
MINIAPP_DOMAIN=app.$DOMAIN
PUBLIC_API_URL=https://api.$DOMAIN
MINIAPP_URL=https://app.$DOMAIN
CORS_ORIGINS=https://$DOMAIN,https://admin.$DOMAIN,https://app.$DOMAIN
ACME_EMAIL=$ACME

LOG_LEVEL=info
RATE_LIMIT_MAX=120
AUTH_RATE_LIMIT_MAX=5
ORDER_EXPIRY_MINUTES=1440
EOF
  umask 022
  echo "Saved $ENV_FILE (readable by you only)."
  echo "IMPORTANT: back this file up somewhere safe — INVENTORY_ENCRYPTION_KEY decrypts your stock codes."
fi

# --- 4. Build and start -------------------------------------------------------
say "Building and starting (first build takes 5–15 minutes)"
"${COMPOSE[@]}" up -d --build --remove-orphans

say "Waiting for the API to become ready"
ready=0
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T api node -e "fetch('http://127.0.0.1:4000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ready=1; break
  fi
  sleep 5
done
if [ "$ready" -ne 1 ]; then
  "${COMPOSE[@]}" ps
  "${COMPOSE[@]}" logs --tail 80 migrate api
  warn "API did not become ready — send the output above."
  exit 1
fi
echo "API is ready."

# --- 5. Admin account ---------------------------------------------------------
if [ -n "$OWNER_EMAIL" ]; then
  say "Creating admin account $OWNER_EMAIL"
  "${COMPOSE[@]}" exec -T -w /repo/apps/api -e OWNER_EMAIL="$OWNER_EMAIL" -e OWNER_PASSWORD="$OWNER_PASSWORD" api node -e "
    const { PrismaClient } = require('@prisma/client');
    const argon2 = require('argon2');
    const prisma = new PrismaClient();
    (async () => {
      const email = process.env.OWNER_EMAIL.trim();
      const passwordHash = await argon2.hash(process.env.OWNER_PASSWORD);
      await prisma.staff.upsert({
        where: { email },
        update: { passwordHash, role: 'OWNER', status: 'ACTIVE' },
        create: { email, passwordHash, name: 'Owner', role: 'OWNER', status: 'ACTIVE' },
      });
      console.log('Admin account ready: ' + email);
    })().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.\$disconnect());
  "
fi

# --- 6. DNS check -------------------------------------------------------------
envget() { grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2-; }
WEB_DOMAIN=$(envget WEB_DOMAIN); API_DOMAIN=$(envget API_DOMAIN)
ADMIN_DOMAIN=$(envget ADMIN_DOMAIN); MINIAPP_DOMAIN=$(envget MINIAPP_DOMAIN)
PUBLIC_IP=$(curl -fsS --max-time 5 https://checkip.amazonaws.com || true)
say "DNS check (this server is ${PUBLIC_IP:-unknown})"
dns_ok=1
for host in "$WEB_DOMAIN" "$API_DOMAIN" "$ADMIN_DOMAIN" "$MINIAPP_DOMAIN"; do
  resolved=$(getent ahostsv4 "$host" | awk 'NR==1 {print $1}')
  if [ -n "$PUBLIC_IP" ] && [ "$resolved" = "$PUBLIC_IP" ]; then
    echo "  OK    $host -> $resolved"
  else
    echo "  FIX   $host -> ${resolved:-nothing}   (must be $PUBLIC_IP)"
    dns_ok=0
  fi
done
if [ "$dns_ok" -ne 1 ]; then
  warn "Point the A records above to $PUBLIC_IP at your domain registrar."
  warn "SSL and the Telegram bot start working by themselves once DNS updates — no need to re-run."
fi

"${COMPOSE[@]}" ps
cat <<EOF

============================================================
  Done.
    Store:      https://$WEB_DOMAIN
    Admin:      https://$ADMIN_DOMAIN
    Mini App:   https://$MINIAPP_DOMAIN
    API:        https://$API_DOMAIN

  Update later:  curl -fsSL https://raw.githubusercontent.com/yahyakashkoush/SQLM/$BRANCH/infra/bootstrap.sh | bash
  Logs:          sudo docker compose -f $DIR/docker-compose.prod.yml logs -f api worker
============================================================
EOF

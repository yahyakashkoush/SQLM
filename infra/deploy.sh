#!/usr/bin/env bash
set -euo pipefail

# ============================================================================
# SQLM — EC2 Deployment Script
# Run this ON the EC2 instance (i-0c56acfe2826ef2ea / subsc.tech)
#
# Prerequisites on the EC2 instance:
#   - Docker + Docker Compose v2 installed
#   - Git installed
#   - Ports 80 and 443 open in the security group
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
# ============================================================================

REPO_URL="https://github.com/yahyakashkoush/sqlm.git"
BRANCH="claude/gifted-pasteur-kpxp3n"
DEPLOY_DIR="/opt/sqlm"
ENV_FILE="$DEPLOY_DIR/.env"

echo "=== SQLM Deployment ==="

# --- 1. Install Docker if missing ---
if ! command -v docker &>/dev/null; then
  echo ">>> Installing Docker..."
  sudo yum update -y 2>/dev/null || sudo apt-get update -y
  sudo yum install -y docker 2>/dev/null || sudo apt-get install -y docker.io
  sudo systemctl enable docker
  sudo systemctl start docker
  sudo usermod -aG docker "$USER"
  echo "Docker installed. You may need to log out and back in for group changes."
fi

# --- 2. Install Docker Compose plugin if missing ---
if ! docker compose version &>/dev/null; then
  echo ">>> Installing Docker Compose plugin..."
  DOCKER_CONFIG=${DOCKER_CONFIG:-$HOME/.docker}
  mkdir -p "$DOCKER_CONFIG/cli-plugins"
  COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name"' | head -1 | cut -d'"' -f4)
  sudo curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-$(uname -m)" \
    -o /usr/local/lib/docker/cli-plugins/docker-compose 2>/dev/null || \
  curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-$(uname -m)" \
    -o "$DOCKER_CONFIG/cli-plugins/docker-compose"
  sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose 2>/dev/null || \
  chmod +x "$DOCKER_CONFIG/cli-plugins/docker-compose"
  echo "Docker Compose installed."
fi

# --- 3. Install Git if missing ---
if ! command -v git &>/dev/null; then
  echo ">>> Installing Git..."
  sudo yum install -y git 2>/dev/null || sudo apt-get install -y git
fi

# --- 4. Clone or update the repo ---
if [ -d "$DEPLOY_DIR/.git" ]; then
  echo ">>> Updating existing clone..."
  cd "$DEPLOY_DIR"
  git fetch origin "$BRANCH"
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  echo ">>> Cloning repository..."
  sudo mkdir -p "$DEPLOY_DIR"
  sudo chown "$USER:$USER" "$DEPLOY_DIR"
  git clone -b "$BRANCH" "$REPO_URL" "$DEPLOY_DIR"
  cd "$DEPLOY_DIR"
fi

# --- 5. Check for .env ---
if [ ! -f "$ENV_FILE" ]; then
  echo ""
  echo "========================================================"
  echo "  .env file not found at $ENV_FILE"
  echo "  Creating template — you MUST edit it before continuing."
  echo "========================================================"
  cat > "$ENV_FILE" << 'ENVEOF'
# ============================================================================
# SQLM Production Environment — subsc.tech
# EDIT ALL VALUES MARKED "CHANGE-ME" BEFORE DEPLOYING
# ============================================================================

NODE_ENV=production

# --- Database ---
POSTGRES_USER=sqlm
POSTGRES_PASSWORD=CHANGE-ME-strong-db-password
POSTGRES_DB=sqlm
DATABASE_URL=postgresql://sqlm:CHANGE-ME-strong-db-password@postgres:5432/sqlm?schema=public&connection_limit=10&pool_timeout=20

# --- Redis ---
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=CHANGE-ME-redis-password

# --- Auth (generate with: openssl rand -base64 48) ---
JWT_ACCESS_SECRET=CHANGE-ME-access-secret-min-32-chars
JWT_REFRESH_SECRET=CHANGE-ME-refresh-secret-min-32-chars
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d

# --- Encryption (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") ---
INVENTORY_ENCRYPTION_KEY=CHANGE-ME-64-hex-chars

# --- Telegram ---
TELEGRAM_BOT_TOKEN=CHANGE-ME-your-bot-token
TELEGRAM_WEBHOOK_SECRET=CHANGE-ME-webhook-secret
TELEGRAM_WEBHOOK_URL=https://api.subsc.tech/api/v1/telegram/webhook/CHANGE-ME-webhook-secret

# --- S3-compatible storage (MinIO, AWS S3, etc.) ---
S3_ENDPOINT=CHANGE-ME-s3-endpoint
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=CHANGE-ME
S3_SECRET_ACCESS_KEY=CHANGE-ME
S3_BUCKET=sqlm-uploads
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=CHANGE-ME

# --- CORS ---
CORS_ORIGINS=https://subsc.tech,https://admin.subsc.tech,https://app.subsc.tech

# --- Rate limiting ---
RATE_LIMIT_MAX=120
AUTH_RATE_LIMIT_MAX=5

# --- Domains (Caddy TLS) ---
PUBLIC_API_URL=https://api.subsc.tech
API_DOMAIN=api.subsc.tech
ADMIN_DOMAIN=admin.subsc.tech
MINIAPP_DOMAIN=app.subsc.tech
WEB_DOMAIN=subsc.tech
ACME_EMAIL=yahyaemad999@gmail.com
MINIAPP_URL=https://app.subsc.tech

# --- Observability ---
LOG_LEVEL=info
SENTRY_DSN=

# --- Orders ---
ORDER_EXPIRY_MINUTES=1440
ENVEOF

  echo ""
  echo "Template created at $ENV_FILE"
  echo "Edit it now:  nano $ENV_FILE"
  echo "Then re-run:  ./deploy.sh"
  exit 1
fi

# --- 6. Validate that no CHANGE-ME values remain ---
if grep -q "CHANGE-ME" "$ENV_FILE"; then
  echo ""
  echo "========================================================"
  echo "  ERROR: .env still contains CHANGE-ME placeholders."
  echo "  Edit $ENV_FILE and replace all CHANGE-ME values."
  echo "========================================================"
  grep --color=always "CHANGE-ME" "$ENV_FILE" || true
  exit 1
fi

# --- 7. Deploy ---
echo ">>> Building and starting all services..."
cd "$DEPLOY_DIR"
docker compose -f docker-compose.prod.yml up -d --build

echo ""
echo ">>> Waiting for services to be healthy..."
sleep 10

# --- 8. Health check ---
echo ">>> Checking service health..."
docker compose -f docker-compose.prod.yml ps

echo ""
echo ">>> Testing API readiness..."
for i in 1 2 3 4 5; do
  if curl -fsS http://localhost:4000/api/health/ready 2>/dev/null; then
    echo ""
    echo "API is ready!"
    break
  fi
  echo "Attempt $i/5 — waiting 10s..."
  sleep 10
done

echo ""
echo "============================================"
echo "  Deployment complete!"
echo ""
echo "  Caddy will auto-provision TLS certificates"
echo "  once DNS records point to this server."
echo ""
echo "  Your sites:"
echo "    https://subsc.tech        (website)"
echo "    https://api.subsc.tech    (API)"
echo "    https://admin.subsc.tech  (admin dashboard)"
echo "    https://app.subsc.tech    (Telegram mini app)"
echo "============================================"

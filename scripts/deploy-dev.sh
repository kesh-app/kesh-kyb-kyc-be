#!/usr/bin/env bash
# deploy-dev.sh — deploy kesh-kyb-kyc-be to development server
# Run as the app user (NOT root), e.g.: bash scripts/deploy-dev.sh

set -e

# ── Config — edit these to match your server ─────────────────
APP_DIR=/var/www/kesh-kyb-kyc-be
APP_NAME=kesh-kyb-kyc-be-dev
# ─────────────────────────────────────────────────────────────

echo "==> [1/7] Entering project directory"
cd "$APP_DIR"

echo "==> [2/7] Pulling latest code"
git pull

echo "==> [3/7] Installing dependencies"
npm ci

echo "==> [4/7] Building application"
npm run build

echo "==> [5/7] Running database migrations"
npm run db:migrate

echo "==> [6/7] Ensuring runtime directories exist"
mkdir -p uploads logs

echo "==> [7/7] Starting / restarting PM2 process"
pm2 startOrRestart ecosystem.config.cjs --env development

pm2 save

echo ""
echo "==> Deploy complete. PM2 status:"
pm2 status "$APP_NAME"

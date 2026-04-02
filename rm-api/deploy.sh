#!/bin/bash
# ── deploy.sh — Script de déploiement Risk Manager API
# Usage : ./deploy.sh [production|staging]
# Prérequis : Node.js 20+, PM2, accès SSH au VPS Infomaniak

set -euo pipefail

ENV=${1:-production}
APP_DIR="/var/www/riskmanager-api"
REPO="git@github.com:olivier438/RiskManager.git"
BRANCH="main"

echo "▶ Deploying Risk Manager API — ENV: $ENV"

# 1. Pull dernière version
echo "▶ Pulling latest code..."
cd "$APP_DIR"
git fetch origin
git reset --hard origin/$BRANCH

# 2. Installer les dépendances (prod uniquement)
echo "▶ Installing dependencies..."
npm ci --omit=dev

# 3. Vérifier que .env existe
if [ ! -f ".env" ]; then
  echo "✗ ERROR: .env file not found. Copy .env.example and fill values."
  exit 1
fi

# 4. Créer le dossier logs si inexistant
mkdir -p logs

# 5. Reload PM2 sans downtime (cluster mode)
echo "▶ Reloading PM2..."
pm2 reload ecosystem.config.js --env "$ENV" --update-env

# 6. Vérifier que l'API répond
echo "▶ Health check..."
sleep 3
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health)
if [ "$STATUS" != "200" ]; then
  echo "✗ ERROR: Health check failed (HTTP $STATUS). Rolling back..."
  pm2 reload ecosystem.config.js --env "$ENV"
  exit 1
fi

echo "✓ Deployment successful — API is healthy"
pm2 status

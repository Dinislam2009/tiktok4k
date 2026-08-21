#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/tiktok4k}"
BRANCH="${BRANCH:-feature/telegram-credit-system}"
COMPOSE="docker compose -f docker-compose.production.yml"

cd "$APP_DIR"

echo "==> Sync repository"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

echo "==> Validate compose"
$COMPOSE config >/dev/null

echo "==> Build production images"
$COMPOSE build

echo "==> Start production stack"
$COMPOSE up -d --force-recreate

echo "==> Show service status"
$COMPOSE ps

echo "==> Recent worker logs"
$COMPOSE logs --tail=30 worker

echo "==> Recent bot logs"
$COMPOSE logs --tail=30 bot

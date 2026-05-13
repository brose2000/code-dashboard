#!/bin/bash
# code-dashboard — deploy on your server (in place, user-owned).
set -e
DEPLOY_DIR=~/code-dashboard-deploy

echo "=== code-dashboard deploy ==="
if [[ "$1" != "--skip-build" ]]; then
  echo "→ build…"
  set -a; source .env.production; set +a
  npm run build
else
  echo "→ skip build"
fi

echo "→ rsync to $DEPLOY_DIR"
mkdir -p "$DEPLOY_DIR/.next/standalone"
rsync -a --delete .next/standalone/ "$DEPLOY_DIR/.next/standalone/"
rsync -a .next/static/ "$DEPLOY_DIR/.next/standalone/.next/static/"
rsync -a public/ "$DEPLOY_DIR/.next/standalone/public/"
cp .env.production "$DEPLOY_DIR/.env.production"
cp .env.production "$DEPLOY_DIR/.next/standalone/.env.production"
chmod 600 "$DEPLOY_DIR/.env.production" "$DEPLOY_DIR/.next/standalone/.env.production"

echo "→ restart…"
systemctl --user restart code-dashboard
sleep 3
ACTIVE=$(systemctl --user is-active code-dashboard)
HEALTH=$(curl -s -H "x-forwarded-proto: https" -o /dev/null -w "%{http_code}" http://localhost:8101/login || echo FAIL)
echo
echo "  service: $ACTIVE"
echo "  /login:  $HEALTH"
[[ "$ACTIVE" == "active" && "$HEALTH" == "200" ]] && echo "✓ Deployed — https://code.example.com" || { echo "✗ check journalctl --user -u code-dashboard"; exit 1; }

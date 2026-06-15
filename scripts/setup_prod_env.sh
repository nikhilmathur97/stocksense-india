#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# One-time production environment setup script
# Run after you have Railway URL, Supabase URL, and Upstash Redis URL
# Usage: bash scripts/setup_prod_env.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

echo "=== StockSense India — Production Env Setup ==="
echo ""

# ── Collect values ─────────────────────────────────────────────────────────────
read -p "Railway backend URL (e.g. https://xxxx.up.railway.app): " RAILWAY_URL
read -p "Supabase DB URL (postgresql+asyncpg://postgres:PASS@db.REF.supabase.co:5432/postgres): " SUPABASE_DB_URL
read -p "Upstash Redis URL (rediss://default:PASS@xxxx.upstash.io:6379): " UPSTASH_URL
read -p "Upstash Redis host (xxxx.upstash.io): " UPSTASH_HOST
read -p "Upstash Redis password: " UPSTASH_PASS

# Derive WSS from HTTPS URL
WS_URL="${RAILWAY_URL/https/wss}"

echo ""
echo "=== Setting Vercel environment variables ==="
cd "$(dirname "$0")/../frontend"

# Frontend env vars (Vercel)
echo "$RAILWAY_URL" | vercel env add NEXT_PUBLIC_API_URL production --force
echo "$WS_URL"      | vercel env add NEXT_PUBLIC_WS_URL production --force
echo "StockSense India" | vercel env add NEXT_PUBLIC_APP_NAME production --force

echo "✅ Vercel env vars set. Triggering redeploy..."
vercel --prod --yes
cd ..

echo ""
echo "=== Railway env vars to set in Railway Dashboard ==="
echo "Go to: https://railway.app → Your project → Variables"
echo ""
echo "DATABASE_URL=$SUPABASE_DB_URL"
echo "REDIS_URL=$UPSTASH_URL"
echo "REDIS_HOST=$UPSTASH_HOST"
echo "REDIS_PORT=6379"
echo "REDIS_PASSWORD=$UPSTASH_PASS"
echo "ENVIRONMENT=production"
echo "DEBUG=false"
echo "ALLOWED_ORIGINS=$RAILWAY_URL,$(cd frontend && vercel ls --prod 2>/dev/null | grep -o 'https://[^ ]*vercel.app' | head -1)"
echo "JWT_SECRET_KEY=ff75788ea43305b14a07890df76185c1670dad49262690c5a0b0c46019a5751c"
echo ""
echo "Angel One credentials — copy from your .env:"
echo "ANGEL_ONE_API_KEY=..."
echo "ANGEL_ONE_CLIENT_CODE=..."
echo "ANGEL_ONE_PASSWORD=..."
echo "ANGEL_ONE_TOTP_SECRET=..."
echo ""
echo "Done! Railway env vars must be set manually in the Railway dashboard."

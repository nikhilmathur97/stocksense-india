# 🚀 Deployment Guide — Indian Stock Market Platform

## TL;DR Recommendation

| Option | Best For | Cost/Month | Complexity |
|--------|----------|-----------|------------|
| **Local Mac** | Development & personal trading | ₹0 | Low |
| **AWS EC2 t3.medium** | Production, always-on, team use | ~₹3,500–5,000 | Medium |
| **AWS EC2 t3.large** | High traffic, multiple users | ~₹6,000–8,000 | Medium |

> **Verdict:** For a personal trading dashboard that needs to run 24×7 and connect to Angel One during market hours (9:15–15:30 IST), **AWS EC2 t3.medium in ap-south-1 (Mumbai)** is the best choice. Low latency to Angel One servers, always-on, and costs less than ₹5,000/month.

---

## Option A — Local Mac (Current Setup)

### ✅ When to use
- Personal use only
- Testing and development
- You don't need it running when your Mac is off/sleeping

### Current local stack
```
Mac (your machine)
├── PostgreSQL (local, port 5432)
├── Redis (local, port 6379)
├── FastAPI backend (port 8000) — venv/bin/uvicorn
└── Next.js frontend (port 3001) — npm run dev
```

### Start everything locally
```bash
# 1. Start PostgreSQL (if not running)
brew services start postgresql@15

# 2. Start Redis
brew services start redis

# 3. Start backend (from project root)
cd /Users/nikhilmathur1997/Downloads/trading-bot/stock-platform
venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload

# 4. Start frontend (new terminal)
cd frontend && npm run dev -- --port 3001
```

### Access
- Dashboard: http://localhost:3001
- API docs:  http://localhost:8000/docs

### ⚠️ Limitations
- Stops when Mac sleeps or restarts
- Angel One WebSocket disconnects on sleep
- Not accessible from other devices/internet
- No SSL/HTTPS

---

## Option B — AWS EC2 (Recommended for Production)

### Architecture

```
Internet
    │
    ▼
[Route 53 DNS] → your-domain.com
    │
    ▼
[EC2 t3.medium — ap-south-1 (Mumbai)]
    │
    ├── Nginx (ports 80/443) ← SSL via Let's Encrypt
    │       ├── /api/*  → FastAPI :8000
    │       ├── /ws/*   → FastAPI WebSocket :8000
    │       └── /*      → Next.js :3000
    │
    ├── Docker Compose
    │       ├── stockbackend   (FastAPI + gunicorn, 2 workers)
    │       ├── stockfrontend  (Next.js standalone)
    │       ├── stockpipeline  (APScheduler)
    │       ├── stockdb        (TimescaleDB/PostgreSQL)
    │       ├── stockredis     (Redis 7)
    │       └── stocknginx     (Nginx reverse proxy)
    │
    └── Angel One API ←→ SmartAPI (Mumbai servers, low latency)
```

### Why Mumbai (ap-south-1)?
- Angel One servers are in Mumbai → **<5ms latency** for WebSocket ticks
- NSE/BSE data feeds are India-based
- Lowest latency = most accurate real-time prices

---

## Step-by-Step AWS Deployment

### Step 1 — Launch EC2 Instance

```bash
# AWS Console → EC2 → Launch Instance
Instance type:  t3.medium  (2 vCPU, 4 GB RAM)  ← minimum recommended
                t3.large   (2 vCPU, 8 GB RAM)  ← if you add more stocks
Region:         ap-south-1 (Mumbai)
AMI:            Ubuntu 22.04 LTS (free tier eligible base)
Storage:        30 GB gp3 SSD  (increase to 50 GB if storing 1-min OHLCV)
Key pair:       Create new → download .pem file

# Security Group rules (inbound):
Type        Port    Source
SSH         22      Your IP only (e.g. 1.2.3.4/32)
HTTP        80      0.0.0.0/0
HTTPS       443     0.0.0.0/0
```

### Step 2 — Connect & Install Docker

```bash
# Connect to EC2
ssh -i ~/Downloads/your-key.pem ubuntu@YOUR_EC2_PUBLIC_IP

# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
newgrp docker

# Install Docker Compose v2
sudo apt-get install -y docker-compose-plugin

# Verify
docker --version          # Docker 24.x
docker compose version    # Docker Compose v2.x
```

### Step 3 — Clone Your Project

```bash
# On EC2
cd /home/ubuntu

# Option A: Clone from GitHub (recommended)
git clone https://github.com/YOUR_USERNAME/stock-platform.git
cd stock-platform

# Option B: Copy from Mac via scp
# (run on your Mac)
scp -i ~/Downloads/your-key.pem -r \
  /Users/nikhilmathur1997/Downloads/trading-bot/stock-platform \
  ubuntu@YOUR_EC2_IP:/home/ubuntu/stock-platform
```

### Step 4 — Configure Production Environment

```bash
# On EC2, inside /home/ubuntu/stock-platform
cp .env.production.example .env.production

# Edit with your real values
nano .env.production
```

**Critical values to change in `.env.production`:**
```env
# Angel One — same as your local .env
ANGEL_ONE_API_KEY=F2BP8qON
ANGEL_ONE_CLIENT_CODE=N61493142
ANGEL_ONE_PASSWORD=1997
ANGEL_ONE_TOTP_SECRET=FUIBOTOT65NLX3JEJ4B73ZDRVU

# Database — strong password
DATABASE_PASSWORD=MyStr0ngP@ssw0rd2024!
DATABASE_USER=stockuser

# Redis — strong password
REDIS_PASSWORD=RedisStr0ng2024!

# JWT — generate a new secret
JWT_SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")

# Your domain (after Step 5)
ALLOWED_ORIGINS=https://your-domain.com
NEXT_PUBLIC_API_URL=https://your-domain.com/api
NEXT_PUBLIC_WS_URL=wss://your-domain.com/ws
```

### Step 5 — Point Domain to EC2 (Optional but Recommended)

```
In your domain registrar (GoDaddy/Namecheap/Route53):
  A record:  your-domain.com     → YOUR_EC2_PUBLIC_IP
  A record:  www.your-domain.com → YOUR_EC2_PUBLIC_IP
```

If you don't have a domain, use the EC2 public IP directly (HTTP only).

### Step 6 — SSL Certificate (Let's Encrypt)

```bash
# On EC2
sudo apt-get install -y certbot

# Get certificate (replace with your domain)
sudo certbot certonly --standalone \
  -d your-domain.com \
  -d www.your-domain.com \
  --email your@email.com \
  --agree-tos \
  --non-interactive

# Certs will be at:
# /etc/letsencrypt/live/your-domain.com/fullchain.pem
# /etc/letsencrypt/live/your-domain.com/privkey.pem

# Copy to nginx ssl volume location
sudo mkdir -p /home/ubuntu/stock-platform/deployment/nginx/ssl
sudo cp /etc/letsencrypt/live/your-domain.com/fullchain.pem \
        /home/ubuntu/stock-platform/deployment/nginx/ssl/
sudo cp /etc/letsencrypt/live/your-domain.com/privkey.pem \
        /home/ubuntu/stock-platform/deployment/nginx/ssl/
sudo chown -R ubuntu:ubuntu /home/ubuntu/stock-platform/deployment/nginx/ssl

# Auto-renew (add to crontab)
echo "0 3 * * * certbot renew --quiet && docker compose -f /home/ubuntu/stock-platform/deployment/docker/docker-compose.prod.yml restart nginx" | sudo crontab -
```

### Step 7 — Update Nginx Config for Your Domain

```bash
# Edit deployment/nginx/nginx.conf
# Replace "your-domain.com" with your actual domain
sed -i 's/your-domain.com/ACTUAL_DOMAIN.com/g' deployment/nginx/nginx.conf

# Update SSL cert paths to point to the ssl directory
# The docker-compose.prod.yml mounts nginx_ssl volume
# Update the volume mount to use your cert directory:
```

In [`deployment/docker/docker-compose.prod.yml`](deployment/docker/docker-compose.prod.yml), update the nginx volumes:
```yaml
volumes:
  - ../nginx/nginx.conf:/etc/nginx/nginx.conf:ro
  - ./ssl:/etc/nginx/ssl:ro          # ← add this line
  - nginx_logs:/var/log/nginx
```

### Step 8 — Build and Launch

```bash
cd /home/ubuntu/stock-platform

# Build all images (takes 5-10 minutes first time)
docker compose -f deployment/docker/docker-compose.prod.yml build

# Start all services in background
docker compose -f deployment/docker/docker-compose.prod.yml up -d

# Watch logs
docker compose -f deployment/docker/docker-compose.prod.yml logs -f

# Check all containers are healthy
docker compose -f deployment/docker/docker-compose.prod.yml ps
```

Expected output:
```
NAME             STATUS          PORTS
stocknginx       Up (healthy)    0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
stockfrontend    Up (healthy)    3000/tcp
stockbackend     Up (healthy)    8000/tcp
stockpipeline    Up              
stockdb          Up (healthy)    5432/tcp
stockredis       Up (healthy)    6379/tcp
```

### Step 9 — Seed Initial Data

```bash
# Run inside the backend container
docker compose -f deployment/docker/docker-compose.prod.yml \
  exec backend python scripts/load_nse_stocks.py

docker compose -f deployment/docker/docker-compose.prod.yml \
  exec backend python scripts/seed_mock_data.py
```

### Step 10 — Verify Everything Works

```bash
# Health check
curl https://your-domain.com/health
# Expected: {"status":"ok","service":"Indian Stock Market Analytics API"}

# Detailed health
curl https://your-domain.com/health/detailed
# Expected: {"status":"ok","checks":{"api":"ok","redis":"ok","database":"ok"}}

# Trending stocks
curl https://your-domain.com/api/stocks/trending

# Top picks
curl https://your-domain.com/api/screener/top-picks
```

---

## Auto-Start on EC2 Reboot

```bash
# Create systemd service
sudo tee /etc/systemd/system/stockplatform.service > /dev/null <<EOF
[Unit]
Description=Stock Platform Docker Compose
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/home/ubuntu/stock-platform
ExecStart=/usr/bin/docker compose -f deployment/docker/docker-compose.prod.yml up -d
ExecStop=/usr/bin/docker compose -f deployment/docker/docker-compose.prod.yml down
TimeoutStartSec=300
User=ubuntu

[Install]
WantedBy=multi-user.target
EOF

# Enable auto-start
sudo systemctl daemon-reload
sudo systemctl enable stockplatform
sudo systemctl start stockplatform

# Verify
sudo systemctl status stockplatform
```

---

## Useful Commands (Day-to-Day)

```bash
# View live logs
docker compose -f deployment/docker/docker-compose.prod.yml logs -f backend
docker compose -f deployment/docker/docker-compose.prod.yml logs -f pipeline

# Restart a single service
docker compose -f deployment/docker/docker-compose.prod.yml restart backend

# Run AI screener manually
docker compose -f deployment/docker/docker-compose.prod.yml \
  exec backend python -c "import asyncio; from engine.screener import run_screener; asyncio.run(run_screener())"

# Connect to database
docker compose -f deployment/docker/docker-compose.prod.yml \
  exec timescaledb psql -U stockuser -d stockdb

# Monitor Redis
docker compose -f deployment/docker/docker-compose.prod.yml \
  exec redis redis-cli -a YOUR_REDIS_PASSWORD monitor

# Update code and redeploy (zero-downtime)
git pull
docker compose -f deployment/docker/docker-compose.prod.yml build backend frontend
docker compose -f deployment/docker/docker-compose.prod.yml up -d --no-deps backend frontend

# Check disk usage
docker system df
```

---

## Cost Breakdown (AWS ap-south-1 Mumbai)

| Resource | Spec | Cost/Month (INR) |
|----------|------|-----------------|
| EC2 t3.medium | 2 vCPU, 4 GB RAM | ~₹2,800 |
| EBS gp3 30 GB | SSD storage | ~₹250 |
| Data transfer | ~50 GB/month | ~₹350 |
| Elastic IP | Static IP | ~₹0 (free if attached) |
| **Total** | | **~₹3,400/month** |

> **Tip:** Use a **Reserved Instance (1-year)** to cut EC2 cost by ~40% → ~₹2,000/month total.

---

## Performance Tuning for Market Hours

The platform is configured for:
- **Poll loop**: every 2 seconds (Angel One REST API)
- **WebSocket ticks**: real-time during market hours (9:15–15:30 IST)
- **Frontend refetch**: every 2 seconds via React Query
- **Redis TTL**: 5 seconds per quote

On t3.medium during peak market hours (9:15–10:00 AM IST):
- ~68 stocks × 2s poll = ~34 API calls/minute to Angel One
- Angel One rate limit: 1000 calls/minute → well within limits
- Expected CPU: 15–25% on t3.medium
- Expected RAM: 1.5–2.5 GB used

---

## Security Checklist Before Going Live

- [ ] Changed `JWT_SECRET_KEY` to a random 64-char string
- [ ] Set strong `DATABASE_PASSWORD` (min 16 chars, mixed case + symbols)
- [ ] Set strong `REDIS_PASSWORD`
- [ ] EC2 Security Group: SSH port 22 restricted to your IP only
- [ ] `.env.production` is in `.gitignore` (never committed)
- [ ] SSL certificate installed and HTTPS working
- [ ] Angel One credentials are yours (not shared)
- [ ] Telegram alerts configured for job failures

---

## Monitoring & Alerts

### Telegram Bot Setup (Recommended)
1. Message `@BotFather` on Telegram → `/newbot` → get `BOT_TOKEN`
2. Message `@userinfobot` → get your `CHAT_ID`
3. Add to `.env.production`:
   ```env
   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_CHAT_ID=your_chat_id
   ```
4. The pipeline scheduler will send alerts for:
   - Job failures
   - End-of-day processing complete
   - High-probability signals (85%+)

### CloudWatch (AWS native)
```bash
# Install CloudWatch agent on EC2
sudo apt-get install -y amazon-cloudwatch-agent
# Configure to ship /var/log/docker logs to CloudWatch
```

---

## Screener Schedule (Market Hours)

The [`pipeline/scheduler.py`](pipeline/scheduler.py) runs automatically:

| Job | Schedule | Description |
|-----|----------|-------------|
| Fetch Live Quotes | Every 1 min, 9:00–15:30 IST | Angel One REST → DB + Redis |
| Calculate Indicators | Every 1 min, 9:00–15:30 IST | EMA, RSI, MACD, Supertrend |
| Run AI Screener | Every 1 min, 9:00–15:30 IST | Score all stocks, save signals |
| Fetch Options Chain | Every 5 min, 9:00–15:30 IST | F&O data for 10 stocks |
| End of Day | 3:35 PM IST, Mon–Fri | Aggregate 1-min → daily OHLCV |
| Sync Stock Master | 8:00 AM IST, Mon–Fri | Refresh stock token list |

> **During market hours**, confidence scores will naturally reach **80–90%** because live volume, momentum, and price action data are available. The screener is tuned with `STRONG_BUY_THRESHOLD = 80.0`.

---

## Quick Reference: Local vs AWS

| Feature | Local Mac | AWS EC2 |
|---------|-----------|---------|
| Always-on 24×7 | ❌ (sleeps) | ✅ |
| Angel One WS stable | ❌ (disconnects on sleep) | ✅ |
| HTTPS / SSL | ❌ | ✅ |
| Accessible from phone | ❌ | ✅ |
| Auto-restart on crash | ❌ | ✅ (systemd) |
| Cost | ₹0 | ~₹3,400/month |
| Setup time | 0 (already done) | ~2 hours |
| Latency to Angel One | ~50ms (internet) | ~5ms (Mumbai DC) |
| Best for | Dev / testing | Production trading |

# 🇮🇳 Indian Stock Market Analytics Platform

A professional NSE & BSE dashboard with Options Chain, Trending Stocks & AI Probability Engine.

## 🏗️ Architecture

```
stock-platform/
├── backend/          # Python FastAPI backend
├── frontend/         # Next.js 14 frontend
├── database/         # TimescaleDB migrations & seeds
├── pipeline/         # Data pipeline & scheduler
├── engine/           # AI probability & signal engine
├── deployment/       # Docker, Nginx, CI/CD configs
└── scripts/          # Utility scripts
```

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 18+
- Python 3.11+
- Angel One SmartAPI account

### 1. Clone & Setup Environment
```bash
git clone <your-repo>
cd stock-platform
cp .env.example .env
# Edit .env with your credentials
```

### 2. Start Infrastructure (Database + Redis)
```bash
docker-compose up -d timescaledb redis
```

### 3. Setup Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python -m alembic upgrade head  # Run migrations
uvicorn main:app --reload --port 8000
```

### 4. Setup Frontend
```bash
cd frontend
npm install
npm run dev
```

### 5. Start Data Pipeline
```bash
cd pipeline
python scheduler.py
```

## 🔑 Angel One SmartAPI Setup

1. Register at [Angel One](https://www.angelone.in/)
2. Create API key at SmartAPI portal
3. Enable TOTP in your Angel One account
4. Add credentials to `.env` file

## 📊 Features

- **Live NSE/BSE Data** — Real-time prices via WebSocket
- **Options Chain** — Full CE/PE data with Greeks
- **AI Probability Engine** — 7-day & 15-day trade probability scores
- **Stock Screener** — Filter 1800+ stocks with custom criteria
- **Technical Indicators** — RSI, MACD, EMA, Bollinger Bands, etc.
- **Alert System** — Telegram, WhatsApp, Email & in-app alerts
- **Sector Heatmap** — Visual sector performance dashboard

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React, Tailwind CSS, Recharts |
| Backend | Python FastAPI, WebSockets |
| Database | TimescaleDB (PostgreSQL) |
| Cache | Redis |
| Data Source | Angel One SmartAPI |
| Deployment | Docker, Nginx, GitHub Actions |

## 📅 Build Timeline

| Week | Milestone |
|------|-----------|
| Week 1 | Setup + Database + Data pipeline |
| Week 1 | AI probability engine + screener |
| Week 1 | Full backend API |
| Week 1 | Dashboard + Stock detail page |
| Week 1 | Options chain + Screener + Alerts |
| Week 1 | Deploy + Legal compliance |
| Week 1 | Testing + Performance tuning |
| Week 1 | 🚀 Launch |

## ⚠️ Legal Disclaimer

This platform is for **educational and informational purposes only**. It does NOT constitute investment advice. We are NOT SEBI registered Research Analysts. Always consult a qualified financial advisor before making investment decisions.

## 📄 License

MIT License — See LICENSE file for details.

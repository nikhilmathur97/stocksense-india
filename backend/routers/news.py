"""
Market News Router — aggregates news from multiple sources:
  • NSE corporate announcements (official XML feed)
  • Economic Times Markets RSS
  • Moneycontrol RSS
  • LiveMint Markets RSS
  • Business Standard Markets RSS
  • Google Finance RSS (NSE/BSE)
  • BSE corporate filings feed

All sources are fetched in parallel, deduplicated, and cached in Redis for 60 s.
"""
import asyncio
import hashlib
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
from email.utils import parsedate_to_datetime

import aiohttp
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.database import get_redis

logger = logging.getLogger("news")
router = APIRouter(prefix="/api/news", tags=["News"])

IST = timezone(timedelta(hours=5, minutes=30))

# ── Pydantic Models ───────────────────────────────────────────────────────────

class NewsItem(BaseModel):
    id: str
    title: str
    summary: str
    url: str
    source: str
    source_type: str          # "corporate" | "market" | "economy" | "global"
    published_at: str         # ISO 8601
    symbols: List[str] = []   # mentioned NSE symbols
    sentiment: str = "NEUTRAL"  # POSITIVE | NEGATIVE | NEUTRAL
    is_breaking: bool = False


# ── News Sources ──────────────────────────────────────────────────────────────

NEWS_SOURCES = [
    {
        "name": "Economic Times Markets",
        "url": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
        "type": "market",
        "timeout": 8,
    },
    {
        "name": "Moneycontrol Markets",
        "url": "https://www.moneycontrol.com/rss/marketreports.xml",
        "type": "market",
        "timeout": 8,
    },
    {
        "name": "Business Standard Markets",
        "url": "https://www.business-standard.com/rss/markets-106.rss",
        "type": "market",
        "timeout": 8,
    },
    {
        "name": "LiveMint Markets",
        "url": "https://www.livemint.com/rss/markets",
        "type": "market",
        "timeout": 8,
    },
    {
        "name": "Financial Express Markets",
        "url": "https://www.financialexpress.com/market/feed/",
        "type": "market",
        "timeout": 8,
    },
    {
        "name": "NSE India News",
        "url": "https://www.nseindia.com/api/corporate-announcements?index=equities",
        "type": "corporate",
        "timeout": 10,
        "is_json": True,
    },
    {
        "name": "Reuters India Business",
        "url": "https://feeds.reuters.com/reuters/INbusinessNews",
        "type": "economy",
        "timeout": 8,
    },
    {
        "name": "Google Finance NSE",
        "url": "https://news.google.com/rss/search?q=NSE+BSE+India+stock+market&hl=en-IN&gl=IN&ceid=IN:en",
        "type": "market",
        "timeout": 8,
    },
]

# NSE symbols to watch for in headlines
NIFTY50_SYMBOLS = {
    "RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "HINDUNILVR",
    "SBIN", "BAJFINANCE", "WIPRO", "MARUTI", "ADANIENT", "ADANIPORTS",
    "AXISBANK", "BHARTIARTL", "BPCL", "CIPLA", "COALINDIA", "DIVISLAB",
    "DRREDDY", "EICHERMOT", "GRASIM", "HCLTECH", "HEROMOTOCO", "HINDALCO",
    "INDUSINDBK", "JSWSTEEL", "KOTAKBANK", "LT", "M&M", "NESTLEIND",
    "NTPC", "ONGC", "POWERGRID", "SUNPHARMA", "TATAMOTORS", "TATASTEEL",
    "TECHM", "TITAN", "ULTRACEMCO", "UPL", "BAJAJFINSV", "BRITANNIA",
    "APOLLOHOSP", "ASIANPAINT", "DMART", "HDFC", "ITC", "PIDILITIND",
    "SIEMENS", "TATACONSUM",
}

# Sentiment keywords
POSITIVE_WORDS = {
    "surge", "rally", "gain", "rise", "jump", "soar", "high", "record",
    "profit", "growth", "beat", "upgrade", "buy", "bullish", "strong",
    "outperform", "positive", "boost", "recover", "rebound", "breakout",
}
NEGATIVE_WORDS = {
    "fall", "drop", "decline", "crash", "loss", "miss", "downgrade",
    "sell", "bearish", "weak", "concern", "risk", "cut", "slump",
    "plunge", "tumble", "underperform", "negative", "warning", "default",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_id(url: str, title: str) -> str:
    return hashlib.md5(f"{url}{title}".encode()).hexdigest()[:12]


def _detect_sentiment(text: str) -> str:
    lower = text.lower()
    pos = sum(1 for w in POSITIVE_WORDS if w in lower)
    neg = sum(1 for w in NEGATIVE_WORDS if w in lower)
    if pos > neg:
        return "POSITIVE"
    if neg > pos:
        return "NEGATIVE"
    return "NEUTRAL"


def _extract_symbols(text: str) -> List[str]:
    found = []
    upper = text.upper()
    for sym in NIFTY50_SYMBOLS:
        # Match whole-word only (avoid INFY matching INFYOSYS etc.)
        if re.search(r'\b' + re.escape(sym) + r'\b', upper):
            found.append(sym)
    return found[:5]  # cap at 5 per article


def _parse_rfc2822(date_str: str) -> str:
    """Parse RFC 2822 date (RSS pubDate) to ISO 8601 IST string."""
    try:
        dt = parsedate_to_datetime(date_str)
        return dt.astimezone(IST).isoformat()
    except Exception:
        return datetime.now(IST).isoformat()


def _strip_html(text: str) -> str:
    """Remove HTML tags and decode common entities."""
    text = re.sub(r'<[^>]+>', '', text or '')
    text = text.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>') \
               .replace('&quot;', '"').replace('&#39;', "'").replace('&nbsp;', ' ')
    return text.strip()[:300]


# ── RSS Parser ────────────────────────────────────────────────────────────────

async def _fetch_rss(session: aiohttp.ClientSession, source: Dict) -> List[Dict]:
    """Fetch and parse an RSS/Atom feed."""
    items = []
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (compatible; StockPlatform/1.0; +https://stockplatform.in)",
            "Accept": "application/rss+xml, application/xml, text/xml, */*",
        }
        async with session.get(source["url"], headers=headers, timeout=aiohttp.ClientTimeout(total=source["timeout"])) as resp:
            if resp.status != 200:
                logger.debug(f"RSS {source['name']}: HTTP {resp.status}")
                return []
            text = await resp.text(errors="replace")

        # Parse <item> blocks
        item_blocks = re.findall(r'<item[^>]*>(.*?)</item>', text, re.DOTALL | re.IGNORECASE)
        if not item_blocks:
            # Try <entry> (Atom)
            item_blocks = re.findall(r'<entry[^>]*>(.*?)</entry>', text, re.DOTALL | re.IGNORECASE)

        for block in item_blocks[:20]:
            def _tag(name: str) -> str:
                m = re.search(rf'<{name}[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</{name}>', block, re.DOTALL | re.IGNORECASE)
                return _strip_html(m.group(1).strip()) if m else ''

            title = _tag('title')
            link_m = re.search(r'<link[^>]*>([^<]+)</link>', block, re.IGNORECASE) or \
                     re.search(r'<link[^>]+href=["\']([^"\']+)["\']', block, re.IGNORECASE)
            link = link_m.group(1).strip() if link_m else ''
            pub_date = _tag('pubDate') or _tag('published') or _tag('updated')
            description = _tag('description') or _tag('summary') or _tag('content')

            if not title or not link:
                continue

            published_at = _parse_rfc2822(pub_date) if pub_date else datetime.now(IST).isoformat()
            combined = f"{title} {description}"

            items.append({
                "id": _make_id(link, title),
                "title": title,
                "summary": description or title,
                "url": link,
                "source": source["name"],
                "source_type": source["type"],
                "published_at": published_at,
                "symbols": _extract_symbols(combined),
                "sentiment": _detect_sentiment(combined),
                "is_breaking": any(w in title.lower() for w in ["breaking", "alert", "urgent", "flash"]),
            })

    except asyncio.TimeoutError:
        logger.debug(f"RSS timeout: {source['name']}")
    except Exception as e:
        logger.debug(f"RSS error {source['name']}: {e}")

    return items


# ── NSE JSON Parser ───────────────────────────────────────────────────────────

async def _fetch_nse_announcements(session: aiohttp.ClientSession, source: Dict) -> List[Dict]:
    """Fetch NSE corporate announcements JSON API."""
    items = []
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://www.nseindia.com/",
            "Accept": "application/json",
        }
        # NSE requires a session cookie — first hit the homepage
        async with session.get("https://www.nseindia.com", headers=headers,
                               timeout=aiohttp.ClientTimeout(total=5)) as _:
            pass

        async with session.get(source["url"], headers=headers,
                               timeout=aiohttp.ClientTimeout(total=source["timeout"])) as resp:
            if resp.status != 200:
                return []
            data = await resp.json(content_type=None)

        announcements = data if isinstance(data, list) else data.get("data", [])
        for ann in announcements[:30]:
            symbol = str(ann.get("symbol", "")).upper()
            subject = str(ann.get("subject", ann.get("desc", "")))
            bm_desc = str(ann.get("bm_desc", ""))
            title = f"{symbol}: {subject}" if symbol else subject
            dt_str = ann.get("exchdisstime", ann.get("date", ""))
            try:
                dt = datetime.strptime(dt_str[:19], "%d-%b-%Y %H:%M:%S").replace(tzinfo=IST)
                published_at = dt.isoformat()
            except Exception:
                published_at = datetime.now(IST).isoformat()

            combined = f"{title} {bm_desc}"
            items.append({
                "id": _make_id(symbol + dt_str, title),
                "title": title,
                "summary": _strip_html(bm_desc or subject)[:300],
                "url": f"https://www.nseindia.com/companies-listing/corporate-filings-announcements",
                "source": "NSE Corporate Announcements",
                "source_type": "corporate",
                "published_at": published_at,
                "symbols": [symbol] if symbol in NIFTY50_SYMBOLS else _extract_symbols(combined),
                "sentiment": _detect_sentiment(combined),
                "is_breaking": "board meeting" in subject.lower() or "result" in subject.lower(),
            })

    except Exception as e:
        logger.debug(f"NSE announcements error: {e}")

    return items


# ── Main Aggregator ───────────────────────────────────────────────────────────

async def fetch_all_news() -> List[Dict]:
    """Fetch news from all sources in parallel, deduplicate, sort by recency."""
    connector = aiohttp.TCPConnector(limit=20, ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = []
        for src in NEWS_SOURCES:
            if src.get("is_json"):
                tasks.append(_fetch_nse_announcements(session, src))
            else:
                tasks.append(_fetch_rss(session, src))

        results = await asyncio.gather(*tasks, return_exceptions=True)

    all_items: List[Dict] = []
    for r in results:
        if isinstance(r, list):
            all_items.extend(r)

    # Deduplicate by id
    seen = set()
    unique = []
    for item in all_items:
        if item["id"] not in seen:
            seen.add(item["id"])
            unique.append(item)

    # Sort by published_at descending
    def _sort_key(item: Dict) -> str:
        try:
            return item["published_at"]
        except Exception:
            return ""

    unique.sort(key=_sort_key, reverse=True)
    return unique[:100]  # cap at 100 items


# ── API Endpoints ─────────────────────────────────────────────────────────────

@router.get("", response_model=List[NewsItem])
async def get_news(
    source_type: Optional[str] = Query(default=None, description="corporate|market|economy|global"),
    symbol: Optional[str] = Query(default=None, description="Filter by NSE symbol"),
    sentiment: Optional[str] = Query(default=None, description="POSITIVE|NEGATIVE|NEUTRAL"),
    limit: int = Query(default=30, le=100),
    redis=Depends(get_redis),
):
    """
    Get aggregated market news from NSE, ET, Moneycontrol, BS, LiveMint, Reuters, Google Finance.
    Cached for 60 seconds. Refreshed every minute by the scheduler.
    """
    cache_key = "news:all"
    cached = await redis.get(cache_key)

    if cached:
        items = json.loads(cached)
    else:
        items = await fetch_all_news()
        if items:
            await redis.setex(cache_key, 60, json.dumps(items))

    # Apply filters
    if source_type:
        items = [i for i in items if i.get("source_type") == source_type.lower()]
    if symbol:
        sym_upper = symbol.upper()
        items = [i for i in items if sym_upper in i.get("symbols", [])]
    if sentiment:
        items = [i for i in items if i.get("sentiment") == sentiment.upper()]

    return items[:limit]


@router.get("/breaking", response_model=List[NewsItem])
async def get_breaking_news(
    redis=Depends(get_redis),
):
    """Get breaking/urgent news items only."""
    cache_key = "news:all"
    cached = await redis.get(cache_key)
    items = json.loads(cached) if cached else await fetch_all_news()
    breaking = [i for i in items if i.get("is_breaking")]
    return breaking[:10]


@router.get("/symbol/{symbol}", response_model=List[NewsItem])
async def get_symbol_news(
    symbol: str,
    limit: int = Query(default=10, le=50),
    redis=Depends(get_redis),
):
    """Get news articles mentioning a specific NSE symbol."""
    cache_key = "news:all"
    cached = await redis.get(cache_key)
    items = json.loads(cached) if cached else await fetch_all_news()
    sym_upper = symbol.upper()
    filtered = [i for i in items if sym_upper in i.get("symbols", [])]
    return filtered[:limit]


@router.post("/refresh")
async def refresh_news(redis=Depends(get_redis)):
    """Force-refresh the news cache."""
    items = await fetch_all_news()
    if items:
        await redis.setex("news:all", 60, json.dumps(items))
    return {"message": f"News refreshed: {len(items)} articles", "count": len(items)}

"""
Load real NSE + BSE stocks from Angel One (no price filter — loads ALL price ranges).
Downloads the official Angel One instrument master to get correct symbol tokens,
then fetches 1-year OHLCV history for each stock on both exchanges.
"""
import asyncio
import os
import sys
import time
import urllib.request
import json
from datetime import datetime, timedelta, date as date_type

import asyncpg
import pyotp
from dotenv import load_dotenv
from SmartApi import SmartConnect

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv()

DB_URL = os.getenv("DATABASE_URL", "postgresql://nikhilmathur1997@localhost:5432/stockdb") \
    .replace("postgresql+asyncpg://", "postgresql://")

# Official Angel One scrip master — has all correct symbol tokens
SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"


def download_scrip_master():
    """Download Angel One instrument master file and return as list."""
    print("Downloading Angel One scrip master...", flush=True)
    req = urllib.request.Request(SCRIP_MASTER_URL, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode("utf-8"))
    print(f"  Got {len(data)} instruments")
    return data


def build_token_map(scrip_master):
    """Build {(symbol, exchange): token} for NSE and BSE EQ stocks."""
    token_map = {}
    for item in scrip_master:
        exch = item.get("exch_seg", "")
        sym_raw = str(item.get("symbol", ""))
        itype = item.get("instrumenttype", "")

        if exch == "NSE":
            if itype == "AMXIDX":
                continue
            if sym_raw.endswith("-EQ"):
                sym = sym_raw.replace("-EQ", "")
                token_map[(sym, "NSE")] = str(item["token"])

        elif exch == "BSE":
            # BSE EQ instruments — symbol is plain (no -EQ suffix)
            if itype in ("", "EQ", "BE") or sym_raw.isalpha():
                sym = sym_raw.strip()
                if sym and (sym, "BSE") not in token_map:
                    token_map[(sym, "BSE")] = str(item["token"])

    return token_map


def angel_login():
    api_key = os.getenv("ANGEL_ONE_API_KEY")
    client_code = os.getenv("ANGEL_ONE_CLIENT_CODE")
    password = os.getenv("ANGEL_ONE_PASSWORD")
    totp_secret = os.getenv("ANGEL_ONE_TOTP_SECRET")
    totp = pyotp.TOTP(totp_secret).now()
    smart = SmartConnect(api_key=api_key)
    data = smart.generateSession(client_code, password, totp)
    if data.get("status"):
        print("✅ Angel One login OK")
        return smart
    raise Exception(f"Login failed: {data.get('message')}")


def fetch_ohlcv(smart, symbol, token, exchange="NSE"):
    """Fetch 1 year of daily OHLCV from Angel One for NSE or BSE."""
    from_date = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d 09:15")
    to_date = datetime.now().strftime("%Y-%m-%d 15:30")
    # NSE uses SYMBOL-EQ, BSE uses plain SYMBOL
    trading_sym = f"{symbol}-EQ" if exchange == "NSE" else symbol
    try:
        data = smart.getCandleData({
            "exchange": exchange,
            "symboltoken": token,
            "interval": "ONE_DAY",
            "fromdate": from_date,
            "todate": to_date,
            "tradingsymbol": trading_sym,
        })
        if data and data.get("status") and data.get("data"):
            return data["data"]
        return []
    except Exception as e:
        print(f"  ⚠ OHLCV failed for {symbol} ({exchange}): {e}")
        return []


async def upsert_stock(conn, symbol, exchange, token):
    await conn.execute("""
        INSERT INTO stocks (symbol, name, exchange, symbol_token, is_active)
        VALUES ($1, $2, $3, $4, TRUE)
        ON CONFLICT (symbol, exchange) DO UPDATE
          SET symbol_token = EXCLUDED.symbol_token, is_active = TRUE
    """, symbol, symbol, exchange, token)


async def upsert_ohlcv(conn, symbol, exchange, candles):
    if not candles:
        return 0
    rows = []
    for c in candles:
        try:
            dt = date_type.fromisoformat(c[0][:10])
            o, h, l, cl, vol = float(c[1]), float(c[2]), float(c[3]), float(c[4]), int(c[5])
            if cl <= 0:
                continue
            rows.append((symbol, exchange, dt, o, h, l, cl, vol))
        except Exception:
            continue
    if not rows:
        return 0
    await conn.executemany("""
        INSERT INTO ohlcv_daily (symbol, exchange, date, open, high, low, close, volume)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (symbol, exchange, date) DO UPDATE
          SET open=EXCLUDED.open, high=EXCLUDED.high,
              low=EXCLUDED.low, close=EXCLUDED.close, volume=EXCLUDED.volume
    """, rows)
    return len(rows)


async def main():
    # Step 1: Download scrip master for correct tokens
    scrip_master = download_scrip_master()
    token_map = build_token_map(scrip_master)
    nse_count = sum(1 for (_, exch) in token_map if exch == "NSE")
    bse_count = sum(1 for (_, exch) in token_map if exch == "BSE")
    print(f"  NSE EQ symbols: {nse_count} | BSE EQ symbols: {bse_count}")

    # Step 2: Login to Angel One
    smart = angel_login()

    # Step 3: Comprehensive stock list — NO price filter, covers all ranges
    # Each entry is (symbol, exchange). NSE is primary; BSE added for BSE-only stocks.
    TARGET_SYMBOLS = [
        # ── Banking & Finance ──────────────────────────────────────────────────
        ("SBIN", "NSE"), ("BANKBARODA", "NSE"), ("PNB", "NSE"), ("CANBK", "NSE"),
        ("UNIONBANK", "NSE"), ("INDIANB", "NSE"), ("BANKINDIA", "NSE"),
        ("CENTRALBK", "NSE"), ("MAHABANK", "NSE"), ("UCOBANK", "NSE"), ("JKBANK", "NSE"),
        ("ICICIBANK", "NSE"), ("AXISBANK", "NSE"), ("KOTAKBANK", "NSE"),
        ("HDFCBANK", "NSE"), ("INDUSINDBK", "NSE"), ("IDFCFIRSTB", "NSE"),
        ("FEDERALBNK", "NSE"), ("RBLBANK", "NSE"), ("BANDHANBNK", "NSE"),
        ("DCBBANK", "NSE"), ("KARURVYSYA", "NSE"), ("CSBBANK", "NSE"),
        ("BAJFINANCE", "NSE"), ("BAJAJFINSV", "NSE"), ("CHOLAFIN", "NSE"),
        ("LICHSGFIN", "NSE"), ("MUTHOOTFIN", "NSE"), ("MANAPPURAM", "NSE"),
        ("RECLTD", "NSE"), ("PFC", "NSE"), ("IRFC", "NSE"), ("HUDCO", "NSE"),
        ("HDFCAMC", "NSE"), ("NIPPONLIFE", "NSE"), ("ICICIGI", "NSE"),
        ("ICICIPRULI", "NSE"), ("SBILIFE", "NSE"), ("HDFCLIFE", "NSE"),
        ("LICI", "NSE"), ("GICRE", "NSE"), ("NIACL", "NSE"),

        # ── IT & Technology ────────────────────────────────────────────────────
        ("TCS", "NSE"), ("INFY", "NSE"), ("WIPRO", "NSE"), ("HCLTECH", "NSE"),
        ("TECHM", "NSE"), ("LTIM", "NSE"), ("MPHASIS", "NSE"),
        ("PERSISTENT", "NSE"), ("COFORGE", "NSE"), ("LTTS", "NSE"),
        ("TATAELXSI", "NSE"), ("OFSS", "NSE"), ("HEXAWARE", "NSE"),
        ("KPITTECH", "NSE"), ("CYIENT", "NSE"), ("MASTEK", "NSE"),
        ("RATEGAIN", "NSE"), ("ZENSAR", "NSE"), ("BIRLASOFT", "NSE"),
        ("SONATSOFTW", "NSE"), ("INTELLECT", "NSE"), ("NEWGEN", "NSE"),
        ("TANLA", "NSE"),

        # ── Capital Markets & Exchanges ────────────────────────────────────────
        ("CDSL", "NSE"), ("MCX", "NSE"), ("CAMS", "NSE"), ("KFINTECH", "NSE"),
        ("BSE", "NSE"), ("ANGELONE", "NSE"), ("MOTILALOFS", "NSE"),
        ("5PAISA", "NSE"), ("IIFL", "NSE"), ("IIFLSEC", "NSE"),
        ("GEOJITFSL", "NSE"), ("NUVAMA", "NSE"), ("EMKAY", "NSE"),

        # ── Pharma & Healthcare ────────────────────────────────────────────────
        ("SUNPHARMA", "NSE"), ("DRREDDY", "NSE"), ("CIPLA", "NSE"),
        ("DIVISLAB", "NSE"), ("LUPIN", "NSE"), ("AUROPHARMA", "NSE"),
        ("ALKEM", "NSE"), ("GLENMARK", "NSE"), ("IPCALAB", "NSE"),
        ("NATCOPHARM", "NSE"), ("BIOCON", "NSE"), ("GRANULES", "NSE"),
        ("LAURUSLABS", "NSE"), ("ABBOTINDIA", "NSE"), ("PFIZER", "NSE"),
        ("SANOFI", "NSE"), ("GLAXO", "NSE"), ("TORNTPHARM", "NSE"),
        ("AJANTPHARM", "NSE"), ("ERIS", "NSE"), ("JBCHEPHARM", "NSE"),
        ("APOLLOHOSP", "NSE"), ("FORTIS", "NSE"), ("MAXHEALTH", "NSE"),
        ("NARAYANA", "NSE"), ("ASTER", "NSE"), ("METROPOLIS", "NSE"),
        ("THYROCARE", "NSE"),

        # ── Auto & Auto Ancillaries ────────────────────────────────────────────
        ("MARUTI", "NSE"), ("M&M", "NSE"), ("TATAMOTORS", "NSE"),
        ("HEROMOTOCO", "NSE"), ("BAJAJ-AUTO", "NSE"), ("EICHERMOT", "NSE"),
        ("TVSMOTORS", "NSE"), ("ASHOKLEY", "NSE"), ("TIINDIA", "NSE"),
        ("MINDA", "NSE"), ("ENDURANCE", "NSE"), ("BOSCHLTD", "NSE"),
        ("MOTHERSON", "NSE"), ("BALKRISIND", "NSE"), ("APOLLOTYRE", "NSE"),
        ("CEATLTD", "NSE"), ("EXIDEIND", "NSE"), ("AMARARAJA", "NSE"),
        ("SCHAEFFLER", "NSE"), ("SKFINDIA", "NSE"), ("TIMKEN", "NSE"),

        # ── Energy & Oil ──────────────────────────────────────────────────────
        ("RELIANCE", "NSE"), ("ONGC", "NSE"), ("COALINDIA", "NSE"),
        ("NTPC", "NSE"), ("POWERGRID", "NSE"), ("GAIL", "NSE"),
        ("IOC", "NSE"), ("BPCL", "NSE"), ("HINDPETRO", "NSE"),
        ("PETRONET", "NSE"), ("MRPL", "NSE"), ("CPCL", "NSE"),
        ("TATAPOWER", "NSE"), ("ADANIGREEN", "NSE"), ("ADANIPOWER", "NSE"),
        ("TORNTPOWER", "NSE"), ("CESC", "NSE"), ("NHPC", "NSE"),
        ("SJVN", "NSE"), ("IREDA", "NSE"), ("INOXWIND", "NSE"), ("SUZLON", "NSE"),
        ("RPOWER", "NSE"), ("JPPOWER", "NSE"),

        # ── Metals & Mining ────────────────────────────────────────────────────
        ("TATASTEEL", "NSE"), ("JSWSTEEL", "NSE"), ("SAIL", "NSE"),
        ("HINDALCO", "NSE"), ("VEDL", "NSE"), ("NMDC", "NSE"),
        ("NATIONALUM", "NSE"), ("HINDCOPPER", "NSE"), ("MOIL", "NSE"),
        ("APLAPOLLO", "NSE"), ("RATNAMANI", "NSE"), ("WELCORP", "NSE"),
        ("JINDALSAW", "NSE"),

        # ── FMCG & Consumer ───────────────────────────────────────────────────
        ("HINDUNILVR", "NSE"), ("ITC", "NSE"), ("NESTLEIND", "NSE"),
        ("BRITANNIA", "NSE"), ("TATACONSUM", "NSE"), ("DABUR", "NSE"),
        ("GODREJCP", "NSE"), ("COLPAL", "NSE"), ("MARICO", "NSE"),
        ("EMAMILTD", "NSE"), ("JYOTHYLAB", "NSE"), ("BAJAJCON", "NSE"),
        ("ZYDUSWELL", "NSE"), ("VBLLTD", "NSE"), ("RADICO", "NSE"),
        ("UNITDSPR", "NSE"), ("MCDOWELL-N", "NSE"),

        # ── Retail & E-commerce ────────────────────────────────────────────────
        ("DMART", "NSE"), ("TRENT", "NSE"), ("ABFRL", "NSE"),
        ("SHOPPERSSTOP", "NSE"), ("NYKAA", "NSE"), ("ZOMATO", "NSE"),
        ("PAYTM", "NSE"), ("POLICYBZR", "NSE"), ("CARTRADE", "NSE"),
        ("EASEMYTRIP", "NSE"), ("INDIAMART", "NSE"), ("JUSTDIAL", "NSE"),
        ("NAUKRI", "NSE"), ("INFOEDGE", "NSE"),

        # ── Cement & Construction ─────────────────────────────────────────────
        ("ULTRACEMCO", "NSE"), ("SHREECEM", "NSE"), ("AMBUJACEM", "NSE"),
        ("ACC", "NSE"), ("RAMCOCEM", "NSE"), ("JKCEMENT", "NSE"),
        ("HEIDELBERG", "NSE"), ("NCLIND", "NSE"),
        ("LT", "NSE"), ("NCC", "NSE"), ("KEC", "NSE"), ("KALPATPOWR", "NSE"),
        ("PNCINFRA", "NSE"), ("IRB", "NSE"), ("KNRCON", "NSE"), ("HGINFRA", "NSE"),

        # ── Real Estate ────────────────────────────────────────────────────────
        ("DLF", "NSE"), ("GODREJPROP", "NSE"), ("PRESTIGE", "NSE"),
        ("PHOENIXLTD", "NSE"), ("SOBHA", "NSE"), ("BRIGADE", "NSE"),
        ("OBEROIRLTY", "NSE"), ("MAHLIFE", "NSE"), ("SUNTECK", "NSE"),
        ("KOLTEPATIL", "NSE"),

        # ── Telecom & Media ────────────────────────────────────────────────────
        ("BHARTIARTL", "NSE"), ("IDEA", "NSE"), ("TATACOMM", "NSE"),
        ("HFCL", "NSE"), ("STLTECH", "NSE"), ("ZEEL", "NSE"),
        ("SUNTV", "NSE"), ("PVRINOX", "NSE"), ("INOXLEISUR", "NSE"),

        # ── Industrials & Capital Goods ────────────────────────────────────────
        ("SIEMENS", "NSE"), ("ABB", "NSE"), ("BHEL", "NSE"),
        ("THERMAX", "NSE"), ("CUMMINSIND", "NSE"), ("BEL", "NSE"),
        ("HAL", "NSE"), ("BEML", "NSE"), ("RVNL", "NSE"), ("IRCON", "NSE"),
        ("RITES", "NSE"), ("CONCOR", "NSE"), ("IRCTC", "NSE"),
        ("ADANIPORTS", "NSE"), ("GMRINFRA", "NSE"),
        ("HAVELLS", "NSE"), ("POLYCAB", "NSE"), ("VOLTAS", "NSE"),
        ("BLUESTARCO", "NSE"), ("CROMPTON", "NSE"), ("DIXON", "NSE"),
        ("AMBER", "NSE"), ("KAYNES", "NSE"), ("SYRMA", "NSE"), ("VGUARD", "NSE"),

        # ── Chemicals & Specialty ─────────────────────────────────────────────
        ("PIDILITIND", "NSE"), ("ASIANPAINT", "NSE"), ("BERGER", "NSE"),
        ("KANSAINER", "NSE"), ("AKZOINDIA", "NSE"), ("SRF", "NSE"),
        ("DEEPAKNTR", "NSE"), ("GNFC", "NSE"), ("GSFC", "NSE"), ("ATUL", "NSE"),
        ("NAVINFLUOR", "NSE"), ("FLUOROCHEM", "NSE"), ("FINEORG", "NSE"),
        ("TATACHEM", "NSE"), ("GHCL", "NSE"), ("VINATI", "NSE"),
        ("ALKYLAMINE", "NSE"),

        # ── Diversified Conglomerates ─────────────────────────────────────────
        ("TITAN", "NSE"), ("ADANIENT", "NSE"), ("ADANITRANS", "NSE"),
        ("BAJAJHLDNG", "NSE"), ("GRASIM", "NSE"),

        # ── Logistics & Transport ─────────────────────────────────────────────
        ("BLUEDART", "NSE"), ("DELHIVERY", "NSE"), ("GATI", "NSE"),
        ("TCI", "NSE"), ("SPICEJET", "NSE"), ("INDIGO", "NSE"),

        # ── Agriculture & Fertilizers ─────────────────────────────────────────
        ("UPL", "NSE"), ("PIIND", "NSE"), ("BAYER", "NSE"), ("RALLIS", "NSE"),
        ("DHANUKA", "NSE"), ("COROMANDEL", "NSE"), ("CHAMBAL", "NSE"),
        ("NFL", "NSE"),

        # ── Textiles ──────────────────────────────────────────────────────────
        ("PAGEIND", "NSE"), ("RAYMOND", "NSE"), ("ARVIND", "NSE"),
        ("WELSPUNIND", "NSE"), ("TRIDENT", "NSE"), ("VARDHMAN", "NSE"),

        # ── BSE-listed stocks (BSE exchange) ──────────────────────────────────
        # These are stocks that trade on BSE and may have different tokens
        ("RELIANCE", "BSE"), ("TCS", "BSE"), ("INFY", "BSE"), ("HDFCBANK", "BSE"),
        ("ICICIBANK", "BSE"), ("KOTAKBANK", "BSE"), ("AXISBANK", "BSE"),
        ("SBIN", "BSE"), ("BHARTIARTL", "BSE"), ("ITC", "BSE"),
        ("HINDUNILVR", "BSE"), ("BAJFINANCE", "BSE"), ("MARUTI", "BSE"),
        ("SUNPHARMA", "BSE"), ("TITAN", "BSE"), ("WIPRO", "BSE"),
        ("HCLTECH", "BSE"), ("NTPC", "BSE"), ("POWERGRID", "BSE"),
        ("ONGC", "BSE"), ("COALINDIA", "BSE"), ("TATAMOTORS", "BSE"),
        ("TATASTEEL", "BSE"), ("JSWSTEEL", "BSE"), ("HINDALCO", "BSE"),
        ("ADANIPORTS", "BSE"), ("ADANIENT", "BSE"), ("ADANIGREEN", "BSE"),
        ("CDSL", "BSE"), ("BSE", "BSE"), ("MCX", "BSE"),
        ("DRREDDY", "BSE"), ("CIPLA", "BSE"), ("DIVISLAB", "BSE"),
        ("LUPIN", "BSE"), ("APOLLOHOSP", "BSE"), ("DMART", "BSE"),
        ("ZOMATO", "BSE"), ("NYKAA", "BSE"), ("PAYTM", "BSE"),
        ("LT", "BSE"), ("ULTRACEMCO", "BSE"), ("GRASIM", "BSE"),
        ("ASIANPAINT", "BSE"), ("NESTLEIND", "BSE"), ("BRITANNIA", "BSE"),
        ("EICHERMOT", "BSE"), ("BAJAJ-AUTO", "BSE"), ("HEROMOTOCO", "BSE"),
        ("M&M", "BSE"), ("TATACONSUM", "BSE"), ("SIEMENS", "BSE"),
        ("ABB", "BSE"), ("HAL", "BSE"), ("BEL", "BSE"), ("IRCTC", "BSE"),
        ("CONCOR", "BSE"), ("PIDILITIND", "BSE"), ("HAVELLS", "BSE"),
        ("POLYCAB", "BSE"), ("DIXON", "BSE"), ("TITAN", "BSE"),
        ("MUTHOOTFIN", "BSE"), ("CHOLAFIN", "BSE"), ("BAJAJFINSV", "BSE"),
    ]

    pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5)
    ok, failed = 0, 0
    seen = set()

    for i, (symbol, exchange) in enumerate(TARGET_SYMBOLS, 1):
        key = (symbol, exchange)
        if key in seen:
            continue
        seen.add(key)

        token = token_map.get((symbol, exchange))
        if not token:
            print(f"[{i}] {symbol} ({exchange}) — ❌ not in scrip master")
            failed += 1
            continue

        # Rate limit pause
        time.sleep(1.2)

        # Fetch OHLCV directly
        candles = fetch_ohlcv(smart, symbol, token, exchange=exchange)
        if not candles or len(candles) < 30:
            print(f"[{i}] {symbol} ({exchange}) — ❌ insufficient data ({len(candles) if candles else 0} days)")
            failed += 1
            time.sleep(1.0)
            continue

        ltp = float(candles[-1][4])

        # No price filter — load ALL price ranges
        async with pool.acquire() as conn:
            await upsert_stock(conn, symbol, exchange, token)
            n = await upsert_ohlcv(conn, symbol, exchange, candles)

        print(f"[{i}] {symbol} ({exchange}) — ✅ {n} days | LTP ₹{ltp:,.2f}")
        ok += 1

    await pool.close()
    print(f"\n{'='*50}")
    print(f"✅ Loaded: {ok} stocks (NSE + BSE, all price ranges)")
    print(f"❌ Failed:  {failed} stocks")
    print(f"\nNext step: POST /api/screener/run")


if __name__ == "__main__":
    asyncio.run(main())

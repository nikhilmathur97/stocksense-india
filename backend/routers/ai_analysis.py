"""
Claude AI Analysis Router — AWS Bedrock + Anthropic fallback
Model: claude-sonnet-4-5 via AWS Bedrock (primary)
       claude-opus-4-8 via Anthropic API (fallback)

Streams real-time stock analysis as Server-Sent Events (SSE).
Uses prompt caching on system prompt to reduce cost and latency.
"""
import json
import logging
import os
import sys
from datetime import datetime
from decimal import Decimal
from typing import AsyncGenerator

import boto3
import botocore.config
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from backend.database import get_db, get_redis

logger = logging.getLogger("ai_analysis")

router = APIRouter(prefix="/api/ai", tags=["AI Analysis"])

# ── Model Config ──────────────────────────────────────────────────────────────
# AWS Bedrock: claude-sonnet-4-5 (latest, best quality/cost ratio)
BEDROCK_MODEL_ID   = "anthropic.claude-sonnet-4-5"
BEDROCK_REGION     = os.getenv("AWS_BEDROCK_REGION", "us-east-1")

# Fallback: Anthropic direct API
ANTHROPIC_MODEL_ID = "claude-opus-4-8"

# ── System Prompt (cached — never changes across requests) ────────────────────
SYSTEM_PROMPT = """You are a senior technical analyst and scalper for Indian equity markets (NSE/BSE).
You have 15+ years of experience trading Nifty 50 stocks. You are precise, data-driven, and ruthless about risk.

━━━ ABSOLUTE RULES — NEVER BREAK THESE ━━━
1. Angel One API = data only. NO trades execute via API. User executes manually.
2. ONLY recommend a trade when ALL 6 criteria pass simultaneously:
   • AI screener probability ≥ 85%
   • Confidence: HIGH only
   • Risk:Reward ≥ 1:2
   • ADX > 25 (confirmed trend strength)
   • Supertrend aligned with signal direction
   • MACD histogram aligned with signal direction
3. ANY criteria failing = ❌ AVOID. Zero exceptions.
4. Capital context: user has ₹20,000. Target 5–10% profit per trade = ₹1,000–₹2,000.
5. Hold window: 4–7 days ideal, absolute max 10 days. Never recommend holding beyond 10 days.
6. Always give EXACT hold days estimate — not a range, a specific number.
7. Always give EXACT position size in shares based on capital and stock price.
8. Accuracy bar is 85%+ — if you are not confident, say AVOID.
9. Use Indian market context: NSE/BSE, IST timezone, ₹ currency, Nifty/Sensex as benchmark.
10. Consider sector rotation, FII/DII activity patterns, and F&O expiry effects.

━━━ SCALPER OUTPUT FORMAT (mandatory for every trade) ━━━
✅ HIGH CONFIDENCE SETUP — [SYMBOL]
Action: BUY / SELL
Entry: ₹X | Target: ₹X | Stop-Loss: ₹X
Expected gain: X% = ₹X profit on ₹20K
Position size: BUY X shares (costs ₹X of your ₹20K)
R:R Ratio: 1:X
Hold: X days (exit by [day name] approximately)
Probability: X%
Why: [1 sentence — strongest signal only]
Invalidated if: [exact price level that breaks setup]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For non-qualifying stocks: ❌ AVOID [SYMBOL] — [which criteria failed, 1 line]"""


# ── AWS Bedrock Client ────────────────────────────────────────────────────────
def _get_bedrock_client():
    """Create AWS Bedrock runtime client using env credentials."""
    return boto3.client(
        service_name="bedrock-runtime",
        region_name=BEDROCK_REGION,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        aws_session_token=os.getenv("AWS_SESSION_TOKEN"),  # optional, for temp creds
        config=botocore.config.Config(
            read_timeout=120,
            connect_timeout=10,
            retries={"max_attempts": 2},
        ),
    )


def _float(v):
    """Convert Decimal or None to float safely."""
    if v is None:
        return None
    return float(v) if isinstance(v, Decimal) else v


# ── Bedrock Streaming ─────────────────────────────────────────────────────────
async def _stream_bedrock(prompt: str) -> AsyncGenerator[str, None]:
    """
    Stream Claude Sonnet 4.5 via AWS Bedrock using converse_stream API.
    Falls back to Anthropic direct API if Bedrock credentials not set.
    """
    aws_key = os.getenv("AWS_ACCESS_KEY_ID")
    aws_secret = os.getenv("AWS_SECRET_ACCESS_KEY")

    # ── Try AWS Bedrock first ─────────────────────────────────────────────────
    if aws_key and aws_secret:
        try:
            client = _get_bedrock_client()

            # converse_stream is the modern Bedrock streaming API
            response = client.converse_stream(
                modelId=BEDROCK_MODEL_ID,
                system=[{"text": SYSTEM_PROMPT}],
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig={
                    "maxTokens": 2048,
                    "temperature": 0.3,   # low temp = consistent, precise trading advice
                    "topP": 0.9,
                },
            )

            stream = response.get("stream")
            if stream:
                input_tokens = 0
                output_tokens = 0
                for event in stream:
                    if "contentBlockDelta" in event:
                        delta = event["contentBlockDelta"].get("delta", {})
                        text_chunk = delta.get("text", "")
                        if text_chunk:
                            yield "data: " + json.dumps({"type": "text", "chunk": text_chunk, "model": "bedrock/claude-sonnet-4-5"}) + "\n\n"

                    elif "metadata" in event:
                        usage = event["metadata"].get("usage", {})
                        input_tokens = usage.get("inputTokens", 0)
                        output_tokens = usage.get("outputTokens", 0)

                yield "data: " + json.dumps({
                    "type": "done",
                    "model": f"bedrock/{BEDROCK_MODEL_ID}",
                    "usage": {"input_tokens": input_tokens, "output_tokens": output_tokens},
                }) + "\n\n"
                return

        except client.exceptions.AccessDeniedException:
            logger.warning("Bedrock access denied — check IAM permissions for bedrock:InvokeModelWithResponseStream")
            yield "data: " + json.dumps({"type": "warning", "chunk": "\n⚠️ AWS Bedrock access denied. Falling back to Anthropic API...\n\n"}) + "\n\n"
        except client.exceptions.ModelNotReadyException:
            logger.warning(f"Bedrock model {BEDROCK_MODEL_ID} not enabled in region {BEDROCK_REGION}")
            yield "data: " + json.dumps({"type": "warning", "chunk": f"\n⚠️ Model not enabled in {BEDROCK_REGION}. Enable it in AWS Console → Bedrock → Model Access.\n\n"}) + "\n\n"
        except Exception as e:
            logger.warning(f"Bedrock error: {e} — falling back to Anthropic")
            yield "data: " + json.dumps({"type": "warning", "chunk": f"\n⚠️ Bedrock error ({type(e).__name__}). Falling back to Anthropic API...\n\n"}) + "\n\n"

    # ── Fallback: Anthropic direct API ────────────────────────────────────────
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    if not anthropic_key:
        yield "data: " + json.dumps({
            "error": "No AI credentials configured. Set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY (Bedrock) or ANTHROPIC_API_KEY in .env"
        }) + "\n\n"
        return

    try:
        import anthropic as _anthropic
        client_ant = _anthropic.AsyncAnthropic(api_key=anthropic_key)

        async with client_ant.messages.stream(
            model=ANTHROPIC_MODEL_ID,
            max_tokens=2048,
            system=[{
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            async for text_chunk in stream.text_stream:
                yield "data: " + json.dumps({"type": "text", "chunk": text_chunk, "model": f"anthropic/{ANTHROPIC_MODEL_ID}"}) + "\n\n"

            final = await stream.get_final_message()
            yield "data: " + json.dumps({
                "type": "done",
                "model": f"anthropic/{ANTHROPIC_MODEL_ID}",
                "usage": {
                    "input_tokens": final.usage.input_tokens,
                    "output_tokens": final.usage.output_tokens,
                    "cache_read": getattr(final.usage, "cache_read_input_tokens", 0),
                },
            }) + "\n\n"

    except Exception as e:
        yield "data: " + json.dumps({"error": f"AI analysis failed: {str(e)}"}) + "\n\n"


# ── Position Sizing ───────────────────────────────────────────────────────────
def _calc_position(capital: float, price: float, sl: float) -> dict:
    """Position sizing: risk max 2% of capital per trade."""
    risk_per_share = price - sl
    if risk_per_share <= 0:
        risk_per_share = price * 0.03
    max_risk_amount = capital * 0.02          # risk only 2% of capital = ₹400 on ₹20K
    shares = int(max_risk_amount / risk_per_share)
    shares = max(1, shares)
    cost = round(shares * price, 2)
    # Cap cost at 50% of capital so user stays diversified
    if cost > capital * 0.5:
        shares = int((capital * 0.5) / price)
        cost = round(shares * price, 2)
    profit_at_target_pct = 0.07              # 7% target
    profit_rs = round(cost * profit_at_target_pct, 2)
    return {
        "shares": shares,
        "cost": cost,
        "profit_rs": profit_rs,
        "risk_rs": round(shares * risk_per_share, 2),
    }


# ── Prompt Builder ────────────────────────────────────────────────────────────
def _build_analysis_prompt(symbol: str, data: dict) -> str:
    """Build the per-request prompt with all stock data for Claude — enhanced with
    sector performance, 52w context, multi-timeframe, options flow, and new indicators."""
    quote = data.get("quote", {})
    indicators = data.get("indicators", {})
    signal = data.get("signal", {})
    history = data.get("history", [])
    # Phase 6 additions
    sector_data = data.get("sector", {})
    options_data = data.get("options", {})
    mtf_data = data.get("multi_timeframe", {})

    ltp = _float(quote.get("ltp", 0))
    change_pct = _float(quote.get("change_pct", 0))
    volume = quote.get("volume", 0)

    # Recent price summary (last 5 days)
    recent_closes = [f"₹{c['close']:,.2f}" for c in history[-5:]] if history else []
    recent_str = " → ".join(recent_closes) if recent_closes else "no recent data"

    # Price trend direction
    if len(history) >= 2:
        trend = "📈 uptrend" if history[-1]["close"] > history[-2]["close"] else "📉 downtrend"
    else:
        trend = "unknown"

    # Key indicators
    rsi = _float(indicators.get("rsi_14"))
    macd = _float(indicators.get("macd"))
    macd_hist = _float(indicators.get("macd_hist"))
    ema_9 = _float(indicators.get("ema_9"))
    ema_21 = _float(indicators.get("ema_21"))
    ema_50 = _float(indicators.get("ema_50"))
    ema_200 = _float(indicators.get("ema_200"))
    bb_upper = _float(indicators.get("bb_upper"))
    bb_lower = _float(indicators.get("bb_lower"))
    bb_width = _float(indicators.get("bb_width"))
    adx = _float(indicators.get("adx_14"))
    supertrend_dir = indicators.get("supertrend_direction")
    vol_ratio = _float(indicators.get("volume_ratio"))
    mfi = _float(indicators.get("mfi_14"))
    stoch_k = _float(indicators.get("stoch_k"))
    stoch_d = _float(indicators.get("stoch_d"))
    overall_signal = indicators.get("overall_signal", "NEUTRAL")
    pattern = indicators.get("candlestick_pattern")
    atr = _float(indicators.get("atr_14"))

    # New Phase 1 indicators
    cci = _float(indicators.get("cci_20"))
    ichimoku_signal = indicators.get("ichimoku_signal", "")
    ha_trend = indicators.get("ha_trend", "")
    ha_strength = indicators.get("ha_trend_strength", 0)
    pivot_p = _float(indicators.get("pivot_classic_p"))
    pivot_r1 = _float(indicators.get("pivot_classic_r1"))
    pivot_s1 = _float(indicators.get("pivot_classic_s1"))
    fib_support = _float(indicators.get("fib_nearest_support"))
    fib_resistance = _float(indicators.get("fib_nearest_resistance"))
    vwap = _float(indicators.get("vwap"))

    # EMA alignment
    ema_aligned = ""
    if ema_9 and ema_21 and ema_50 and ltp:
        if ltp > ema_9 > ema_21 > ema_50:
            ema_aligned = "✅ BULLISH — price > EMA9 > EMA21 > EMA50"
        elif ltp < ema_9 < ema_21 < ema_50:
            ema_aligned = "❌ BEARISH — price < EMA9 < EMA21 < EMA50"
        else:
            ema_aligned = "⚠️ MIXED — EMAs not aligned"

    # AI signal
    prob_7d = _float(signal.get("probability_7d"))
    target_7d = _float(signal.get("target_7d"))
    stop_loss = _float(signal.get("stop_loss"))
    rr = _float(signal.get("risk_reward_ratio"))
    category = signal.get("category", "")
    top_reasons = signal.get("top_reasons", [])
    confidence = signal.get("confidence", "")

    # 52-week high/low context
    w52_high = _float(signal.get("52w_high"))
    w52_low = _float(signal.get("52w_low"))
    pct_from_high = _float(signal.get("pct_from_52w_high"))
    pct_from_low = _float(signal.get("pct_from_52w_low"))
    w52_context = ""
    if w52_high and w52_low:
        w52_context = f"52W High: ₹{w52_high:,.2f} ({pct_from_high:.1f}% away) | 52W Low: ₹{w52_low:,.2f} ({pct_from_low:.1f}% above)"
        if pct_from_high < 5:
            w52_context += " ⚠️ NEAR 52W HIGH — breakout or reversal zone"
        elif pct_from_low < 10:
            w52_context += " 🟢 NEAR 52W LOW — potential accumulation zone"

    # Sector context
    sector_context = ""
    if sector_data:
        sector_name = sector_data.get("sector", "")
        sector_change = _float(sector_data.get("avg_change_pct"))
        sector_signal = sector_data.get("signal", "")
        sector_breadth = _float(sector_data.get("breadth_pct"))
        if sector_name:
            sector_context = f"Sector: {sector_name} | Sector Change: {'+' if sector_change >= 0 else ''}{sector_change:.2f}% | Signal: {sector_signal} | Breadth: {sector_breadth:.0f}%"
            if sector_change > 1 and change_pct > sector_change:
                sector_context += " ✅ OUTPERFORMING sector"
            elif sector_change < -1 and change_pct < sector_change:
                sector_context += " ❌ UNDERPERFORMING sector"

    # Multi-timeframe context
    mtf_context = ""
    if mtf_data:
        confluence = mtf_data.get("confluence_signal", "NEUTRAL")
        aligned = mtf_data.get("aligned_timeframes", 0)
        total_tf = mtf_data.get("total_timeframes", 5)
        mtf_context = f"Multi-TF Confluence: {confluence} ({aligned}/{total_tf} aligned)"
        if aligned >= 4:
            mtf_context += " ✅ STRONG alignment — high probability"
        elif aligned <= 1:
            mtf_context += " ⚠️ WEAK alignment — conflicting signals"

    # Options flow context
    options_context = ""
    if options_data:
        pcr = _float(options_data.get("pcr"))
        max_pain = _float(options_data.get("max_pain"))
        if pcr:
            options_context = f"PCR: {pcr:.2f}"
            if pcr > 1.3:
                options_context += " (extreme fear → contrarian BUY)"
            elif pcr < 0.7:
                options_context += " (extreme greed → contrarian SELL)"
            else:
                options_context += " (neutral)"
        if max_pain:
            options_context += f" | Max Pain: ₹{max_pain:,.0f}"
            if ltp and abs(ltp - max_pain) / ltp < 0.02:
                options_context += " ⚠️ Price near max pain — likely to stay here till expiry"

    prompt = f"""Analyze this NSE stock for a ₹20,000 capital scalper trade (4–10 day hold):

═══════════════════════════════════════════
STOCK: {symbol} | NSE
Current Price: ₹{ltp:,.2f} | Change: {'+' if change_pct >= 0 else ''}{change_pct:.2f}% today
Volume: {volume:,} | Trend: {trend}
Recent 5-day closes: {recent_str}
ATR(14): {f'₹{atr:,.2f}' if atr else 'N/A'} (daily volatility measure)
{w52_context}
═══════════════════════════════════════════

TECHNICAL INDICATORS:
• RSI(14): {f'{rsi:.1f}' if rsi else 'N/A'} {'🔴 OVERBOUGHT — pullback risk' if rsi and rsi > 70 else '🟢 OVERSOLD — bounce opportunity' if rsi and rsi < 30 else '✅ healthy zone' if rsi and 40 <= rsi <= 65 else ''}
• MACD: {f'{macd:.3f}' if macd else 'N/A'} | Histogram: {f'{macd_hist:.3f}' if macd_hist else 'N/A'} {'↑ BULLISH momentum' if macd_hist and macd_hist > 0 else '↓ BEARISH momentum' if macd_hist else ''}
• EMA Alignment: {ema_aligned or 'N/A'}
  - EMA 9: {f'₹{ema_9:,.2f}' if ema_9 else 'N/A'} | EMA 21: {f'₹{ema_21:,.2f}' if ema_21 else 'N/A'} | EMA 50: {f'₹{ema_50:,.2f}' if ema_50 else 'N/A'} | EMA 200: {f'₹{ema_200:,.2f}' if ema_200 else 'N/A'}
• Bollinger Bands: Upper ₹{f'{bb_upper:,.2f}' if bb_upper else 'N/A'} | Lower ₹{f'{bb_lower:,.2f}' if bb_lower else 'N/A'} | Width: {f'{bb_width:.1f}%' if bb_width else 'N/A'}
  {'⚠️ Price near UPPER band — overbought' if bb_upper and ltp and ltp >= bb_upper * 0.98 else '✅ Price near LOWER band — mean reversion setup' if bb_lower and ltp and ltp <= bb_lower * 1.02 else ''}
• ADX(14): {f'{adx:.1f}' if adx else 'N/A'} {'✅ STRONG trend (>25)' if adx and adx > 25 else '⚠️ WEAK trend (<25) — choppy' if adx else ''}
• Supertrend: {'✅ 🟢 BULLISH — trend confirmed' if supertrend_dir == 1 else '❌ 🔴 BEARISH — trend down' if supertrend_dir == -1 else 'N/A'}
• CCI(20): {f'{cci:.0f}' if cci else 'N/A'} {'🟢 OVERSOLD' if cci and cci < -100 else '🔴 OVERBOUGHT' if cci and cci > 100 else ''}
• Ichimoku: {ichimoku_signal or 'N/A'} {'— price above cloud' if ichimoku_signal in ('BUY', 'STRONG_BUY') else '— price below cloud' if ichimoku_signal in ('SELL', 'STRONG_SELL') else ''}
• Heikin Ashi: {f'{ha_trend} ({ha_strength} consecutive)' if ha_trend else 'N/A'}
• VWAP: {f'₹{vwap:,.2f}' if vwap else 'N/A'} {'— price ABOVE VWAP (bullish)' if vwap and ltp and ltp > vwap else '— price BELOW VWAP (bearish)' if vwap and ltp and ltp < vwap else ''}
• Stochastic K/D: {f'{stoch_k:.1f}/{stoch_d:.1f}' if stoch_k and stoch_d else 'N/A'}
• MFI(14): {f'{mfi:.1f}' if mfi else 'N/A'} {'(overbought)' if mfi and mfi > 80 else '(oversold — accumulation)' if mfi and mfi < 20 else ''}
• Volume Ratio: {f'{vol_ratio:.1f}x average' if vol_ratio else 'N/A'} {'🔥 HIGH volume surge' if vol_ratio and vol_ratio >= 2 else '✅ above average' if vol_ratio and vol_ratio >= 1.5 else '⚠️ low volume' if vol_ratio and vol_ratio < 0.8 else ''}
• Candlestick Pattern: {pattern or 'None detected'}
• Overall Signal: **{overall_signal}**

KEY LEVELS (Pivot/Fibonacci):
• Daily Pivot: {f'₹{pivot_p:,.2f}' if pivot_p else 'N/A'} | R1: {f'₹{pivot_r1:,.2f}' if pivot_r1 else 'N/A'} | S1: {f'₹{pivot_s1:,.2f}' if pivot_s1 else 'N/A'}
• Fibonacci Support: {f'₹{fib_support:,.2f}' if fib_support else 'N/A'} | Resistance: {f'₹{fib_resistance:,.2f}' if fib_resistance else 'N/A'}

{f'SECTOR CONTEXT: {sector_context}' if sector_context else ''}
{f'MULTI-TIMEFRAME: {mtf_context}' if mtf_context else ''}
{f'OPTIONS FLOW: {options_context}' if options_context else ''}

AI SCREENER SIGNAL:
• Category: {category or 'N/A'}
• 7-Day Probability: {f'{prob_7d:.1f}%' if prob_7d else 'N/A'} | Confidence: {confidence or 'N/A'}
• Entry: ₹{f'{signal.get("entry_price", 0):,.2f}'} | Target: ₹{f'{target_7d:,.2f}' if target_7d else 'N/A'} | Stop-Loss: ₹{f'{stop_loss:,.2f}' if stop_loss else 'N/A'}
• Risk/Reward: {f'1:{rr:.1f}' if rr else 'N/A'}
• Key reasons: {'; '.join(top_reasons[:3]) if top_reasons else 'N/A'}

═══════════════════════════════════════════
Provide analysis in EXACTLY this format:

## 📊 Setup Summary
[2-3 sentences on what the chart is showing RIGHT NOW — be specific with price levels. Include sector context and multi-timeframe alignment.]

## 🟢 Bull Case
[Specific bullish factors with exact ₹ levels — what needs to happen for upside. Reference pivot/fib levels and options flow if available.]

## 🔴 Bear Case
[What could go wrong — exact ₹ levels that would invalidate the setup. Reference 52w context.]

## 📍 Key Levels
- **Resistance:** ₹X (reason), ₹Y (reason)
- **Support:** ₹X (reason), ₹Y (reason)
- **Stop-Loss:** ₹X — reason why this level is critical
- **Target:** ₹X (7 days), ₹Y (15 days)

## ⚡ Verdict
[Apply the 6-criteria filter. If ALL 6 pass → give the mandatory scalper format. If ANY fail → ❌ AVOID with exact reason]"""

    return prompt


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/analyze/{symbol}")
async def analyze_stock(
    symbol: str,
    exchange: str = Query(default="NSE"),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """
    Stream Claude Sonnet 4.5 (Bedrock) analysis for a stock.
    Returns Server-Sent Events — connect with EventSource in browser.
    """
    sym = symbol.upper()
    exch = exchange.upper()
    data = {}

    # 1. Quote (Redis cache first, then DB)
    cached_quote = await redis.get(f"quote:{exch}:{sym}")
    if cached_quote:
        data["quote"] = json.loads(cached_quote)
    else:
        row = await db.execute(
            text("""
            SELECT close AS ltp, open, high, low, volume, date,
                   (close - LAG(close) OVER (ORDER BY date)) / NULLIF(LAG(close) OVER (ORDER BY date), 0) * 100 AS change_pct
            FROM ohlcv_daily WHERE symbol=:sym AND exchange=:exch
            ORDER BY date DESC LIMIT 2
            """),
            {"sym": sym, "exch": exch},
        )
        r = row.fetchone()
        if r:
            data["quote"] = {
                "ltp": float(r[0]), "open": float(r[1]),
                "high": float(r[2]), "low": float(r[3]),
                "volume": int(r[4] or 0),
                "change_pct": float(r[6]) if r[6] else 0,
            }

    # 2. Technical indicators (DB first, compute on-the-fly if missing)
    ind_row = await db.execute(
        text("""
        SELECT rsi_14, macd, macd_hist, macd_signal,
               ema_9, ema_21, ema_50, ema_200, sma_20, vwap,
               bb_upper, bb_middle, bb_lower, bb_width,
               adx_14, supertrend, supertrend_direction,
               stoch_k, stoch_d, williams_r, mfi_14,
               obv, volume_sma_20, atr_14
        FROM technical_indicators
        WHERE symbol=:sym AND exchange=:exch AND timeframe='1d'
        ORDER BY time DESC LIMIT 1
        """),
        {"sym": sym, "exch": exch},
    )
    ind = ind_row.fetchone()
    if ind:
        cols = ["rsi_14", "macd", "macd_hist", "macd_signal",
                "ema_9", "ema_21", "ema_50", "ema_200", "sma_20", "vwap",
                "bb_upper", "bb_middle", "bb_lower", "bb_width",
                "adx_14", "supertrend", "supertrend_direction",
                "stoch_k", "stoch_d", "williams_r", "mfi_14",
                "obv", "volume_sma_20", "atr_14"]
        data["indicators"] = {k: _float(v) if k != "supertrend_direction" else v for k, v in zip(cols, ind)}
        if data["indicators"].get("volume_sma_20"):
            vol_now = data.get("quote", {}).get("volume", 0)
            avg = float(data["indicators"]["volume_sma_20"])
            data["indicators"]["volume_ratio"] = round(vol_now / avg, 2) if avg > 0 else 1.0
    else:
        from engine.indicators import calculate_all_indicators
        import pandas as pd
        rows = await db.execute(
            text("""
            SELECT date AS time, open, high, low, close, volume
            FROM ohlcv_daily WHERE symbol=:sym AND exchange=:exch
            ORDER BY date ASC LIMIT 200
            """),
            {"sym": sym, "exch": exch},
        )
        ohlcv = rows.fetchall()
        if len(ohlcv) >= 30:
            df = pd.DataFrame([dict(r._mapping) for r in ohlcv])
            df["time"] = df["time"].astype(str)
            data["indicators"] = calculate_all_indicators(df)

    # 3. AI Screener signal
    sig_row = await db.execute(
        text("""
        SELECT signal_type, probability_7d, probability_15d,
               entry_price, target_7d, stop_loss, risk_reward_ratio,
               confidence, category, top_reasons, reasoning
        FROM stock_signals
        WHERE symbol=:sym AND exchange=:exch AND is_active=TRUE
        ORDER BY created_at DESC LIMIT 1
        """),
        {"sym": sym, "exch": exch},
    )
    sig = sig_row.fetchone()
    if sig:
        data["signal"] = {
            "signal_type": sig[0],
            "probability_7d": _float(sig[1]),
            "probability_15d": _float(sig[2]),
            "entry_price": _float(sig[3]),
            "target_7d": _float(sig[4]),
            "stop_loss": _float(sig[5]),
            "risk_reward_ratio": _float(sig[6]),
            "confidence": sig[7],
            "category": sig[8],
            "top_reasons": sig[9] or [],
            "reasoning": sig[10],
        }

    # 4. Recent OHLCV history (last 10 days)
    hist_rows = await db.execute(
        text("""
        SELECT date::text AS time, open, high, low, close, volume
        FROM ohlcv_daily WHERE symbol=:sym AND exchange=:exch
        ORDER BY date DESC LIMIT 10
        """),
        {"sym": sym, "exch": exch},
    )
    data["history"] = [
        {k: float(v) if isinstance(v, Decimal) else v for k, v in dict(r._mapping).items()}
        for r in reversed(hist_rows.fetchall())
    ]

    if not data.get("quote") and not data.get("indicators"):
        raise HTTPException(status_code=404, detail=f"No data found for {sym}. Run the screener first.")

    # 5. Sector context (Phase 6 enhancement)
    try:
        from backend.routers.market import SECTOR_STOCKS
        sector_name = ""
        for s_name, s_stocks in SECTOR_STOCKS.items():
            if sym in s_stocks:
                sector_name = s_name
                break
        if sector_name:
            sector_cache = await redis.get("sector_performance")
            if sector_cache:
                sp_data = json.loads(sector_cache)
                for s in sp_data.get("sectors", []):
                    if s["sector"] == sector_name:
                        data["sector"] = s
                        break
    except Exception:
        pass

    # 6. Options flow context (Phase 6 enhancement)
    try:
        pcr_raw = await redis.get(f"pcr:{sym}")
        if pcr_raw:
            data["options"] = json.loads(pcr_raw)
    except Exception:
        pass

    # 7. Multi-timeframe context (Phase 6 enhancement)
    try:
        mtf_raw = await redis.get(f"mtf:{sym}")
        if mtf_raw:
            data["multi_timeframe"] = json.loads(mtf_raw)
    except Exception:
        pass

    prompt = _build_analysis_prompt(sym, data)

    return StreamingResponse(
        _stream_bedrock(prompt),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/scalper")
async def scalper(
    capital: float = Query(default=20000.0, description="Your trading capital in ₹"),
    min_price: float = Query(default=50.0),
    max_price: float = Query(default=2000.0),
    limit: int = Query(default=8, le=20),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """
    Scalper endpoint — ₹20K capital, 5-10% profit target, 4-10 day hold.
    Streams Claude Sonnet 4.5 (Bedrock) analysis for stocks passing all 6 criteria.
    """
    rows = await db.execute(
        text("""
        SELECT ss.symbol, ss.exchange, ss.signal_type,
               ss.probability_score, ss.probability_7d,
               ss.entry_price, ss.target_7d, ss.stop_loss,
               ss.risk_reward_ratio, ss.confidence, ss.category,
               ss.top_reasons, ss.estimated_hold_days,
               ss.expected_return_7d,
               ti.rsi_14, ti.macd_hist, ti.supertrend_direction,
               ti.adx_14, ti.ema_50, ti.atr_14
        FROM stock_signals ss
        LEFT JOIN LATERAL (
            SELECT rsi_14, macd_hist, supertrend_direction,
                   adx_14, ema_50, atr_14
            FROM technical_indicators
            WHERE symbol = ss.symbol AND exchange = ss.exchange AND timeframe = '1d'
            ORDER BY time DESC LIMIT 1
        ) ti ON TRUE
        WHERE ss.is_active = TRUE
          AND ss.probability_7d >= 55
        ORDER BY ss.probability_score DESC
        LIMIT 60
        """)
    )
    all_signals = rows.fetchall()

    if not all_signals:
        raise HTTPException(
            status_code=404,
            detail="No signals found. Run POST /api/screener/run first to scan stocks."
        )

    picks = []
    for row in all_signals:
        sig = {k: (_float(v) if isinstance(v, Decimal) else v) for k, v in dict(row._mapping).items()}
        live_price = None
        cached = await redis.get(f"quote:{sig['exchange']}:{sig['symbol']}")
        if cached:
            q = json.loads(cached)
            live_price = q.get("ltp") or q.get("close")
        live_price = live_price or sig.get("entry_price") or 0

        if not (min_price <= live_price <= max_price):
            continue

        sig["live_price"] = live_price
        sig["position"] = _calc_position(capital, live_price, sig.get("stop_loss") or live_price * 0.97)
        sig["top_reasons"] = sig.get("top_reasons") or []
        picks.append(sig)

        if len(picks) >= limit:
            break

    if not picks:
        raise HTTPException(
            status_code=404,
            detail=f"No qualifying stocks in ₹{min_price:.0f}–₹{max_price:.0f} range. Broaden price range or wait for screener refresh."
        )

    # Build scalper prompt for Claude Sonnet 4.5
    today = datetime.now().strftime("%A %d %b %Y")
    lines = []
    for i, s in enumerate(picks, 1):
        pos = s["position"]
        rsi = f"{s['rsi_14']:.1f}" if s.get("rsi_14") else "N/A"
        adx = f"{s['adx_14']:.0f}" if s.get("adx_14") else "N/A"
        st = "✅ Bullish" if s.get("supertrend_direction") == 1 else "❌ Bearish" if s.get("supertrend_direction") == -1 else "N/A"
        macd_d = "↑ positive" if (s.get("macd_hist") or 0) > 0 else "↓ negative"
        hold = s.get("estimated_hold_days") or "?"
        reasons = "; ".join(s["top_reasons"][:2]) or "N/A"
        lines.append(
            f"{i}. {s['symbol']} ({s['exchange']}) | Live: ₹{s['live_price']:,.2f} | "
            f"Prob: {s.get('probability_7d', 0):.1f}% | Score: {s.get('probability_score', 0):.1f} | "
            f"Confidence: {s.get('confidence','?')} | Signal: {s.get('signal_type','?')} | "
            f"Target: ₹{s.get('target_7d', 0):,.2f} | SL: ₹{s.get('stop_loss', 0):,.2f} | "
            f"R:R 1:{s.get('risk_reward_ratio', 0):.1f} | Expected gain: {s.get('expected_return_7d', 7):.1f}% | "
            f"Est. hold: {hold} days | RSI: {rsi} | ADX: {adx} | Supertrend: {st} | MACD hist: {macd_d} | "
            f"Position: {pos['shares']} shares = ₹{pos['cost']:,.0f} | "
            f"Profit at target: ₹{pos['profit_rs']:,.0f} | Risk: ₹{pos['risk_rs']:,.0f} | "
            f"Reasons: {reasons}"
        )

    stocks_block = "\n".join(lines)
    prompt = f"""Today is {today}. Capital: ₹{capital:,.0f}. Target: 5–10% profit (₹{capital*0.05:,.0f}–₹{capital*0.10:,.0f}) per trade. Max hold: 10 days.

These {len(picks)} stocks have passed the AI screener. Angel One data only — user executes manually.

{stocks_block}

For EACH stock apply the 6-criteria filter and give the mandatory scalper format (or ❌ AVOID). Then:

## SCALPER VERDICT — TODAY'S BEST TRADE
Pick the single best trade. Give:
- Symbol and action (BUY/SELL)
- Exact entry ₹, target ₹, stop-loss ₹
- Exact shares to buy with ₹{capital:,.0f} capital
- Exact ₹ profit expected and ₹ risk
- Exact hold days (e.g. "Hold 5 days — exit by Friday")
- One sentence on why this is today's strongest setup

Be a ruthless scalper. Reject anything that is not near-perfect."""

    return StreamingResponse(
        _stream_bedrock(prompt),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.get("/trade-signals")
async def trade_signals(
    min_price: float = Query(default=50.0, description="Min stock price in ₹"),
    max_price: float = Query(default=2000.0, description="Max stock price in ₹"),
    min_probability: float = Query(default=60.0, description="Min 7-day profit probability %"),
    limit: int = Query(default=10, le=30),
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """
    Stream Claude Sonnet 4.5 trade picks filtered by price range.
    Uses real-time quotes from Angel One + AI probability scores.
    """
    rows = await db.execute(
        text("""
        SELECT ss.symbol, ss.exchange, ss.signal_type, ss.category,
               ss.probability_7d, ss.probability_15d, ss.probability_score,
               ss.entry_price, ss.target_7d, ss.stop_loss, ss.risk_reward_ratio,
               ss.confidence, ss.top_reasons,
               ti.rsi_14, ti.macd_hist, ti.supertrend_direction,
               ti.adx_14, ti.ema_50
        FROM stock_signals ss
        LEFT JOIN LATERAL (
            SELECT rsi_14, macd_hist, supertrend_direction, adx_14, ema_50
            FROM technical_indicators
            WHERE symbol = ss.symbol AND exchange = ss.exchange AND timeframe = '1d'
            ORDER BY time DESC LIMIT 1
        ) ti ON TRUE
        WHERE ss.is_active = TRUE
          AND ss.probability_7d >= GREATEST(:min_prob, 80)
          AND ss.confidence IN ('HIGH', 'VERY_HIGH')
          AND ss.risk_reward_ratio >= 2.0
          AND (ti.adx_14 IS NULL OR ti.adx_14 > 25)
          AND (
              (ss.signal_type IN ('BUY','STRONG_BUY') AND (ti.supertrend_direction IS NULL OR ti.supertrend_direction = 1)  AND (ti.macd_hist IS NULL OR ti.macd_hist > 0))
           OR (ss.signal_type = 'SELL' AND (ti.supertrend_direction IS NULL OR ti.supertrend_direction = -1) AND (ti.macd_hist IS NULL OR ti.macd_hist < 0))
          )
        ORDER BY ss.probability_score DESC
        LIMIT 100
        """),
        {"min_prob": min_probability},
    )
    all_signals = rows.fetchall()

    if not all_signals:
        raise HTTPException(status_code=404, detail="No active signals found. Run the screener first.")

    filtered = []
    for row in all_signals:
        sig = {k: _float(v) if isinstance(v, Decimal) else v for k, v in dict(row._mapping).items()}
        live_price = None
        cached = await redis.get(f"quote:{sig['exchange']}:{sig['symbol']}")
        if cached:
            q = json.loads(cached)
            live_price = q.get("ltp") or q.get("close")
        if not live_price:
            live_price = float(sig.get("entry_price") or 0)
        if live_price and min_price <= live_price <= max_price:
            sig["live_price"] = live_price
            filtered.append(sig)
        if len(filtered) >= limit:
            break

    if not filtered:
        raise HTTPException(
            status_code=404,
            detail=f"No signals found in ₹{min_price:.0f}–₹{max_price:.0f} range with ≥{min_probability:.0f}% probability."
        )

    lines = []
    for i, s in enumerate(filtered, 1):
        reasons = "; ".join((s.get("top_reasons") or [])[:2]) or "N/A"
        rsi = f"{s['rsi_14']:.1f}" if s.get("rsi_14") else "N/A"
        macd_dir = "↑ bullish" if (s.get("macd_hist") or 0) > 0 else "↓ bearish"
        st = "🟢 Bull" if s.get("supertrend_direction") == 1 else "🔴 Bear" if s.get("supertrend_direction") == -1 else "—"
        adx = f"{s['adx_14']:.0f}" if s.get("adx_14") else "N/A"
        lines.append(
            f"{i}. **{s['symbol']}** ({s['exchange']}) | ₹{s['live_price']:,.2f} | "
            f"7d prob: {s.get('probability_7d') or 0:.0f}% | "
            f"Target: ₹{s.get('target_7d') or 0:,.0f} | SL: ₹{s.get('stop_loss') or 0:,.0f} | "
            f"R:R 1:{s.get('risk_reward_ratio') or 0:.1f} | "
            f"RSI: {rsi} | MACD: {macd_dir} | Supertrend: {st} | ADX: {adx} | "
            f"Signal: {s.get('signal_type','?')} | Confidence: {s.get('confidence','?')} | "
            f"Why: {reasons}"
        )

    stocks_block = "\n".join(lines)
    prompt = f"""These {len(filtered)} NSE/BSE stocks (₹{min_price:.0f}–₹{max_price:.0f} range) have passed ALL 6 high-confidence filters: ≥80% 7-day probability, HIGH confidence, R:R ≥ 1:2, ADX > 25, Supertrend aligned, MACD aligned.

NOTE: Angel One API is used for data only — NO trades are executed via API. User executes manually.

**Pre-filtered HIGH CONFIDENCE stocks (sorted by AI score):**
{stocks_block}

**For EACH stock provide exactly this format:**

## [RANK]. SYMBOL — ₹PRICE  ✅ HIGH CONFIDENCE SETUP

**Action:** BUY / SELL
**7-Day Profit Probability:** X%
**Entry:** ₹X | **Target:** ₹X | **Stop-Loss:** ₹X | **R:R:** 1:X
**Strongest signal:** 1 sentence — the single most compelling reason
**What invalidates this:** 1 sentence — the exact price level that breaks the setup

---

End with:

## Best Trade Today
[Single best pick — name it, 2 sentences, exact levels, why it's the strongest setup of the group]

Be extremely specific with ₹ levels. Under 600 words total."""

    return StreamingResponse(
        _stream_bedrock(prompt),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.get("/market-pulse")
async def market_pulse(
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    """
    Stream a quick AI market pulse — top signals + sector summary.
    Uses Claude Sonnet 4.5 via AWS Bedrock.
    """
    rows = await db.execute(
        text("""
        SELECT symbol, exchange, probability_score, probability_7d,
               signal_type, category, top_reasons, entry_price, target_7d, stop_loss
        FROM stock_signals
        WHERE is_active=TRUE
        ORDER BY probability_score DESC LIMIT 5
        """)
    )
    signals = []
    for r in rows.fetchall():
        signals.append({
            "symbol": r[0], "exchange": r[1],
            "prob": float(r[2] or 0), "prob_7d": float(r[3] or 0),
            "signal_type": r[4], "category": r[5],
            "reasons": r[6] or [], "entry": float(r[7] or 0),
            "target": float(r[8] or 0), "stop": float(r[9] or 0),
        })

    sector_rows = await db.execute(
        text("""
        SELECT s.sector,
               AVG((o.close - o.prev_close) / NULLIF(o.prev_close, 0) * 100) AS avg_chg,
               COUNT(DISTINCT s.symbol) AS cnt
        FROM stocks s
        JOIN LATERAL (
            SELECT (array_agg(close ORDER BY date DESC))[1] AS close,
                   (array_agg(close ORDER BY date DESC))[2] AS prev_close
            FROM ohlcv_daily WHERE symbol=s.symbol AND exchange=s.exchange
        ) o ON TRUE
        WHERE s.sector IS NOT NULL AND s.sector != 'Index'
        GROUP BY s.sector ORDER BY avg_chg DESC
        """)
    )
    sectors = [
        {"sector": r[0], "chg": round(float(r[1] or 0), 2), "count": r[2]}
        for r in sector_rows.fetchall()
    ]

    today = datetime.now().strftime("%A %d %b %Y, %H:%M IST")
    prompt = f"""Give me a quick Indian market pulse. Today: {today}. Be direct and specific.

**Today's Top AI Signals:**
{chr(10).join(f'- {s["symbol"]}: {s["prob_7d"]:.0f}% prob | ₹{s["entry"]:,.0f} → ₹{s["target"]:,.0f} | SL ₹{s["stop"]:,.0f} | {s["category"]}' for s in signals)}

**Sector Performance:**
{chr(10).join(f'- {s["sector"]}: {s["chg"]:+.2f}% ({s["count"]} stocks)' for s in sectors)}

Provide:
## 🌡️ Market Mood
[2 sentences on overall market tone based on sector data — which sectors are leading/lagging]

## 🏆 Top Setup Today
[Pick the single best setup from the signals above — explain why in 3 sentences with specific ₹ levels]

## ⚠️ Watch Out For
[One key risk to monitor today — be specific]

Keep it under 200 words. Be direct — no fluff."""

    return StreamingResponse(
        _stream_bedrock(prompt),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )


@router.get("/config")
async def ai_config():
    """Show current AI configuration — which model and provider is active."""
    aws_key = os.getenv("AWS_ACCESS_KEY_ID")
    aws_secret = os.getenv("AWS_SECRET_ACCESS_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")

    return {
        "primary": {
            "provider": "AWS Bedrock",
            "model": BEDROCK_MODEL_ID,
            "region": BEDROCK_REGION,
            "configured": bool(aws_key and aws_secret),
            "status": "✅ active" if (aws_key and aws_secret) else "❌ not configured — set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY in .env",
        },
        "fallback": {
            "provider": "Anthropic API",
            "model": ANTHROPIC_MODEL_ID,
            "configured": bool(anthropic_key),
            "status": "✅ active" if anthropic_key else "❌ not configured — set ANTHROPIC_API_KEY in .env",
        },
        "endpoints": [
            "GET /api/ai/analyze/{symbol}  — deep stock analysis (SSE stream)",
            "GET /api/ai/scalper           — ₹20K scalper picks (SSE stream)",
            "GET /api/ai/trade-signals     — high-confidence trade picks (SSE stream)",
            "GET /api/ai/market-pulse      — quick market summary (SSE stream)",
            "GET /api/ai/config            — this endpoint",
        ],
    }

"""
NSE expiry calendar — the single source of truth for options expiry dates.

WHY THIS MODULE EXISTS
----------------------
Expiry dates were previously computed in four different places, each hardcoding
"Thursday". That is wrong: effective **1 September 2025**, NSE shifted weekly &
monthly equity-derivative expiry from Thursday to **Tuesday** (per SEBI's
directive to spread weekly expiries across the week and ease end-of-week volume
concentration). Monthly expiry is the **last Tuesday** of the month.

HOLIDAY ADJUSTMENT
------------------
If the computed Tuesday is an NSE trading holiday (or a weekend), expiry shifts
to the **previous trading day**. Real example: Holi falls on Tuesday 3 Mar 2026,
so that week's expiry is Monday 2 Mar 2026.

MAINTENANCE
-----------
`NSE_HOLIDAYS` is *data* and must be refreshed once a year from the official NSE
circular (nseindia.com → "Market Timings & Holidays"). The code never needs to
change for a new year — only the holiday set below. Past holidays do not affect
forward-looking expiry calculations, so it is safe to keep or prune them.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, time
from typing import List, Optional

try:
    from zoneinfo import ZoneInfo
    _IST = ZoneInfo("Asia/Kolkata")
except Exception:  # pragma: no cover - zoneinfo always present on py3.9+
    _IST = None

# Expiry weekday: Monday=0 … Sunday=6.  Tuesday = 1  (since 2025-09-01).
EXPIRY_WEEKDAY = 1

# Contracts settle at 15:30 IST; after that the expiry-day contract is "done".
_EXPIRY_CUTOFF = time(15, 30)

# ── NSE trading holidays (equity / derivatives, full-day closures) ──────────────
# Holidays that coincide with a weekend are omitted (they have no effect).
# Source: official NSE holiday circulars. UPDATE EACH YEAR.
NSE_HOLIDAYS = {
    # ── 2026 ──
    date(2026, 1, 26),   # Republic Day (Mon)
    date(2026, 3, 3),    # Holi (Tue)            → shifts weekly expiry to Mon 2 Mar
    date(2026, 3, 26),   # Shri Ram Navami (Thu)
    date(2026, 3, 31),   # Shri Mahavir Jayanti (Tue) → shifts Mar monthly to Mon 30 Mar
    date(2026, 4, 3),    # Good Friday (Fri)
    date(2026, 4, 14),   # Ambedkar Jayanti (Tue) → shifts weekly expiry to Mon 13 Apr
    date(2026, 5, 1),    # Maharashtra Day (Fri)
    date(2026, 5, 28),   # Bakri Id (Thu)
    date(2026, 6, 26),   # Muharram (Fri)
    date(2026, 9, 14),   # Ganesh Chaturthi (Mon)
    date(2026, 10, 2),   # Mahatma Gandhi Jayanti (Fri)
    date(2026, 10, 20),  # Dussehra (Tue)        → shifts weekly expiry to Mon 19 Oct
    date(2026, 11, 10),  # Diwali Balipratipada (Tue) → shifts weekly expiry to Mon 9 Nov
    date(2026, 11, 24),  # Guru Nanak Jayanti (Tue) → shifts Nov monthly to Mon 23 Nov
    date(2026, 12, 25),  # Christmas (Fri)
}


# ── Core helpers ────────────────────────────────────────────────────────────────

def now_ist() -> datetime:
    """Current time in IST (falls back to naive local time if zoneinfo missing)."""
    if _IST is not None:
        return datetime.now(_IST)
    return datetime.now()


def is_trading_holiday(d: date) -> bool:
    """True if `d` is a full-day NSE holiday."""
    return d in NSE_HOLIDAYS


def is_trading_day(d: date) -> bool:
    """True if `d` is a weekday and not an NSE holiday."""
    return d.weekday() < 5 and d not in NSE_HOLIDAYS


def previous_trading_day(d: date) -> date:
    """The most recent trading day strictly before `d`."""
    cur = d - timedelta(days=1)
    while not is_trading_day(cur):
        cur -= timedelta(days=1)
    return cur


def adjust_to_trading_day(d: date) -> date:
    """If `d` is a weekend/holiday, roll *back* to the previous trading day."""
    while not is_trading_day(d):
        d -= timedelta(days=1)
    return d


def format_expiry(d: date) -> str:
    """Format as the chain-lookup key, e.g. '03JUN2026'."""
    return d.strftime("%d%b%Y").upper()


# ── Weekly expiry ───────────────────────────────────────────────────────────────

def upcoming_weekly_expiries(n: int = 5, ref: Optional[datetime] = None) -> List[date]:
    """
    Next `n` weekly expiry dates (each a Tuesday, holiday-adjusted to the
    previous trading day when needed), in ascending order.

    The current week's expiry is excluded once the 15:30 IST cutoff has passed
    on the expiry day itself.
    """
    ref = ref or now_ist()
    today = ref.date()
    passed_cutoff = (ref.hour, ref.minute) >= (_EXPIRY_CUTOFF.hour, _EXPIRY_CUTOFF.minute)

    # Start one week before the most recent Tuesday so a holiday-shifted current
    # expiry (e.g. a Monday) is still considered.
    back = (today.weekday() - EXPIRY_WEEKDAY) % 7
    raw_tuesday = today - timedelta(days=back + 7)

    out: List[date] = []
    while len(out) < n:
        adj = adjust_to_trading_day(raw_tuesday)
        if (adj > today or (adj == today and not passed_cutoff)) and adj not in out:
            out.append(adj)
        raw_tuesday += timedelta(days=7)
    return out


def next_weekly_expiry(ref: Optional[datetime] = None) -> date:
    """The nearest upcoming weekly expiry date (holiday-adjusted)."""
    return upcoming_weekly_expiries(1, ref)[0]


# ── Monthly expiry ──────────────────────────────────────────────────────────────

def monthly_expiry(year: int, month: int) -> date:
    """Last Tuesday of the month, holiday-adjusted to the previous trading day."""
    if month == 12:
        last_day = date(year, 12, 31)
    else:
        last_day = date(year, month + 1, 1) - timedelta(days=1)
    offset = (last_day.weekday() - EXPIRY_WEEKDAY) % 7
    return adjust_to_trading_day(last_day - timedelta(days=offset))


def is_monthly_expiry(d: date) -> bool:
    """True if `d` is the (holiday-adjusted) monthly expiry of its month."""
    return d == monthly_expiry(d.year, d.month)

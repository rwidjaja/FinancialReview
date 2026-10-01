#!/usr/bin/env python3
"""
email_briefing — sends a portfolio + market snapshot email three times a
trading day (open / midday / close).

Config lives in smtp-credentials.json (sibling to this file, gitignored —
never commit it). Create it with setup_email_briefing.py.

Usage:
    python3 email_briefing.py --auto              # send whichever session(s) are due now
    python3 email_briefing.py --session open       # force one specific session
    python3 email_briefing.py --session open --dry-run   # print, don't send

--auto is the mode meant to be polled every few minutes by a scheduler
(launchd on macOS, cron elsewhere — see setup_email_briefing.py). It checks
the real NYSE open/close times for today (holidays and early closes included,
via market_calendar.py) and fires each of open/midday/close exactly once, the
first time it's polled after that session's target time. A small state file
(.email_briefing_state.json, gitignored) tracks what's already gone out today
so re-polling never double-sends. On a non-trading day nothing fires.
"""

from __future__ import annotations

import argparse
import json
import os
import smtplib
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import market_calendar  # noqa: E402

_DIR = os.path.dirname(os.path.abspath(__file__))
_CONFIG_PATH = os.path.join(_DIR, "smtp-credentials.json")
_STATE_PATH = os.path.join(_DIR, ".email_briefing_state.json")
_ET = ZoneInfo("America/New_York")

# How long after each target time we still consider a poll "on time" — mostly
# academic since --auto just fires as soon as it's polled past the target,
# but a wide window means a laptop that was asleep still sends late rather
# than not at all.
_SESSION_GRACE = timedelta(hours=3)

_SESSION_LABELS = {
    "open":   "MARKET OPEN SNAPSHOT",
    "midday": "MIDDAY SNAPSHOT",
    "close":  "MARKET CLOSE SNAPSHOT",
}

_SESSION_SUBJECT_LABELS = {
    "open":   "Market Open",
    "midday": "Midday",
    "close":  "Market Close",
}

# display name -> yfinance ticker, for the market-indices line
_INDEX_TICKERS = [
    ("S&P 500", "^GSPC"),
    ("Dow Jones", "^DJI"),
    ("Nasdaq", "^IXIC"),
    ("VIX", "^VIX"),
]

# account key -> friendly label; unknown keys fall back to the API's own label
_ACCOUNT_LABELS = {
    "taxable": "Taxable",
    "rollover_ira": "Rollover IRA",
    "roth_ira": "Roth IRA",
}


# ── Config ────────────────────────────────────────────────────────────────────

def load_config(path: str = _CONFIG_PATH) -> dict:
    if not os.path.exists(path):
        raise SystemExit(
            f"No config found at {path}.\n"
            f"Run setup_email_briefing.py first to create it."
        )
    with open(path) as f:
        return json.load(f)


# ── Auto-scheduling state ─────────────────────────────────────────────────────

def _load_state() -> dict:
    try:
        with open(_STATE_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(today_key: str, sent: list[str]) -> None:
    # Only today's entry is kept — old days are dead weight.
    with open(_STATE_PATH, "w") as f:
        json.dump({today_key: sent}, f)


def due_sessions(now_utc: datetime | None = None) -> tuple[str, list[str]]:
    """Returns (today_key, sessions) — the ET calendar-day key and the list
    of sessions (subset of open/midday/close) that are due to send right now
    and haven't already gone out today."""
    now_utc = now_utc or datetime.now(timezone.utc)
    today_key = now_utc.astimezone(_ET).date().isoformat()

    status = market_calendar.get_market_status(now_utc)
    if not status["is_trading_day"]:
        return today_key, []

    open_dt = datetime.fromisoformat(status["market_open_utc"])
    close_dt = datetime.fromisoformat(status["market_close_utc"])
    midday_dt = open_dt + (close_dt - open_dt) / 2
    targets = {
        "open": open_dt + timedelta(minutes=5),
        "midday": midday_dt,
        "close": close_dt + timedelta(minutes=5),
    }

    already_sent = set(_load_state().get(today_key, []))
    due = [
        session for session, target in targets.items()
        if session not in already_sent and target <= now_utc <= target + _SESSION_GRACE
    ]
    return today_key, due


# ── Data fetch ────────────────────────────────────────────────────────────────

def _fetch_json(url: str, timeout: int = 15) -> dict:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def fetch_dashboard_data(dashboard_url: str) -> dict:
    return _fetch_json(f"{dashboard_url.rstrip('/')}/api/data")


def fetch_index_snapshot() -> dict:
    """Today's %-change for major indices. Returns {} entries it can't fetch
    rather than failing the whole email over one bad ticker."""
    out = {}
    try:
        import yfinance as yf
        tickers = [t for _, t in _INDEX_TICKERS]
        data = yf.download(tickers, period="5d", interval="1d",
                            progress=False, group_by="ticker")
        for name, ticker in _INDEX_TICKERS:
            try:
                closes = data[ticker]["Close"].dropna()
                last, prev = closes.iloc[-1], closes.iloc[-2]
                out[name] = {"price": float(last), "change_pct": float((last / prev - 1) * 100)}
            except Exception:
                continue
    except Exception:
        pass
    return out


# ── Content builders ──────────────────────────────────────────────────────────

def _fmt_usd(v: float) -> str:
    sign = "-" if v < 0 else "+" if v > 0 else " "
    return f"{sign}${abs(v):,.2f}"


def build_account_lines(data: dict) -> list[str]:
    accounts = data.get("accounts") or []
    rows = []
    for a in accounts:
        value = a.get("value") or 0.0
        pnl = a.get("pnl") or 0.0
        pnl_pct = a.get("pnl_pct") or 0.0
        day_change = sum((p.get("day_change") or 0) for p in (a.get("positions") or []))
        day_change_pct = (day_change / value * 100) if value else 0.0
        label = _ACCOUNT_LABELS.get(a.get("key"), a.get("label") or a.get("key") or "Account")
        rows.append((label, value, day_change, day_change_pct, pnl, pnl_pct))

    rows.sort(key=lambda r: -r[1])
    lines = []
    for label, value, dc, dc_pct, pnl, pnl_pct in rows:
        lines.append(
            f"  {label:<14s} ${value:>13,.2f}   {_fmt_usd(dc):>12s} ({dc_pct:+.2f}%)   "
            f"P&L {_fmt_usd(pnl):>13s} ({pnl_pct:+.1f}%)"
        )
    return lines


def build_market_lines(indices: dict, data: dict) -> list[str]:
    lines = []
    for name, _ticker in _INDEX_TICKERS:
        info = indices.get(name)
        if not info:
            continue
        extra = ""
        if name == "VIX":
            vix_90d = data.get("vix_90d_avg")
            if vix_90d:
                regime = "low-vol" if info["price"] < vix_90d else "elevated"
                extra = f"  (90d avg {vix_90d:.2f} — {regime} regime)"
        lines.append(f"  {name:<10s} {info['price']:>10,.2f}   {info['change_pct']:+.2f}%{extra}")
    return lines


_SEVERITY_EMOJI = {"crit": "\U0001F534", "warn": "\U0001F7E1", "info": "\U0001F535"}


def build_signal_lines(data: dict) -> tuple[str, list[str]]:
    signals = [s for s in (data.get("signals") or []) if s.get("severity") in ("crit", "warn")]
    signals.sort(key=lambda s: 0 if s.get("severity") == "crit" else 1)
    n_crit = sum(1 for s in signals if s.get("severity") == "crit")
    n_warn = sum(1 for s in signals if s.get("severity") == "warn")
    header = f"({n_crit} critical, {n_warn} warning{'s' if n_warn != 1 else ''})" if signals else "(none)"
    lines = [f"  {_SEVERITY_EMOJI.get(s.get('severity'), '')} {s.get('headline', '')}" for s in signals]
    return header, lines


def build_action_lines(data: dict) -> list[str]:
    return [f"  {a.get('icon', '')} {a.get('action', '')} — {a.get('text', '')}"
            for a in (data.get("decision_strip") or [])]


def build_email(session: str, dashboard_url: str) -> tuple[str, str]:
    """Returns (subject, plain_text_body)."""
    data = fetch_dashboard_data(dashboard_url)
    indices = fetch_index_snapshot()
    now_et = datetime.now(_ET)

    summary = data.get("summary") or {}
    intel = data.get("portfolio_intel") or {}
    income = data.get("income_analytics") or {}

    session_label = _SESSION_LABELS[session]
    time_str = now_et.strftime("%-I:%M %p ET")
    date_str = now_et.strftime("%a %b %-d, %Y")

    subject = f"\U0001F514 Portfolio Snapshot — {_SESSION_SUBJECT_LABELS[session]} — {date_str}"

    sig_header, sig_lines = build_signal_lines(data)
    action_lines = build_action_lines(data)
    account_lines = build_account_lines(data)
    market_lines = build_market_lines(indices, data)

    parts = [
        f"{session_label} — {time_str}",
        "",
        "YOUR PORTFOLIO",
        f"  Total Value        ${summary.get('total_value', 0):,.2f}",
        f"  Today               {_fmt_usd(summary.get('day_change', 0))}  ({summary.get('day_change_pct', 0):+.2f}%)",
        f"  Total P&L           {_fmt_usd(summary.get('total_pnl', 0))}  ({summary.get('total_pnl_pct', 0):+.2f}%)",
        f"  Fwd 12mo Income     ${income.get('portfolio_fwd_12m', 0):,.2f}  ({income.get('yield_pct', 0):.2f}% yield)",
        "",
        "BY ACCOUNT",
        *(account_lines or ["  (no account data)"]),
        "",
        "MARKET",
        *(market_lines or ["  (index data unavailable)"]),
        "",
        f"⚠️ RISK SIGNALS {sig_header}",
        *(sig_lines or ["  No critical or warning signals."]),
        "",
        "ACTIONS FLAGGED",
        *(action_lines or ["  No actions flagged."]),
        "",
        f"Fragility {intel.get('fragility_score', '—')}/100 "
        f"· Concentration {intel.get('concentration_level', '—')} "
        f"· Market regime: {intel.get('market_regime', '—')}",
    ]
    return subject, "\n".join(parts)


# ── Send ──────────────────────────────────────────────────────────────────────

def send_email(cfg: dict, subject: str, text_body: str) -> None:
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = cfg.get("from_name", "Portfolio Dashboard") + f" <{cfg['smtp_user']}>"
    msg["To"] = cfg["to_email"]

    html_body = (
        "<pre style=\"font-family:'Courier New',monospace;font-size:13px;"
        "white-space:pre-wrap;\">" + text_body.replace("&", "&amp;").replace("<", "&lt;") + "</pre>"
    )
    msg.attach(MIMEText(text_body, "plain"))
    msg.attach(MIMEText(html_body, "html"))

    try:
        import certifi
        context = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        context = ssl.create_default_context()
    with smtplib.SMTP(cfg["smtp_host"], cfg.get("smtp_port", 587), timeout=20) as server:
        server.starttls(context=context)
        server.login(cfg["smtp_user"], cfg["smtp_password"])
        server.sendmail(cfg["smtp_user"], [cfg["to_email"]], msg.as_string())


# ── CLI ───────────────────────────────────────────────────────────────────────

def _send_one(cfg: dict, session: str, dry_run: bool) -> bool:
    """Builds + sends (or prints) one session's email. Returns True on success."""
    try:
        subject, body = build_email(session, cfg["dashboard_url"])
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"[{session}] Could not reach dashboard at {cfg['dashboard_url']}: {e}", file=sys.stderr)
        return False

    if dry_run:
        print(f"Subject: {subject}\n")
        print(body)
        return True

    try:
        send_email(cfg, subject, body)
    except Exception as e:
        print(f"[{session}] Send failed: {e}", file=sys.stderr)
        return False

    print(f"Sent: {subject}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a portfolio snapshot email.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--auto", action="store_true",
                       help="Send whichever of open/midday/close are due right now (poll this every few minutes)")
    mode.add_argument("--session", choices=list(_SESSION_LABELS),
                       help="Force one specific session, ignoring the schedule/state file")
    parser.add_argument("--config", default=_CONFIG_PATH)
    parser.add_argument("--force", action="store_true", help="Send even on a non-trading day (--session only)")
    parser.add_argument("--dry-run", action="store_true", help="Print the email(s) instead of sending")
    args = parser.parse_args()

    cfg = load_config(args.config)

    if args.session:
        today = datetime.now(_ET).strftime("%Y-%m-%d")
        if not args.force and not market_calendar.is_trading_day(today):
            print(f"{today} is not a trading day — skipping.")
            return
        _send_one(cfg, args.session, args.dry_run)
        return

    # --auto
    today_key, sessions = due_sessions()
    if not sessions:
        print("No sessions due.")
        return

    state = _load_state()
    sent_today = list(state.get(today_key, []))
    for session in sessions:
        if _send_one(cfg, session, args.dry_run) and not args.dry_run:
            sent_today.append(session)
    if not args.dry_run:
        _save_state(today_key, sent_today)


if __name__ == "__main__":
    main()

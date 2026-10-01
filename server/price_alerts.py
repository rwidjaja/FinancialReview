"""
Price Alert Engine — stores alerts in dashboard.db (price_alerts table).

Alert schema (matches db_manager columns):
  id             : str (uuid4)
  symbol         : str
  direction      : "above" | "below"
  mode           : "price" | "pct"
  threshold      : float   — dollar price OR % change from base_price
  base_price     : float   — price at creation time (for pct mode)
  created_at     : ISO str
  active         : bool    — False = dismissed / paused
  triggered      : bool
  triggered_at   : ISO str | null
  triggered_price: float | null
  notes          : str
"""

import uuid
from datetime import datetime, timezone

import db_manager as _db


# ── Public CRUD ────────────────────────────────────────────────────────────────

def get_alerts() -> list:
    """Return all alerts (active and dismissed)."""
    return _db.alerts_get_all()


def create_alert(symbol: str, direction: str, mode: str,
                 threshold: float, base_price: float, notes: str = "") -> dict:
    """Create and persist a new price alert."""
    alert = {
        "id":             str(uuid.uuid4()),
        "symbol":         symbol.upper().strip(),
        "direction":      direction,
        "mode":           mode,
        "threshold":      float(threshold),
        "base_price":     float(base_price),
        "created_at":     datetime.now(timezone.utc).isoformat(),
        "active":         True,
        "triggered":      False,
        "triggered_at":   None,
        "triggered_price": None,
        "notes":          notes or "",
    }
    return _db.alert_insert(alert)


def update_alert(alert_id: str, **kwargs) -> dict | None:
    """
    Update editable fields: direction, mode, threshold, notes, active.
    Re-activating (active=True) resets triggered state so the alert can fire again.
    """
    if kwargs.get("active") is True:
        kwargs.setdefault("triggered", False)
        kwargs.setdefault("triggered_at", None)
        kwargs.setdefault("triggered_price", None)
    return _db.alert_update_fields(alert_id, **kwargs)


def delete_alert(alert_id: str) -> bool:
    """Permanently remove an alert."""
    return _db.alert_delete(alert_id)


def dismiss_alert(alert_id: str) -> dict | None:
    """Dismiss a triggered alert — marks inactive so it stops showing."""
    return update_alert(alert_id, active=False)


# ── Price check engine ─────────────────────────────────────────────────────────

def check_alerts(snapshots: dict) -> list:
    """
    Evaluate all active, un-triggered alerts against current snapshot prices.
    Returns list of newly-triggered alert dicts (copies, safe to send to frontend).
    Persists updated triggered state to database.

    Called from the auto-refresh loop and on every /api/data response so the
    frontend always sees fresh triggered_alerts without needing a separate poll.
    """
    alerts = _db.alerts_get_all()
    newly_triggered = []

    for a in alerts:
        if not a.get("active", True):
            continue
        if a.get("triggered", False):
            newly_triggered.append(dict(a))
            continue

        symbol = a.get("symbol", "")
        snap   = snapshots.get(symbol) or {}
        current_price = (
            snap.get("price") or
            snap.get("nav") or
            snap.get("last_price")
        )
        if not current_price:
            continue

        base_price = a.get("base_price") or current_price
        direction  = a.get("direction", "above")
        mode       = a.get("mode", "price")
        threshold  = float(a.get("threshold", 0))

        if mode == "price":
            hit = (direction == "above" and current_price >= threshold) or \
                  (direction == "below" and current_price <= threshold)
        else:
            pct = (current_price - base_price) / base_price * 100 if base_price else 0.0
            hit = (direction == "above" and pct >= threshold) or \
                  (direction == "below" and pct <= threshold)

        if hit:
            triggered_at    = datetime.now(timezone.utc).isoformat()
            triggered_price = round(float(current_price), 4)
            _db.alert_update_fields(
                a["id"],
                triggered=True,
                triggered_at=triggered_at,
                triggered_price=triggered_price,
            )
            updated = dict(a)
            updated["triggered"]       = True
            updated["triggered_at"]    = triggered_at
            updated["triggered_price"] = triggered_price
            newly_triggered.append(updated)
            print(f"[alerts] 🔔 {symbol} {direction} "
                  f"{'$' if mode == 'price' else ''}{threshold}{'%' if mode == 'pct' else ''} "
                  f"→ triggered at ${current_price:.2f}")

    return newly_triggered

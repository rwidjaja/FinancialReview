#!/usr/bin/env python3
"""
setup_email_briefing — interactive one-time setup for the daily email
briefings sent by email_briefing.py.

Prompts for the dashboard URL, recipient, and SMTP login (skipped if
smtp-credentials.json already exists — reuses it), writes the config
(gitignored — never commit it), sends a test email, then installs 3 fixed
crontab lines (market open / midday / close, converted from ET to your
local timezone) that each run email_briefing.py --session <x> exactly once.

This assumes your system clock's timezone follows the same DST calendar as
US markets (true for any US timezone) — if you're outside the US, the
converted times will drift by an hour during the few weeks each year when
your local DST and US DST are out of sync.

Run once per machine:
    python3 setup_email_briefing.py
"""

from __future__ import annotations

import getpass
import json
import os
import subprocess
import sys
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

_DIR = os.path.dirname(os.path.abspath(__file__))
_CONFIG_PATH = os.path.join(_DIR, "smtp-credentials.json")
_ET = ZoneInfo("America/New_York")

# Standard NYSE session (early closes aren't tracked by a fixed cron schedule —
# email_briefing.py --session still checks the real trading calendar to skip
# holidays/weekends, it just can't shift a fixed cron time for one-off early closes).
_SESSION_TARGETS_ET = {
    "open": time(9, 35),
    "midday": time(12, 30),
    "close": time(16, 5),
}

_PROVIDER_PRESETS = {
    "1": ("Outlook / Hotmail / Live", "smtp-mail.outlook.com", 587),
    "2": ("Gmail", "smtp.gmail.com", 587),
    "3": ("Yahoo", "smtp.mail.yahoo.com", 587),
    "4": ("iCloud", "smtp.mail.me.com", 587),
    "5": ("Custom", None, None),
}


def _prompt(label: str, default: str | None = None) -> str:
    suffix = f" [{default}]" if default else ""
    val = input(f"{label}{suffix}: ").strip()
    return val or (default or "")


def _get_config() -> dict:
    if os.path.exists(_CONFIG_PATH):
        with open(_CONFIG_PATH) as f:
            existing = json.load(f)
        reuse = _prompt(
            f"Found existing config (sends to {existing.get('to_email')} via "
            f"{existing.get('smtp_host')}). Reuse it? (y/n)", "y"
        )
        if reuse.lower().startswith("y"):
            return existing

    dashboard_url = _prompt("Dashboard URL (where this server's /api/data is reachable)",
                             "http://localhost:8501")
    to_email = _prompt("Send the briefing to this address")

    print("\nSMTP provider for sending:")
    for key, (name, _, _) in _PROVIDER_PRESETS.items():
        print(f"  {key}) {name}")
    choice = _prompt("Choose", "1")
    provider_name, preset_host, preset_port = _PROVIDER_PRESETS.get(choice, _PROVIDER_PRESETS["5"])

    if preset_host:
        smtp_host, smtp_port = preset_host, preset_port
        print(f"Using {provider_name}: {smtp_host}:{smtp_port}")
    else:
        smtp_host = _prompt("SMTP host")
        smtp_port = int(_prompt("SMTP port", "587"))

    smtp_user = _prompt("SMTP login email (the account sending the mail)", to_email)
    print(
        "SMTP app password (NOT your regular account password — most providers require\n"
        "an app-specific password for SMTP login; generate one in your account's security\n"
        "settings). Input is hidden."
    )
    smtp_password = getpass.getpass("App password: ").strip()

    cfg = {
        "dashboard_url": dashboard_url,
        "to_email": to_email,
        "smtp_host": smtp_host,
        "smtp_port": smtp_port,
        "smtp_user": smtp_user,
        "smtp_password": smtp_password,
        "from_name": "Portfolio Dashboard",
    }
    with open(_CONFIG_PATH, "w") as f:
        json.dump(cfg, f, indent=2)
    os.chmod(_CONFIG_PATH, 0o600)
    print(f"\nWrote {_CONFIG_PATH} (mode 600).")
    return cfg


def _send_test(cfg: dict) -> None:
    send_test = _prompt("\nSend a test email now? (y/n)", "y")
    if not send_test.lower().startswith("y"):
        return
    sys.path.insert(0, _DIR)
    import email_briefing
    try:
        subject, body = email_briefing.build_email("open", cfg["dashboard_url"])
        email_briefing.send_email(cfg, "[TEST] " + subject, body)
        print("Test email sent — check your inbox.")
    except Exception as e:
        print(f"Test email failed: {e}", file=sys.stderr)
        print(
            "This could be a bad SMTP credential, or (for SSL/certificate errors) a local\n"
            "Python/CA-trust issue rather than anything wrong with smtp-credentials.json.\n"
            "Fix the underlying cause and re-run this script — your existing config is untouched."
        )
        sys.exit(1)


def _guess_local_tz() -> str:
    try:
        link = os.readlink("/etc/localtime")
        return link.split("zoneinfo/")[-1]
    except Exception:
        return "America/New_York"


def _local_cron_times(local_tz_name: str) -> dict:
    """Converts each session's ET target time to today's equivalent wall-clock
    time in local_tz_name, using a real date so DST is resolved correctly."""
    local_tz = ZoneInfo(local_tz_name)
    today = datetime.now(_ET).date()
    out = {}
    for session, t in _SESSION_TARGETS_ET.items():
        et_dt = datetime.combine(today, t, tzinfo=_ET)
        out[session] = et_dt.astimezone(local_tz)
    return out


def _install_cron(python_bin: str, script_path: str, log_path: str, local_tz_name: str) -> None:
    local_times = _local_cron_times(local_tz_name)
    lines = []
    for session, dt in local_times.items():
        lines.append(
            f"{dt.minute} {dt.hour} * * 1-5  {python_bin} {script_path} "
            f"--session {session} >> {log_path} 2>&1\n"
        )
    marker = "# Portfolio email briefings (email_briefing.py)"

    result = subprocess.run(["crontab", "-l"], capture_output=True, text=True)
    existing = result.stdout if result.returncode == 0 else ""

    # Drop any block we previously installed so re-running this script updates
    # times cleanly instead of stacking duplicate entries.
    kept = []
    skip = False
    for l in existing.splitlines():
        if l.strip() == marker:
            skip = True
            continue
        if skip and ("email_briefing.py" in l):
            continue
        skip = False
        kept.append(l)

    new_crontab = "\n".join(kept).rstrip("\n")
    new_crontab += ("\n\n" if new_crontab else "") + marker + "\n" + "".join(lines)

    result = subprocess.run(["crontab", "-"], input=new_crontab, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Failed to install crontab: {result.stderr.strip()}", file=sys.stderr)
        print("Add these lines yourself via `crontab -e`:\n" + "".join(lines))
        return

    print(f"\nInstalled crontab entries (local timezone: {local_tz_name}):")
    print("".join(lines))
    print("Each line runs exactly once at that time — no polling, no idle overhead.")
    print(f"Logs land in: {log_path}")


def main() -> None:
    print("=== Daily portfolio email — setup ===\n")
    cfg = _get_config()
    _send_test(cfg)

    python_bin = sys.executable
    script_path = os.path.join(_DIR, "email_briefing.py")
    log_path = os.path.join(_DIR, "email_briefing.log")

    guessed_tz = _guess_local_tz()
    local_tz_name = _prompt(
        "\nThis machine's local timezone (IANA name, e.g. America/Chicago) — "
        "used to convert the 9:35/12:30/16:05 ET send times to local cron times",
        guessed_tz,
    )

    print("\n=== Installing the recurring job (crontab) ===")
    _install_cron(python_bin, script_path, log_path, local_tz_name)


if __name__ == "__main__":
    main()

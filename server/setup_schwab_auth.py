#!/usr/bin/env python3
"""
One-time Schwab OAuth authentication setup.

Run this script once to authorize this application with your Schwab account.
It will open your browser to the Schwab login page, and after you log in,
save a token file locally so the dashboard can run unattended.

Usage:
    python3 setup_schwab_auth.py

After successful auth, the token is valid for 7 days. After that,
re-run this script to refresh. The dashboard auto-refreshes the token
during normal operation as long as it runs at least once per 7 days.
"""

import json
import os
import sys
import webbrowser


_DIR = os.path.dirname(os.path.abspath(__file__))
_CRED_PATH = os.path.join(_DIR, "schwab_credentials.json")


def main():
    if not os.path.exists(_CRED_PATH):
        print(f"ERROR: Credentials file not found: {_CRED_PATH}")
        sys.exit(1)

    with open(_CRED_PATH) as f:
        creds = json.load(f)

    api_key = creds["app_key"]
    app_secret = creds["app_secret"]
    redirect_uri = creds["redirect_uri"]
    token_path = os.path.join(_DIR, creds.get("token_path", ".schwab_token.json"))

    print("=" * 60)
    print("  Schwab Dashboard — One-Time Authentication Setup")
    print("=" * 60)
    print()

    try:
        import schwab.auth as auth
    except ImportError:
        print("ERROR: schwab-py not installed.")
        print("Run: pip3 install schwab-py --break-system-packages")
        sys.exit(1)

    # If token already exists, check its age
    if os.path.exists(token_path):
        print(f"Token file already exists: {token_path}")
        ans = input("Re-authenticate? (y/N): ").strip().lower()
        if ans != "y":
            print("Keeping existing token.")
            return
        # Delete the stale token before re-authenticating so easy_client
        # starts a fresh OAuth flow instead of trying the expired refresh token.
        os.remove(token_path)
        print(f"Removed stale token: {token_path}")

    print(f"\nThis will open a browser to authorize access to your Schwab account.")
    print(f"After logging in, you will be redirected to: {redirect_uri}")
    print(f"Copy the FULL redirect URL from your browser and paste it below.")
    print()
    input("Press Enter to open the browser...")

    # Use easy_client which handles the entire flow
    try:
        client = auth.easy_client(
            api_key=api_key,
            app_secret=app_secret,
            callback_url=redirect_uri,
            token_path=token_path,
            interactive=True,
        )
        print()
        print("=" * 60)
        print("  Authentication successful!")
        print(f"  Token saved to: {token_path}")
        print("=" * 60)
        print()

        # Quick validation — fetch account numbers
        resp = client.get_account_numbers()
        resp.raise_for_status()
        accounts = resp.json()
        print(f"Linked accounts ({len(accounts)}):")
        for acct in accounts:
            num = acct.get("accountNumber", "?")
            print(f"  ...{num[-4:]}  (hash: {acct.get('hashValue', '?')[:12]}...)")

        print()
        print("You can now run the dashboard from the project root:")
        print("  ./start.sh")
        print("Then set each account's type in Settings → Schwab accounts.")

    except KeyboardInterrupt:
        print("\nAborted.")
        sys.exit(0)
    except Exception as e:
        print(f"\nAuthentication failed: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

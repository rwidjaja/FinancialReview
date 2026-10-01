#!/bin/bash
# Starts the Python API server (port 8501) and the React dev server (port 3000).
# Kills any previous session on those ports first to prevent cache interference.
# Handles Schwab auth interactively before backgrounding the server.
# Run from the FinancialDashboard directory.

ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVER="$ROOT/server"

# ── Parse flags ───────────────────────────────────────────────────────────────
DEBUG=0
VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    --debug)   DEBUG=1 ;;
    --verbose) VERBOSE=1 ;;
  esac
done
if [ "$DEBUG" = "1" ]; then
  export DASHBOARD_DEBUG=1
  echo "  [debug mode on]"
fi
if [ "$VERBOSE" = "1" ]; then
  export DASHBOARD_VERBOSE=1
  echo "  [verbose mode on]"
fi

# ── Kill previous sessions ────────────────────────────────────────────────────
kill_port() {
  local port=$1
  local pids
  pids=$(lsof -ti tcp:"$port" 2>/dev/null)
  if [ -n "$pids" ]; then
    echo "  Stopping previous process on :$port (PID $pids)..."
    echo "$pids" | xargs kill -TERM 2>/dev/null
    sleep 1
    pids=$(lsof -ti tcp:"$port" 2>/dev/null)
    [ -n "$pids" ] && echo "$pids" | xargs kill -KILL 2>/dev/null
  fi
}

echo "Checking for previous sessions..."
kill_port 8501
kill_port 3000

# ── Clear server-side caches ──────────────────────────────────────────────────
echo "Clearing server caches..."
rm -f "$SERVER"/_confidence_cache.json \
       "$SERVER"/_trends_cache.json \
       "$SERVER"/_conversion_cache.json \
       "$SERVER"/_schwab_api_cache.json \
       "$SERVER"/_positions_snapshot.json

# ── Schwab token validation (using existing Python code) ──────────────────────
echo "Checking Schwab token status..."

cd "$SERVER"

# Run Python token check using the same logic as schwab_client.get_client()
python3 << 'EOF'
import json
import os
import time
import sys

TOKEN_PATH = os.path.join(os.path.dirname(__file__), '.schwab_token.json')

def check_token():
    if not os.path.exists(TOKEN_PATH):
        print("TOKEN_MISSING")
        return 1
    
    try:
        with open(TOKEN_PATH, 'r') as f:
            token_data = json.load(f)
        
        # Get token data (handles both old and new format)
        creation_timestamp = token_data.get('creation_timestamp', 0)
        token_inner = token_data.get('token', {})
        expires_in = token_inner.get('expires_in', 0)
        refresh_token = token_inner.get('refresh_token')
        
        current_time = time.time()
        
        # Check if access token is still valid
        if creation_timestamp > 0 and expires_in > 0:
            access_expires_at = creation_timestamp + expires_in
            if access_expires_at > current_time:
                print("TOKEN_VALID")
                return 0
            elif refresh_token:
                # Access token expired but refresh token exists
                print("TOKEN_EXPIRED_ACCESS_ONLY")
                return 3
            else:
                print("TOKEN_EXPIRED")
                return 1
        else:
            # Fallback: check if token has any valid expiry
            expiry = token_data.get('expiry') or token_data.get('expires_at') or 0
            if expiry > current_time:
                print("TOKEN_VALID")
                return 0
            else:
                print("TOKEN_EXPIRED")
                return 1
            
    except Exception as e:
        print(f"ERROR: {e}")
        return 2

sys.exit(check_token())
EOF

TOKEN_STATUS=$?
cd "$ROOT"

case $TOKEN_STATUS in
  0)
    echo "  ✓ Token valid - starting servers"
    ;;
  3)
    echo "  ⚠ Access token expired, but refresh token exists"
    echo "  Attempting auto-refresh via Python..."
    cd "$SERVER"
    python3 -c "
import json
import time
import requests
import base64

TOKEN_PATH = '.schwab_token.json'

def refresh_token():
    with open(TOKEN_PATH, 'r') as f:
        data = json.load(f)
    
    refresh_token = data.get('token', {}).get('refresh_token')
    if not refresh_token:
        print('No refresh token found')
        return False
    
    # Get credentials
    with open('schwab_credentials.json', 'r') as f:
        creds = json.load(f)
    
    app_key = creds['app_key']
    app_secret = creds['app_secret']
    auth = base64.b64encode(f'{app_key}:{app_secret}'.encode()).decode()
    
    resp = requests.post(
        'https://api.schwabapi.com/v1/oauth/token',
        headers={'Authorization': f'Basic {auth}'},
        data={
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token
        }
    )
    
    if resp.status_code == 200:
        new_token = resp.json()
        data['creation_timestamp'] = time.time()
        data['token'] = new_token
        with open(TOKEN_PATH, 'w') as f:
            json.dump(data, f, indent=2)
        print('Token refreshed successfully')
        return True
    else:
        print(f'Refresh failed: {resp.status_code}')
        return False

if refresh_token():
    exit(0)
else:
    exit(1)
" 2>/dev/null
    if [ $? -eq 0 ]; then
      echo "  ✓ Token auto-refreshed successfully"
    else
      echo "  ✗ Auto-refresh failed - running full authentication..."
      cd "$SERVER" && python3 setup_schwab_auth.py
    fi
    cd "$ROOT"
    ;;
  *)
    echo "  ✗ Token missing or expired - running authentication..."
    cd "$SERVER" && python3 setup_schwab_auth.py
    cd "$ROOT"
    ;;
esac

# ── Logging ───────────────────────────────────────────────────────────────────
# Both servers used to write only to this terminal, so an overnight wedge left
# no trace once the scrollback was gone. Keep the current run plus one previous
# run on disk, timestamped, while still echoing to the terminal.
API_LOG="$SERVER/dashboard.log"
UI_LOG="$SERVER/dashboard-ui.log"
LOG_MAX_BYTES=10485760   # rotate at 10 MB

rotate_log() {
  local f=$1
  if [ -f "$f" ] && [ "$(wc -c < "$f" | tr -d ' ')" -gt "$LOG_MAX_BYTES" ]; then
    mv -f "$f" "$f.1"
  fi
}
rotate_log "$API_LOG"
rotate_log "$UI_LOG"

# Prefix each line with a wall-clock stamp. macOS ships bash 3.2 and the BSD awk
# has no strftime, so a read loop calling date is the portable option — request
# volume here is low enough that the per-line fork does not matter.
stamp_to() {
  local f=$1
  while IFS= read -r line; do
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$line"
  done | tee -a "$f"
}

{
  echo "──── run started $(date '+%Y-%m-%d %H:%M:%S') ────"
} >> "$API_LOG"

# ── Start servers ─────────────────────────────────────────────────────────────
echo "Starting Python API server on :8501  (log: $API_LOG)..."
# -u keeps stdout unbuffered so the log is current at the moment of a wedge.
# Process substitution (not a pipe) so $! stays the python PID for the trap.
cd "$SERVER" && python3 -W ignore::DeprecationWarning -u server.py \
  > >(stamp_to "$API_LOG") 2>&1 &
API_PID=$!

sleep 2

echo "Starting React dev server on :3000  (log: $UI_LOG)..."
# vite timestamps its own proxy errors, so this one just needs to land on disk.
cd "$ROOT" && npm run dev > >(tee -a "$UI_LOG") 2>&1 &
UI_PID=$!

echo ""
echo "┌─────────────────────────────────────────────────────┐"
echo "│  Dashboard running:                                 │"
echo "│    API:  http://localhost:8501                      │"
echo "│    UI:   http://localhost:3000                      │"
echo "│    Health: http://localhost:8501/api/health         │"
echo "│                                                      │"
echo "│  Press Ctrl+C to stop both servers                  │"
echo "└─────────────────────────────────────────────────────┘"
echo ""

trap "echo 'Shutting down...'; kill $API_PID $UI_PID 2>/dev/null; exit" INT TERM
wait $API_PID $UI_PID
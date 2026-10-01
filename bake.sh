#!/bin/bash
# bake.sh — populate AI metric-explainer tooltips into cache_kv.
#
# Runs server/explainers.py with the project's Python venv, regardless of
# the shell's current cwd or activated environment. Forwards all args.
#
# Examples:
#   ./bake.sh --regen                 # generate any missing explainers
#   ./bake.sh --regen --force         # regenerate all (e.g. after prompt tuning)
#   ./bake.sh --regen --only fragility vol_budget
#   ./bake.sh --dump                  # print all baked explainers as JSON
#   ./bake.sh --list                  # list registered metric ids
#   ./bake.sh --regen -v              # verbose — print LLM-call failure reasons
#
# Override the Python binary if your venv lives somewhere unexpected:
#   DASHBOARD_PYTHON=/path/to/python ./bake.sh --regen

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Locate the Python we should use. Check (in order):
#   1. DASHBOARD_PYTHON env var (explicit override)
#   2. Known venv locations
#   3. `python3` on PATH (fine when the user has activated the venv themselves)
PY="${DASHBOARD_PYTHON:-}"
if [ -z "$PY" ]; then
    for cand in \
        "/Users/rudywidjaja/Development/venv/FinancialDashboard/bin/python" \
        "$ROOT/venv/bin/python" \
        "$ROOT/.venv/bin/python" \
        ; do
        if [ -x "$cand" ]; then
            PY="$cand"
            break
        fi
    done
fi
PY="${PY:-$(command -v python3 || true)}"

if [ -z "$PY" ] || [ ! -x "$PY" ]; then
    echo "Error: no Python interpreter found. Set DASHBOARD_PYTHON=/path/to/python and retry." >&2
    exit 1
fi

echo "Using python: $PY"
cd "$ROOT/server"
exec "$PY" -m explainers "$@"

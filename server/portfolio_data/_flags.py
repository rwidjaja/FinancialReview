"""Shared debug/verbose flags. Imported by both the package and its sub-modules.

These are set once at import and never reassigned at runtime, so a module-level
constant is sufficient (no need for live look-up through the package object).
"""

import os

_VERBOSE = False  # Set to True for progress logging, False for clean output
_DEBUG_REFRESH = os.environ.get("DASHBOARD_DEBUG", "0") == "1"

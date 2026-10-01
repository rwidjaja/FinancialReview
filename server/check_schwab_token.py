#!/usr/bin/env python3
"""Check if Schwab token exists and is still valid."""

import json
import os
import sys
import time

# Path to your token file
TOKEN_PATH = os.path.join(os.path.dirname(__file__), '.schwab_token.json')

def check_token():
    """Return 0 if token is valid, 1 if missing/expired, 2 if error"""
    
    # Check if token file exists
    if not os.path.exists(TOKEN_PATH):
        print("TOKEN_MISSING")
        return 1
    
    try:
        with open(TOKEN_PATH, 'r') as f:
            token_data = json.load(f)
        
        # Your token structure: {"creation_timestamp": 1234567890, "token": {...}}
        creation_timestamp = token_data.get('creation_timestamp', 0)
        token_inner = token_data.get('token', {})
        
        # Get expiry times
        expires_in = token_inner.get('expires_in', 0)  # Access token expiry (usually 1800 seconds = 30 min)
        refresh_token = token_inner.get('refresh_token')
        
        current_time = time.time()
        
        # Check if we have a refresh token (means we can refresh)
        has_refresh = refresh_token is not None
        
        # Access token expiry time
        access_expires_at = creation_timestamp + expires_in if creation_timestamp > 0 else 0
        
        # Check if access token is still valid (within 30 min window)
        access_valid = access_expires_at > current_time
        
        # For Schwab, access tokens last 30 min, refresh tokens last 7 days
        # If access token expired but we have a refresh token, we can still refresh
        if access_valid:
            print("TOKEN_VALID (access token active)")
            return 0
        elif has_refresh:
            # Access token expired, but refresh token exists - can auto-refresh
            # Check if refresh token itself is still valid (7 days = 604800 sec)
            refresh_expires_at = creation_timestamp + (7 * 24 * 3600)  # 7 days from creation
            if refresh_expires_at > current_time:
                print("TOKEN_EXPIRED_ACCESS_ONLY (can refresh)")
                return 3  # Special code for "access expired but refresh exists"
            else:
                print("TOKEN_EXPIRED (refresh also expired)")
                return 1
        else:
            print("TOKEN_EXPIRED (no refresh token)")
            return 1
            
    except Exception as e:
        print(f"ERROR: {e}")
        return 2

if __name__ == "__main__":
    sys.exit(check_token())
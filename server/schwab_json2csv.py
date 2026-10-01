#!/usr/bin/env python3
"""
Convert Schwab position JSON to CSV format
"""

import json
import csv
from datetime import datetime

def convert_schwab_json_to_csv(json_file_path, csv_file_path):
    """Convert Schwab JSON position data to CSV"""
    
    with open(json_file_path, 'r') as f:
        data = json.load(f)
    
    # Prepare rows for CSV
    rows = []
    
    for symbol, position in data.items():
        account = position.get('account', '')
        as_of_date = position.get('asOfDate', '')
        
        # Summary row (total position)
        rows.append({
            'symbol': symbol,
            'lot_id': 'TOTAL',
            'acquired_date': '',
            'quantity': position.get('totalQuantity', 0),
            'current_price': position.get('totalMarketValue', 0) / position.get('totalQuantity', 1) if position.get('totalQuantity', 0) > 0 else 0,
            'cost_per_share': position.get('totalCostBasis', 0) / position.get('totalQuantity', 1) if position.get('totalQuantity', 0) > 0 else 0,
            'market_value': position.get('totalMarketValue', 0),
            'cost_basis': position.get('totalCostBasis', 0),
            'gain_loss': position.get('totalGainLoss', 0),
            'gain_loss_percent': position.get('totalGainLossPercent', 0),
            'holding_period': 'Total',
            'account': account,
            'as_of_date': as_of_date
        })
        
        # Individual lots
        for lot in position.get('lots', []):
            rows.append({
                'symbol': symbol,
                'lot_id': f"{lot.get('acquiredDate', '')}_{lot.get('quantity', 0)}",
                'acquired_date': lot.get('acquiredDate', ''),
                'quantity': lot.get('quantity', 0),
                'current_price': lot.get('price', 0),
                'cost_per_share': lot.get('costPerShare', 0),
                'market_value': lot.get('marketValue', 0),
                'cost_basis': lot.get('costBasis', 0),
                'gain_loss': lot.get('gainLoss', 0),
                'gain_loss_percent': lot.get('gainLossPercent', 0),
                'holding_period': lot.get('holdingPeriod', ''),
                'account': account,
                'as_of_date': as_of_date
            })
    
    # Write to CSV
    fieldnames = [
        'symbol', 'lot_id', 'acquired_date', 'quantity', 'current_price',
        'cost_per_share', 'market_value', 'cost_basis', 'gain_loss',
        'gain_loss_percent', 'holding_period', 'account', 'as_of_date'
    ]
    
    with open(csv_file_path, 'w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    
    print(f"Converted {len(rows)} rows to {csv_file_path}")
    return rows

def create_summary_csv(json_file_path, summary_csv_path):
    """Create a summary CSV with only total positions"""
    
    with open(json_file_path, 'r') as f:
        data = json.load(f)
    
    summary_rows = []
    total_portfolio_value = 0
    total_cost_basis = 0
    total_gain_loss = 0
    
    for symbol, position in data.items():
        summary_rows.append({
            'symbol': symbol,
            'quantity': position.get('totalQuantity', 0),
            'current_price': position.get('totalMarketValue', 0) / position.get('totalQuantity', 1) if position.get('totalQuantity', 0) > 0 else 0,
            'market_value': position.get('totalMarketValue', 0),
            'cost_basis': position.get('totalCostBasis', 0),
            'gain_loss': position.get('totalGainLoss', 0),
            'gain_loss_percent': position.get('totalGainLossPercent', 0),
            'weight_pct': 0  # Will calculate after total
        })
        
        total_portfolio_value += position.get('totalMarketValue', 0)
        total_cost_basis += position.get('totalCostBasis', 0)
        total_gain_loss += position.get('totalGainLoss', 0)
    
    # Calculate weight percentages
    for row in summary_rows:
        row['weight_pct'] = (row['market_value'] / total_portfolio_value * 100) if total_portfolio_value > 0 else 0
    
    # Add total row
    summary_rows.append({
        'symbol': 'TOTAL',
        'quantity': '',
        'current_price': '',
        'market_value': round(total_portfolio_value, 2),
        'cost_basis': round(total_cost_basis, 2),
        'gain_loss': round(total_gain_loss, 2),
        'gain_loss_percent': (total_gain_loss / total_cost_basis * 100) if total_cost_basis > 0 else 0,
        'weight_pct': 100
    })
    
    fieldnames = ['symbol', 'quantity', 'current_price', 'market_value', 
                  'cost_basis', 'gain_loss', 'gain_loss_percent', 'weight_pct']
    
    with open(summary_csv_path, 'w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(summary_rows)
    
    print(f"Created summary CSV with {len(summary_rows)} rows at {summary_csv_path}")
    return summary_rows

def create_lots_csv(json_file_path, lots_csv_path):
    """Create a CSV with only individual lots (no totals)"""
    
    with open(json_file_path, 'r') as f:
        data = json.load(f)
    
    rows = []
    
    for symbol, position in data.items():
        for lot in position.get('lots', []):
            rows.append({
                'symbol': symbol,
                'acquired_date': lot.get('acquiredDate', ''),
                'quantity': lot.get('quantity', 0),
                'cost_per_share': lot.get('costPerShare', 0),
                'current_price': lot.get('price', 0),
                'market_value': lot.get('marketValue', 0),
                'cost_basis': lot.get('costBasis', 0),
                'gain_loss': lot.get('gainLoss', 0),
                'gain_loss_percent': lot.get('gainLossPercent', 0),
                'holding_period': lot.get('holdingPeriod', ''),
                'days_held': (datetime.now() - datetime.strptime(lot.get('acquiredDate', '2025-01-01'), '%Y-%m-%d')).days if lot.get('acquiredDate') else 0
            })
    
    # Sort by acquired date (oldest first)
    rows.sort(key=lambda x: x['acquired_date'])
    
    fieldnames = ['symbol', 'acquired_date', 'days_held', 'quantity', 'cost_per_share',
                  'current_price', 'market_value', 'cost_basis', 'gain_loss', 
                  'gain_loss_percent', 'holding_period']
    
    with open(lots_csv_path, 'w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    
    print(f"Created lots CSV with {len(rows)} lots at {lots_csv_path}")
    return rows

if __name__ == "__main__":
    import sys, os, tempfile
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import db_manager as _db

    # Export lots from DB to a temporary JSON, then convert to CSV
    _lots = _db.lots_get_raw()
    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as _tf:
        json.dump(_lots, _tf)
        _tmp_path = _tf.name

    convert_schwab_json_to_csv(_tmp_path, 'schwab_positions.csv')
    create_summary_csv(_tmp_path, 'schwab_summary.csv')
    create_lots_csv(_tmp_path, 'schwab_lots.csv')
    os.unlink(_tmp_path)

    print("\n✅ Conversion complete! Files created:")
    print("   - schwab_positions.csv (all rows: totals + lots)")
    print("   - schwab_summary.csv (only totals per symbol)")
    print("   - schwab_lots.csv (only individual lots, sorted by date)")
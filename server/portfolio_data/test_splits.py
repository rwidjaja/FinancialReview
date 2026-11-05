"""Tests for stock-split inference and lot rescaling. Run from server/ with:

    python -m unittest portfolio_data.test_splits
"""
import os
import tempfile
import threading
import unittest

import db_manager as dbm
from portfolio_data.splits import (
    infer_split_ratio, infer_split_from_quantities,
    fix_stale_split_quotes, rebase_eod_baseline,
)


class InferSplitRatioTests(unittest.TestCase):
    def test_forward_split_exact_and_with_day_move(self):
        self.assertEqual(infer_split_ratio(450.41, 150.14), 3.0)   # SOXX 3:1
        self.assertEqual(infer_split_ratio(450.41, 156.0), 3.0)    # split + ~4% rally
        self.assertEqual(infer_split_ratio(450.41, 144.0), 3.0)    # split + ~4% drop
        self.assertEqual(infer_split_ratio(300.0, 150.0), 2.0)

    def test_reverse_split(self):
        self.assertAlmostEqual(infer_split_ratio(2.0, 20.0), 0.1)  # 1-for-10

    def test_normal_moves_are_not_splits(self):
        for old, new in [(100, 100), (100, 95), (100, 110), (100, 70), (100, 60), (100, 140)]:
            self.assertIsNone(infer_split_ratio(old, new), (old, new))

    def test_bad_inputs(self):
        self.assertIsNone(infer_split_ratio(0, 10))
        self.assertIsNone(infer_split_ratio(10, None))

    def test_lot_split_needs_both_qty_and_cost(self):
        self.assertEqual(infer_split_from_quantities(100, 300, 300.0, 100.0), 3.0)
        # Bought 200 more (qty tripled, avg cost ~unchanged) → not a split
        self.assertIsNone(infer_split_from_quantities(100, 300, 300.0, 298.0))
        # Already reconciled → no-op
        self.assertIsNone(infer_split_from_quantities(300, 300, 100.0, 100.0))


class SoxxSplitDayReplayTests(unittest.TestCase):
    """Real data from 2026-11-05: SOXX 3:1. Schwab positions already show
    9,300 sh (3,100 × 3) @ $203 cost; quote and saved EOD baseline still $450.41;
    prior session (11-04) EOD was 3,100 sh @ $465."""

    def _snap(self, px=450.41):
        return {"SOXX": {"price": px, "annual_div_amount": 3.0, "sma_200": 420.0,
                         "price_change": -14.59, "price_change_pct": -0.031}}

    def test_stale_quote_fixed_via_share_jump(self):
        snaps = self._snap()
        fixed = fix_stale_split_quotes(snaps, {"SOXX": 9300.0}, {},
                                       {"SOXX": {"shares": 3100.0, "price": 465.0}})
        self.assertEqual(fixed, {"SOXX": 3.0})
        self.assertAlmostEqual(snaps["SOXX"]["price"], 150.1367, places=3)
        self.assertAlmostEqual(snaps["SOXX"]["annual_div_amount"], 1.0)
        self.assertEqual(snaps["SOXX"]["price_change"], 0.0)
        # Market value back to ~$1.40M, not $4.19M
        self.assertAlmostEqual(9300 * snaps["SOXX"]["price"], 1_396_271, delta=5)

    def test_stale_quote_fixed_via_schwab_position_price(self):
        snaps = self._snap()
        fixed = fix_stale_split_quotes(snaps, {"SOXX": 9300.0}, {"SOXX": 150.2}, {})
        self.assertEqual(fixed, {"SOXX": 3.0})

    def test_eod_baseline_rebased_then_day_change_sane(self):
        snaps = self._snap()
        fix_stale_split_quotes(snaps, {"SOXX": 9300.0}, {},
                               {"SOXX": {"shares": 3100.0, "price": 465.0}})
        eod = {"SOXX": {"shares": 9300.0, "price": 450.41, "market_value": 4188813.03}}
        self.assertEqual(rebase_eod_baseline(eod, snaps), {"SOXX": 3.0})
        acct_shares = 5334.0   # rollover IRA slice
        base = eod["SOXX"]["market_value"] * acct_shares / eod["SOXX"]["shares"]
        day_chg = acct_shares * snaps["SOXX"]["price"] - base
        self.assertLess(abs(day_chg), 1.0)   # was ≈ −$1.6M on this account

    def test_day_after_feeds_caught_up_no_double_adjust(self):
        snaps = self._snap(px=152.0)
        prev = {"SOXX": {"shares": 3100.0, "price": 465.0}}   # still pre-split row
        self.assertEqual(fix_stale_split_quotes(snaps, {"SOXX": 9300.0}, {"SOXX": 152.0}, prev), {})
        self.assertEqual(snaps["SOXX"]["price"], 152.0)
        eod = {"SOXX": {"shares": 9300.0, "price": 150.14, "market_value": 1396302.0}}
        self.assertEqual(rebase_eod_baseline(eod, snaps), {})

    def test_ordinary_day_untouched(self):
        snaps = {"SMH": {"price": 504.27}}
        self.assertEqual(fix_stale_split_quotes(snaps, {"SMH": 3409.0}, {"SMH": 504.1},
                                                {"SMH": {"shares": 3409.0, "price": 498.0}}), {})
        self.assertEqual(rebase_eod_baseline({"SMH": {"shares": 3409.0, "price": 498.0}}, snaps), {})


class LotSplitReconcileTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._orig = (dbm._DB_PATH, dbm._local)
        dbm._DB_PATH = os.path.join(self._tmp.name, "t.db")
        dbm._local = threading.local()
        dbm._init_schema()

    def tearDown(self):
        dbm._DB_PATH, dbm._local = self._orig
        self._tmp.cleanup()

    def test_rescales_lots_once_and_keeps_basis(self):
        from portfolio_data.tax_lot import _reconcile_lot_splits
        dbm.lots_replace_from_dict({"SMH": {"account": "x", "lots": [
            {"acquiredDate": "2025-01-02", "quantity": 60, "costPerShare": 250.0, "price": 330.0},
            {"acquiredDate": "2026-03-02", "quantity": 40, "costPerShare": 375.0, "price": 330.0},
        ]}})
        live = {"SMH": {"shares": 300, "cost_per_share": 100.0}}
        self.assertEqual(_reconcile_lot_splits(live), {"SMH": 3.0})
        lots = dbm.lots_get_raw()["SMH"]["lots"]
        self.assertEqual([l["quantity"] for l in lots], [180, 120])
        self.assertEqual([round(l["costPerShare"], 4) for l in lots], [83.3333, 125.0])
        self.assertAlmostEqual(sum(l["costBasis"] for l in lots), 30000.0)   # basis unchanged
        self.assertAlmostEqual(lots[0]["price"], 110.0)
        self.assertEqual(_reconcile_lot_splits(live), {})                    # idempotent
        self.assertEqual(dbm.get_lot_sales_map(), {})                         # no fake sales


if __name__ == "__main__":
    unittest.main()

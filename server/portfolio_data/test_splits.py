"""Tests for stock-split inference and lot rescaling. Run from server/ with:

    python -m unittest portfolio_data.test_splits
"""
import os
import tempfile
import threading
import unittest

import db_manager as dbm
from portfolio_data.splits import (
    infer_split_ratio, infer_split_from_quantities, is_pre_split,
    detect_splits, fix_stale_split_quotes, rebase_eod_baseline,
)


class InferSplitRatioTests(unittest.TestCase):
    def test_share_counts(self):
        self.assertEqual(infer_split_ratio(9300, 3100), 3.0)       # SOXX 3:1
        self.assertAlmostEqual(infer_split_ratio(310, 3100), 0.1)  # 1-for-10 reverse
        self.assertIsNone(infer_split_ratio(3100, 3100))
        self.assertIsNone(infer_split_ratio(3400, 3100))           # ordinary buy

    def test_default_tolerance_is_tight(self):
        # Cross-day prices must never be fed through with a loose tolerance:
        # 465 → 139.38 is a 3:1 split plus a real ~10% drop.
        self.assertIsNone(infer_split_ratio(465.0, 139.38))
        self.assertIsNone(infer_split_ratio(450.41, 46.46))

    def test_bad_inputs(self):
        self.assertIsNone(infer_split_ratio(0, 10))
        self.assertIsNone(infer_split_ratio(10, None))

    def test_is_pre_split_robust_to_big_moves(self):
        for post in (139.38, 120.0, 150.14, 180.0):               # −20% … +20%
            self.assertTrue(is_pre_split(450.41, post, 3.0), post)
            self.assertFalse(is_pre_split(post, 150.14, 3.0), post)
        self.assertTrue(is_pre_split(2.0, 20.0, 0.1))               # reverse split
        self.assertFalse(is_pre_split(21.0, 20.0, 0.1))

    def test_lot_split_needs_both_qty_and_cost(self):
        self.assertEqual(infer_split_from_quantities(100, 300, 300.0, 100.0), 3.0)
        # Bought 200 more (qty tripled, avg cost ~unchanged) → not a split
        self.assertIsNone(infer_split_from_quantities(100, 300, 300.0, 298.0))
        # Already reconciled → no-op
        self.assertIsNone(infer_split_from_quantities(300, 300, 100.0, 100.0))


class SoxxSplitDayReplayTests(unittest.TestCase):
    """Real data from 2026-11-05: SOXX 3:1. Schwab positions show 9,300 sh
    (3,100 × 3) @ $203 cost. Prior session (11-04) EOD: 3,100 sh @ $465.
    Pre-market the quote and saved baseline were still $450.41; after the
    open the quote was the real post-split $139.38 (≈ −10% on the day)."""

    HELD = {"SOXX": 9300.0}
    PREV = {"SOXX": {"shares": 3100.0, "price": 465.0}}

    def _snap(self, px):
        return {"SOXX": {"price": px, "annual_div_amount": 3.0 if px > 300 else 1.0,
                         "sma_200": 420.0 if px > 300 else 140.0}}

    def test_detect_from_share_count(self):
        self.assertEqual(detect_splits(self.HELD, self.PREV, {}, self._snap(139.38)), {"SOXX": 3.0})

    def test_detect_from_schwab_position_vs_quote_without_prev_eod(self):
        self.assertEqual(detect_splits(self.HELD, {}, {"SOXX": 150.2}, self._snap(450.41)), {"SOXX": 3.0})

    def test_premarket_stale_quote_is_fixed(self):
        snaps = self._snap(450.41)
        splits = detect_splits(self.HELD, self.PREV, {}, snaps)
        self.assertEqual(fix_stale_split_quotes(snaps, splits, self.PREV, {}), {"SOXX": 3.0})
        self.assertAlmostEqual(snaps["SOXX"]["price"], 150.1367, places=3)
        self.assertAlmostEqual(snaps["SOXX"]["annual_div_amount"], 1.0)
        self.assertAlmostEqual(9300 * snaps["SOXX"]["price"], 1_396_271, delta=5)

    def test_after_open_post_split_quote_is_NOT_divided_again(self):
        # The regression: quote already 139.38 must stay 139.38.
        snaps = self._snap(139.38)
        splits = detect_splits(self.HELD, self.PREV, {"SOXX": 139.40}, snaps)
        self.assertEqual(fix_stale_split_quotes(snaps, splits, self.PREV, {"SOXX": 139.40}), {})
        self.assertEqual(snaps["SOXX"]["price"], 139.38)
        self.assertEqual(snaps["SOXX"]["annual_div_amount"], 1.0)
        # Same without Schwab position price (falls back to prev close ÷ r)
        snaps = self._snap(139.38)
        self.assertEqual(fix_stale_split_quotes(snaps, splits, self.PREV, {}), {})
        self.assertEqual(snaps["SOXX"]["price"], 139.38)

    def test_after_open_baseline_rebased_once_and_day_change_real(self):
        snaps = self._snap(139.38)
        splits = {"SOXX": 3.0}
        eod = {"SOXX": {"shares": 9300.0, "price": 450.41, "market_value": 4188813.03}}
        self.assertEqual(rebase_eod_baseline(eod, snaps, splits), {"SOXX": 3.0})
        self.assertAlmostEqual(eod["SOXX"]["price"], 150.1367, places=3)
        self.assertEqual(rebase_eod_baseline(eod, snaps, splits), {})      # idempotent
        acct = 5334.0   # rollover IRA slice
        base = eod["SOXX"]["market_value"] * acct / eod["SOXX"]["shares"]
        day_chg = acct * 139.38 - base
        self.assertAlmostEqual(day_chg, acct * (139.38 - 150.1367), delta=1)  # real −7.2%, ≈ −$57k

    def test_next_day_no_detection(self):
        prev = {"SOXX": {"shares": 9300.0, "price": 139.38}}
        self.assertEqual(detect_splits(self.HELD, prev, {"SOXX": 141.0}, self._snap(141.0)), {})

    def test_ordinary_day_untouched(self):
        snaps = {"SMH": {"price": 504.27}}
        prev = {"SMH": {"shares": 3409.0, "price": 498.0}}
        self.assertEqual(detect_splits({"SMH": 3409.0}, prev, {"SMH": 504.1}, snaps), {})
        # Even a −50% crash with unchanged shares is not a split
        snaps = {"SMH": {"price": 249.0}}
        self.assertEqual(detect_splits({"SMH": 3409.0}, prev, {"SMH": 249.0}, snaps), {})


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

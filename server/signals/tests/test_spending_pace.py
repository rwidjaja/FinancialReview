"""Unit tests for the spending_pace detector. Run with:

    python -m unittest server.signals.tests.test_spending_pace
"""

import unittest

from server.signals.spending_pace import detect


def _payload(drift_pct=None, recent_12=None, annual=None, ts="2026-05-18T00:00:00"):
    return {
        "timestamp": ts,
        "tax_data": {
            "spending_drift_pct":   drift_pct,
            "spending_recent_12":   recent_12,
            "spending_true_annual": annual,
        },
    }


class SpendingPaceDetector(unittest.TestCase):
    def test_flat_spending_emits_nothing(self):
        self.assertEqual(detect(_payload(drift_pct=2.0)), [])

    def test_just_under_warn(self):
        self.assertEqual(detect(_payload(drift_pct=7.9)), [])

    def test_warn_at_8(self):
        out = detect(_payload(drift_pct=10.0))
        self.assertEqual(len(out), 1)
        s = out[0]
        self.assertEqual(s["kind"], "spending_pace_drift")
        self.assertEqual(s["severity"], "warn")
        self.assertIsNone(s["symbol"])
        self.assertIn("+10.0%", s["headline"])
        self.assertEqual(s["tab"], "cash_flow")

    def test_crit_at_15(self):
        out = detect(_payload(drift_pct=18.0))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["severity"], "crit")
        self.assertIn("18.0%", out[0]["headline"])

    def test_boundaries(self):
        # exact warn threshold
        self.assertEqual(detect(_payload(drift_pct=8.0))[0]["severity"], "warn")
        # exact crit threshold
        self.assertEqual(detect(_payload(drift_pct=15.0))[0]["severity"], "crit")

    def test_info_on_significant_drop(self):
        out = detect(_payload(drift_pct=-10.0))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["severity"], "info")

    def test_derived_from_recent_vs_annual(self):
        # drift_pct missing → derive from recent_12 vs annual
        out = detect(_payload(drift_pct=None, recent_12=110_000, annual=100_000))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["severity"], "warn")
        # 10% drift
        self.assertAlmostEqual(out[0]["details"]["drift_pct"], 10.0, places=1)

    def test_missing_data(self):
        self.assertEqual(detect(_payload()), [])
        self.assertEqual(detect({"tax_data": {}}), [])
        self.assertEqual(detect({}), [])
        self.assertEqual(detect(None), [])

    def test_non_numeric_drift(self):
        self.assertEqual(detect(_payload(drift_pct="oops")), [])

    def test_signal_shape_contract(self):
        out = detect(_payload(drift_pct=20.0))
        self.assertTrue(out)
        for key in ("kind", "severity", "headline", "details", "as_of", "tab"):
            self.assertIn(key, out[0])
        self.assertIn(out[0]["severity"], ("info", "warn", "crit"))


if __name__ == "__main__":
    unittest.main()

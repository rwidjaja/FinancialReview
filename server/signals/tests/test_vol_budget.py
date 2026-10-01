"""Unit tests for the vol_budget detector. Run with:

    python -m unittest server.signals.tests.test_vol_budget
"""

import unittest

from server.signals.vol_budget import detect


def _payload(used, target=15.0, actual=18.0, ts="2026-05-17T00:00:00"):
    return {
        "timestamp": ts,
        "portfolio_intel": {
            "vol_budget_used":   used,
            "target_vol_pct":    target,
            "portfolio_vol_pct": actual,
        },
    }


class VolBudgetDetector(unittest.TestCase):
    def test_at_target_emits_nothing(self):
        # 100% = exactly on target
        self.assertEqual(detect(_payload(100.0)), [])

    def test_just_under_warn(self):
        self.assertEqual(detect(_payload(119.9)), [])

    def test_warn_at_120(self):
        out = detect(_payload(125.0))
        self.assertEqual(len(out), 1)
        s = out[0]
        self.assertEqual(s["kind"], "vol_budget_breach")
        self.assertEqual(s["severity"], "warn")
        self.assertIsNone(s["symbol"])
        self.assertIn("125%", s["headline"])
        self.assertEqual(s["tab"], "returns")
        self.assertEqual(s["details"]["target_vol_pct"], 15.0)
        self.assertEqual(s["details"]["portfolio_vol_pct"], 18.0)

    def test_crit_at_150(self):
        out = detect(_payload(187.0))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["severity"], "crit")
        self.assertIn("187%", out[0]["headline"])

    def test_boundary_120_exact(self):
        out = detect(_payload(120.0))
        self.assertEqual(out[0]["severity"], "warn")

    def test_boundary_150_exact(self):
        out = detect(_payload(150.0))
        self.assertEqual(out[0]["severity"], "crit")

    def test_none_returns_empty(self):
        self.assertEqual(detect(_payload(None)), [])
        self.assertEqual(detect({"portfolio_intel": {}}), [])
        self.assertEqual(detect({}), [])
        self.assertEqual(detect(None), [])

    def test_non_numeric_returns_empty(self):
        self.assertEqual(detect(_payload("not-a-number")), [])

    def test_signal_shape_contract(self):
        out = detect(_payload(200.0))
        self.assertTrue(out)
        for key in ("kind", "severity", "headline", "details", "as_of", "tab"):
            self.assertIn(key, out[0])
        self.assertIn(out[0]["severity"], ("info", "warn", "crit"))


if __name__ == "__main__":
    unittest.main()

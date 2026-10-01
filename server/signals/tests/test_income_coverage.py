"""Unit tests for the income_coverage detector. Run with:

    python -m unittest server.signals.tests.test_income_coverage
"""

import unittest

from server.signals.income_coverage import detect


def _payload(income, spend, ts="2026-05-18T00:00:00"):
    return {
        "timestamp": ts,
        "summary":  {"total_income": income},
        "tax_data": {"spending_true_annual": spend},
    }


class IncomeCoverageDetector(unittest.TestCase):
    def test_fully_covered_emits_nothing(self):
        # ratio = 1.5 → no signal
        self.assertEqual(detect(_payload(150_000, 100_000)), [])

    def test_just_covered_emits_nothing(self):
        # ratio = 1.01 → just barely covered, no signal yet
        self.assertEqual(detect(_payload(101_000, 100_000)), [])

    def test_warn_just_below_one(self):
        # ratio = 0.95 → warn
        out = detect(_payload(95_000, 100_000))
        self.assertEqual(len(out), 1)
        s = out[0]
        self.assertEqual(s["kind"], "income_coverage_gap")
        self.assertEqual(s["severity"], "warn")
        self.assertIsNone(s["symbol"])
        self.assertEqual(s["tab"], "cash_flow")
        self.assertIn("95%", s["headline"])

    def test_crit_below_80(self):
        # ratio = 0.70 → crit
        out = detect(_payload(70_000, 100_000))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["severity"], "crit")
        self.assertIn("70%", out[0]["headline"])
        self.assertIn("$30,000", out[0]["headline"])

    def test_boundaries(self):
        # exact warn threshold: ratio = 1.0 → not yet warn (strict <)
        self.assertEqual(detect(_payload(100_000, 100_000)), [])
        # ratio = 0.999 → warn
        self.assertEqual(detect(_payload(99_900, 100_000))[0]["severity"], "warn")
        # ratio = 0.80 → crit boundary (strict <)
        self.assertEqual(detect(_payload(80_000, 100_000))[0]["severity"], "warn")
        # ratio = 0.799 → crit
        self.assertEqual(detect(_payload(79_900, 100_000))[0]["severity"], "crit")

    def test_details(self):
        out = detect(_payload(60_000, 100_000))
        d = out[0]["details"]
        self.assertEqual(d["annual_income"], 60_000)
        self.assertEqual(d["annual_spending"], 100_000)
        self.assertEqual(d["gap"], 40_000)
        self.assertAlmostEqual(d["ratio"], 0.6, places=3)

    def test_missing_or_zero_data(self):
        self.assertEqual(detect(_payload(None, 100_000)), [])
        self.assertEqual(detect(_payload(50_000, None)), [])
        self.assertEqual(detect(_payload(50_000, 0)), [])
        self.assertEqual(detect({"summary": {}}), [])
        self.assertEqual(detect({}), [])
        self.assertEqual(detect(None), [])

    def test_non_numeric(self):
        self.assertEqual(detect(_payload("nope", 100_000)), [])

    def test_signal_shape_contract(self):
        out = detect(_payload(50_000, 100_000))
        for key in ("kind", "severity", "headline", "details", "as_of", "tab"):
            self.assertIn(key, out[0])
        self.assertIn(out[0]["severity"], ("info", "warn", "crit"))


if __name__ == "__main__":
    unittest.main()

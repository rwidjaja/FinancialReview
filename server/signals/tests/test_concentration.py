"""Unit tests for the concentration detector. Run with:

    python -m unittest server.signals.tests.test_concentration

Each test builds a minimal fetch_all_data-shaped dict (just portfolio_intel.weights
+ timestamp) and asserts on the structured signal output.

Note: portfolio_intel.weights is stored in PERCENT units (0-100), matching the
real data layout in portfolio_data.__init__.py.
"""

import unittest

from server.signals.concentration import detect


def _payload(weights, ts="2026-05-17T00:00:00"):
    """Minimal stand-in for fetch_all_data output — just what the detector reads."""
    return {"timestamp": ts, "portfolio_intel": {"weights": weights}}


class ConcentrationDetector(unittest.TestCase):
    def test_diversified_portfolio_emits_nothing(self):
        # Five evenly-weighted positions: top-1 = 20%, top-3 = 60%. Clearly
        # under both warn (25%) and crit_top3 (60%); use 19/18/17/16/16 to be
        # safely under the boundary.
        weights = {"VTI": 19, "VXUS": 18, "BND": 17, "QQQ": 16, "GLD": 16,
                   "TLT": 9, "VEA": 5}
        self.assertEqual(detect(_payload(weights)), [])

    def test_top1_warn(self):
        # Top holding 30% — between warn (25%) and crit (40%). Spread the
        # rest thin so top-3 stays under 60% and doesn't also fire.
        weights = {"SMH": 30, "VTI": 15, "BND": 10, "QQQ": 10,
                   "GLD": 10, "BIL": 10, "VXUS": 10, "MUB": 5}
        out = detect(_payload(weights))
        self.assertEqual(len(out), 1)
        s = out[0]
        self.assertEqual(s["kind"], "concentration_top1")
        self.assertEqual(s["symbol"], "SMH")
        self.assertEqual(s["severity"], "warn")
        self.assertIn("30.0%", s["headline"])
        self.assertEqual(s["tab"], "portfolio")
        self.assertEqual(s["as_of"], "2026-05-17")

    def test_top1_crit(self):
        weights = {"SMH": 45, "VTI": 30, "BND": 25}
        out = detect(_payload(weights))
        # Top-1 crit fires; top-3 combined = 100% > 60% so top-3 fires too
        self.assertEqual(len(out), 2)
        kinds = {s["kind"]: s for s in out}
        self.assertEqual(kinds["concentration_top1"]["severity"], "crit")
        self.assertEqual(kinds["concentration_top1"]["symbol"], "SMH")
        self.assertIn("45.0%", kinds["concentration_top1"]["headline"])
        self.assertEqual(kinds["concentration_top3"]["severity"], "crit")

    def test_top3_alone(self):
        # Top-1 only 24% (below warn) but top-3 = 65% (above crit)
        weights = {"A": 24, "B": 23, "C": 18, "D": 15, "E": 20}
        out = detect(_payload(weights))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["kind"], "concentration_top3")
        self.assertIsNone(out[0]["symbol"])
        self.assertEqual(out[0]["severity"], "crit")
        # Top three by weight should be A (24), B (23), E (20)
        self.assertEqual(out[0]["details"]["symbols"], ["A", "B", "E"])

    def test_empty_weights_returns_empty(self):
        self.assertEqual(detect(_payload({})), [])

    def test_missing_portfolio_intel(self):
        # Defensive: detector must not raise on malformed input
        self.assertEqual(detect({"timestamp": "2026-05-17T00:00:00"}), [])
        self.assertEqual(detect({}), [])
        self.assertEqual(detect(None), [])

    def test_non_numeric_weights_skipped(self):
        weights = {"SMH": 42, "JUNK": "not-a-number", "VTI": 30, "BND": 28}
        out = detect(_payload(weights))
        # JUNK ignored, top-1 SMH 42% fires crit
        kinds = [s["kind"] for s in out]
        self.assertIn("concentration_top1", kinds)
        self.assertEqual(
            next(s for s in out if s["kind"] == "concentration_top1")["symbol"], "SMH"
        )

    def test_signal_shape_contract(self):
        weights = {"SMH": 50, "VTI": 30, "BND": 20}
        out = detect(_payload(weights))
        self.assertTrue(out)
        for s in out:
            for key in ("kind", "severity", "headline", "details", "as_of", "tab"):
                self.assertIn(key, s, f"missing key {key} in signal: {s}")
            self.assertIn(s["severity"], ("info", "warn", "crit"))
            self.assertIsInstance(s["headline"], str)
            self.assertIsInstance(s["details"], dict)


if __name__ == "__main__":
    unittest.main()

"""Unit tests for the outsized_mover detector. Run with:

    python -m unittest server.signals.tests.test_outsized_mover
"""

import unittest

from server.signals.outsized_mover import detect


def _payload(grand_day, positions, ts="2026-05-18T00:00:00"):
    """Build a minimal fetch_all_data payload from a position dict."""
    return {
        "timestamp": ts,
        "summary":   {"day_change": grand_day},
        "accounts": [{"positions": [
            {"symbol": sym, "day_change": chg} for sym, chg in positions.items()
        ]}],
    }


class OutsizedMoverDetector(unittest.TestCase):
    def test_diversified_loss_emits_nothing(self):
        # 4 positions each contributing 25% of the loss → no signal
        out = detect(_payload(
            grand_day=-100_000,
            positions={"A": -25_000, "B": -25_000, "C": -25_000, "D": -25_000},
        ))
        self.assertEqual(out, [])

    def test_warn_at_50pct(self):
        # SMH = 60% of the loss → warn
        out = detect(_payload(
            grand_day=-100_000,
            positions={"SMH": -60_000, "QDVO": -20_000, "BND": -20_000},
        ))
        self.assertEqual(len(out), 1)
        s = out[0]
        self.assertEqual(s["kind"], "outsized_mover")
        self.assertEqual(s["symbol"], "SMH")
        self.assertEqual(s["severity"], "warn")
        self.assertIn("60%", s["headline"])
        self.assertEqual(s["tab"], "returns")

    def test_crit_at_75pct(self):
        # SMH = 80% of the loss → crit
        out = detect(_payload(
            grand_day=-100_000,
            positions={"SMH": -80_000, "QDVO": -10_000, "BND": -10_000},
        ))
        self.assertEqual(out[0]["severity"], "crit")
        self.assertIn("80%", out[0]["headline"])
        self.assertIn("loss", out[0]["headline"])

    def test_positive_outsized_gain(self):
        # Same logic for gains
        out = detect(_payload(
            grand_day=+50_000,
            positions={"SMH": +45_000, "VTI": +3_000, "BND": +2_000},
        ))
        self.assertEqual(out[0]["severity"], "crit")
        self.assertIn("gain", out[0]["headline"])
        self.assertEqual(out[0]["details"]["direction"], "up")

    def test_boundaries(self):
        # exact 50% → warn
        out = detect(_payload(grand_day=-100, positions={"A": -50, "B": -50}))
        self.assertEqual(out[0]["severity"], "warn")
        # exact 75% → crit
        out = detect(_payload(grand_day=-100, positions={"A": -75, "B": -25}))
        self.assertEqual(out[0]["severity"], "crit")

    def test_tiny_total_move_ignored(self):
        # |grand_day| < $1 — we ignore so a flat day doesn't flag anything
        self.assertEqual(detect(_payload(grand_day=0.5, positions={"A": 0.4})), [])
        self.assertEqual(detect(_payload(grand_day=-0.9, positions={"A": -0.8})), [])

    def test_missing_summary(self):
        # No summary.day_change → nothing to compare against
        self.assertEqual(detect({"accounts": [{"positions":[{"symbol":"X","day_change":-50}]}]}), [])

    def test_no_positions(self):
        self.assertEqual(detect(_payload(grand_day=-1000, positions={})), [])

    def test_aggregates_across_accounts(self):
        # SMH appears in two accounts; aggregate before checking share.
        data = {
            "timestamp": "2026-05-18",
            "summary":   {"day_change": -100_000},
            "accounts": [
                {"positions": [{"symbol": "SMH", "day_change": -50_000},
                               {"symbol": "VTI", "day_change": -10_000}]},
                {"positions": [{"symbol": "SMH", "day_change": -35_000},
                               {"symbol": "VTI", "day_change": -5_000}]},
            ],
        }
        out = detect(data)
        # Aggregated SMH = -85,000 → 85% of -100,000 → crit
        self.assertEqual(out[0]["symbol"], "SMH")
        self.assertEqual(out[0]["severity"], "crit")

    def test_signal_shape_contract(self):
        out = detect(_payload(
            grand_day=-100_000,
            positions={"SMH": -80_000, "BND": -20_000},
        ))
        for key in ("kind", "severity", "headline", "details", "as_of", "tab"):
            self.assertIn(key, out[0])
        self.assertIn(out[0]["severity"], ("info", "warn", "crit"))


if __name__ == "__main__":
    unittest.main()

"""Unit tests for the tax_pressure detector. Run with:

    python -m unittest server.signals.tests.test_tax_pressure
"""

import unittest

from server.signals.tax_pressure import detect


def _payload(pressure, agi=180_000, conv_room=20_000, ts="2026-05-17T00:00:00"):
    return {
        "timestamp": ts,
        "tax_data": {
            "bracket_pressure_real": pressure,
            "agi_real":              agi,
            "conv_room_real":        conv_room,
        },
    }


class TaxPressureDetector(unittest.TestCase):
    def test_low_pressure_emits_nothing(self):
        self.assertEqual(detect(_payload(50.0)), [])

    def test_just_under_warn(self):
        self.assertEqual(detect(_payload(74.9)), [])

    def test_warn_at_75(self):
        out = detect(_payload(80.0))
        self.assertEqual(len(out), 1)
        s = out[0]
        self.assertEqual(s["kind"], "tax_bracket_pressure")
        self.assertEqual(s["severity"], "warn")
        self.assertIsNone(s["symbol"])
        self.assertIn("80%", s["headline"])
        self.assertEqual(s["tab"], "tax")
        self.assertEqual(s["details"]["agi_real"], 180_000)
        self.assertEqual(s["details"]["conv_room_real"], 20_000)

    def test_crit_at_90(self):
        out = detect(_payload(94.0))
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["severity"], "crit")
        self.assertIn("94%", out[0]["headline"])

    def test_boundary_75_exact(self):
        out = detect(_payload(75.0))
        self.assertEqual(out[0]["severity"], "warn")

    def test_boundary_90_exact(self):
        out = detect(_payload(90.0))
        self.assertEqual(out[0]["severity"], "crit")

    def test_over_ceiling(self):
        # AGI has already breached the bracket — still crit (we don't have
        # a "breach" severity yet; crit covers it).
        out = detect(_payload(105.0))
        self.assertEqual(out[0]["severity"], "crit")
        self.assertIn("105%", out[0]["headline"])

    def test_none_returns_empty(self):
        self.assertEqual(detect(_payload(None)), [])
        self.assertEqual(detect({"tax_data": {}}), [])
        self.assertEqual(detect({}), [])
        self.assertEqual(detect(None), [])

    def test_non_numeric_returns_empty(self):
        self.assertEqual(detect(_payload("not-a-number")), [])

    def test_signal_shape_contract(self):
        out = detect(_payload(95.0))
        self.assertTrue(out)
        for key in ("kind", "severity", "headline", "details", "as_of", "tab"):
            self.assertIn(key, out[0])
        self.assertIn(out[0]["severity"], ("info", "warn", "crit"))


if __name__ == "__main__":
    unittest.main()

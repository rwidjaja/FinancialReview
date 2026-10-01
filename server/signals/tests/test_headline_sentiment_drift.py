"""Unit tests for headline_sentiment_drift detector. Run with:

    python -m unittest server.signals.tests.test_headline_sentiment_drift

The detector calls headline_sentiment.get_snapshot() which does I/O. All tests
patch that call so no network or DB activity occurs.
"""

import unittest
from unittest.mock import patch


def _payload(ts="2026-05-18T10:00:00"):
    """Minimal stand-in for fetch_all_data output — just what the detector reads."""
    return {"timestamp": ts}


def _snapshot(
    neg_pct=0.0,
    political_pct=0.0,
    zscore=0.0,
    n=20,
    sources=None,
):
    return {
        "score":         -neg_pct / 100,
        "zscore":        zscore,
        "spike":         False,
        "neg_pct":       neg_pct,
        "political_pct": political_pct,
        "n":             n,
        "sources":       sources or ["https://feeds.finance.yahoo.com/"],
        "top_headlines": ["Headline A", "Headline B"],
    }


_PATCH = "server.signals.headline_sentiment.get_snapshot"


class HeadlineSentimentDriftDetector(unittest.TestCase):

    # ── Quiet / no-signal cases ────────────────────────────────────────────

    def test_calm_market_emits_nothing(self):
        snap = _snapshot(neg_pct=10.0, political_pct=5.0, zscore=-0.3)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            self.assertEqual(detect(_payload()), [])

    def test_too_few_headlines_emits_nothing(self):
        snap = _snapshot(neg_pct=60.0, political_pct=50.0, zscore=-3.0, n=4)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            self.assertEqual(detect(_payload()), [])

    def test_none_snapshot_emits_nothing(self):
        with patch(_PATCH, return_value=None):
            from server.signals.headline_sentiment_drift import detect
            self.assertEqual(detect(_payload()), [])

    def test_import_error_emits_nothing(self):
        # Simulate headline_sentiment module unavailable
        with patch(_PATCH, side_effect=ImportError("no module")):
            from server.signals.headline_sentiment_drift import detect
            self.assertEqual(detect(_payload()), [])

    def test_get_snapshot_raises_emits_nothing(self):
        with patch(_PATCH, side_effect=RuntimeError("db down")):
            from server.signals.headline_sentiment_drift import detect
            self.assertEqual(detect(_payload()), [])

    # ── Warn threshold ─────────────────────────────────────────────────────

    def test_warn_on_neg_pct_threshold(self):
        snap = _snapshot(neg_pct=35.0, political_pct=5.0, zscore=-0.5)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            out = detect(_payload())
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["severity"], "warn")
        self.assertEqual(out[0]["kind"], "headline_sentiment_drift")

    def test_warn_on_zscore_threshold(self):
        snap = _snapshot(neg_pct=20.0, political_pct=5.0, zscore=-1.5)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            out = detect(_payload())
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["severity"], "warn")

    def test_just_below_warn_emits_nothing(self):
        snap = _snapshot(neg_pct=34.9, political_pct=5.0, zscore=-1.49)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            self.assertEqual(detect(_payload()), [])

    # ── Crit threshold ─────────────────────────────────────────────────────

    def test_crit_on_zscore(self):
        snap = _snapshot(neg_pct=30.0, political_pct=5.0, zscore=-2.5)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            out = detect(_payload())
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["severity"], "crit")

    def test_crit_on_neg_pct(self):
        snap = _snapshot(neg_pct=55.0, political_pct=10.0, zscore=-1.0)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            out = detect(_payload())
        self.assertEqual(out[0]["severity"], "crit")

    def test_crit_on_political_pct(self):
        snap = _snapshot(neg_pct=25.0, political_pct=40.0, zscore=-0.5)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            out = detect(_payload())
        self.assertEqual(out[0]["severity"], "crit")

    # ── Headline copy ──────────────────────────────────────────────────────

    def test_political_headline_when_political_pct_high(self):
        snap = _snapshot(neg_pct=30.0, political_pct=25.0, zscore=-2.0)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            out = detect(_payload())
        self.assertIn("Political", out[0]["headline"])

    def test_negative_headline_when_no_political(self):
        snap = _snapshot(neg_pct=40.0, political_pct=5.0, zscore=-1.8)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            out = detect(_payload())
        self.assertIn("Negative", out[0]["headline"])

    # ── Signal shape contract ──────────────────────────────────────────────

    def test_signal_shape(self):
        snap = _snapshot(neg_pct=40.0, political_pct=25.0, zscore=-2.0)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            out = detect(_payload())
        self.assertEqual(len(out), 1)
        s = out[0]
        for key in ("kind", "symbol", "severity", "headline", "details", "as_of", "tab"):
            self.assertIn(key, s, f"missing key {key}")
        self.assertEqual(s["kind"], "headline_sentiment_drift")
        self.assertIsNone(s["symbol"])
        self.assertIn(s["severity"], ("warn", "crit"))
        self.assertEqual(s["tab"], "risk")
        self.assertEqual(s["as_of"], "2026-05-18")
        details = s["details"]
        for dk in ("neg_pct", "political_pct", "zscore", "n_headlines", "sources"):
            self.assertIn(dk, details, f"missing detail key {dk}")

    def test_details_values_match_snapshot(self):
        snap = _snapshot(
            neg_pct=42.0, political_pct=28.0, zscore=-1.9,
            n=30, sources=["https://example.com/rss"],
        )
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            out = detect(_payload())
        d = out[0]["details"]
        self.assertAlmostEqual(d["neg_pct"], 42.0)
        self.assertAlmostEqual(d["political_pct"], 28.0)
        self.assertAlmostEqual(d["zscore"], -1.9)
        self.assertEqual(d["n_headlines"], 30)
        self.assertIn("https://example.com/rss", d["sources"])

    def test_sources_capped_at_three(self):
        many_sources = [f"https://feed{i}.com/" for i in range(10)]
        snap = _snapshot(neg_pct=40.0, zscore=-2.0, sources=many_sources)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            out = detect(_payload())
        self.assertLessEqual(len(out[0]["details"]["sources"]), 3)

    # ── Defensive: malformed input ─────────────────────────────────────────

    def test_missing_timestamp_in_data(self):
        snap = _snapshot(neg_pct=40.0, zscore=-2.0)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            out = detect({})
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["as_of"], "")

    def test_none_data(self):
        snap = _snapshot(neg_pct=40.0, zscore=-2.0)
        with patch(_PATCH, return_value=snap):
            from server.signals.headline_sentiment_drift import detect
            out = detect(None)
        self.assertEqual(len(out), 1)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Compare a browser pitch track (McLeod) against Praat F0 on the same take.

Usage:
  python validate_detector.py session.wav track.json
  python validate_detector.py session.wav track.json --json out.json

Input track.json — exported from the client after a session:
  [{ "t": <wall-clock ms>, "freq": <Hz | null>, "clarity": <0..1>, "rms": <0..1> }, ...]

Or the compact form produced by the client debug export:
  { "startedAt": <ms epoch>, "points": [ { "t", "freq", "clarity", "rms" }, ... ] }

Report: median absolute cents error, octave-error rate, voiced/unvoiced
disagreement between the detector and Praat.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

# Allow running from repo root or backend/
sys.path.insert(0, str(Path(__file__).resolve().parent))

from praat_bridge import AnalysisUnavailable, praat_pitch_contour  # noqa: E402

# Agreement window: frames within this many cents count as "matched"
CENTS_MATCH = 50.0
# Frames with |octave difference| close to 12k cents (and not a near-match)
OCTAVE_CENTS = 1200.0
OCTAVE_TOLERANCE = 200.0
# Detector voiced if clarity/rms above these (mirrors client scoring gate)
CLARITY_MIN = 0.55
RMS_MIN = 0.01


def load_track(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text())
    if isinstance(raw, dict) and "points" in raw:
        points = raw["points"]
        started_at = float(raw.get("startedAt") or 0)
    elif isinstance(raw, list):
        points = raw
        started_at = 0.0
    else:
        raise ValueError("track JSON must be a list of points or {startedAt, points}")

    out: list[dict[str, Any]] = []
    for p in points:
        t = float(p["t"])
        # Accept wall-clock ms (relative to startedAt) or already-relative seconds
        if started_at and t > 1e11:
            t_rel_ms = t - started_at
        elif t > 1e11:
            # no startedAt — cannot align; treat as unusable
            raise ValueError(
                "track timestamps look like wall-clock ms but no startedAt; "
                "export with startedAt so times can be aligned to the WAV"
            )
        else:
            # either relative ms or seconds: if values are small, assume seconds
            t_rel_ms = t * 1000.0 if t < 1e6 else t
        out.append(
            {
                "t_sec": t_rel_ms / 1000.0,
                "freq": float(p["freq"]) if p.get("freq") else 0.0,
                "clarity": float(p.get("clarity") or 0.0),
                "rms": float(p.get("rms") or 0.0),
            }
        )
    out.sort(key=lambda x: x["t_sec"])
    return out


def cents_diff(a_hz: float, b_hz: float) -> float:
    if a_hz <= 0 or b_hz <= 0:
        return float("nan")
    return 1200.0 * math.log2(a_hz / b_hz)


def nearest_praat(contour: list[tuple[float, float]], t: float, window: float = 0.03):
    best_f = 0.0
    best_dt = window + 1
    for ct, cf in contour:
        dt = abs(ct - t)
        if dt <= window and dt < best_dt:
            best_dt = dt
            best_f = cf
    return best_f


def validate(track: list[dict[str, Any]], contour: list[tuple[float, float]]) -> dict[str, Any]:
    both_voiced = 0
    det_only = 0
    praat_only = 0
    neither = 0
    abs_cents: list[float] = []
    octave_hits = 0
    matches = 0

    for p in track:
        det_v = (
            p["freq"] > 0
            and p["clarity"] >= CLARITY_MIN
            and p["rms"] >= RMS_MIN
        )
        pf = nearest_praat(contour, p["t_sec"])
        praat_v = pf > 0

        if det_v and praat_v:
            both_voiced += 1
            c = abs(cents_diff(p["freq"], pf))
            if not math.isnan(c):
                abs_cents.append(c)
                if c <= CENTS_MATCH:
                    matches += 1
                # octave error: near 1200¢ away but not a partial match by chance
                # (already counted in abs_cents; flag separately for the report)
                raw = cents_diff(p["freq"], pf)
                if abs(abs(raw) - OCTAVE_CENTS) <= OCTAVE_TOLERANCE:
                    octave_hits += 1
        elif det_v and not praat_v:
            det_only += 1
        elif praat_v and not det_v:
            praat_only += 1
        else:
            neither += 1

    n = max(len(track), 1)
    abs_cents.sort()
    median_cents = abs_cents[len(abs_cents) // 2] if abs_cents else None
    mean_cents = sum(abs_cents) / len(abs_cents) if abs_cents else None

    return {
        "trackFrames": len(track),
        "bothVoiced": both_voiced,
        "detectorOnly": det_only,
        "praatOnly": praat_only,
        "neither": neither,
        "voicedDisagreementPct": round(100.0 * (det_only + praat_only) / n, 2),
        "matchRatePct": round(100.0 * matches / both_voiced, 2) if both_voiced else None,
        "medianAbsCents": round(median_cents, 1) if median_cents is not None else None,
        "meanAbsCents": round(mean_cents, 1) if mean_cents is not None else None,
        "octaveErrorRatePct": (
            round(100.0 * octave_hits / both_voiced, 2) if both_voiced else None
        ),
        "centsMatchThreshold": CENTS_MATCH,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("wav", type=Path, help="session WAV from the browser")
    ap.add_argument("track", type=Path, help="pitch track JSON from the client")
    ap.add_argument("--json", type=Path, help="also write full report as JSON")
    args = ap.parse_args()

    if not args.wav.exists():
        print(f"error: wav not found: {args.wav}", file=sys.stderr)
        return 2
    if not args.track.exists():
        print(f"error: track not found: {args.track}", file=sys.stderr)
        return 2

    try:
        contour = praat_pitch_contour(str(args.wav))
    except AnalysisUnavailable as e:
        print(f"error: {e}", file=sys.stderr)
        print("hint: pip install praat-parselmouth", file=sys.stderr)
        return 3

    try:
        track = load_track(args.track)
    except (ValueError, KeyError, json.JSONDecodeError) as e:
        print(f"error: bad track file: {e}", file=sys.stderr)
        return 2

    report = validate(track, contour)
    report["wav"] = str(args.wav)
    report["track"] = str(args.track)

    print("McLeod vs Praat detector validation")
    print("-----------------------------------")
    print(f"  track frames:          {report['trackFrames']}")
    print(f"  both voiced:           {report['bothVoiced']}")
    print(f"  detector only:         {report['detectorOnly']}")
    print(f"  praat only:            {report['praatOnly']}")
    print(f"  voiced disagreement:   {report['voicedDisagreementPct']}%")
    if report["matchRatePct"] is not None:
        print(f"  match (≤{CENTS_MATCH:.0f}¢):          {report['matchRatePct']}%")
    if report["medianAbsCents"] is not None:
        print(f"  median |cents| error:  {report['medianAbsCents']}¢")
    if report["meanAbsCents"] is not None:
        print(f"  mean |cents| error:    {report['meanAbsCents']}¢")
    if report["octaveErrorRatePct"] is not None:
        print(f"  octave-error rate:     {report['octaveErrorRatePct']}%")

    if args.json:
        args.json.write_text(json.dumps(report, indent=2))
        print(f"\nwrote {args.json}")

    # Non-zero exit when clearly bad — useful for fixture CI later
    if report["medianAbsCents"] is not None and report["medianAbsCents"] > 100:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

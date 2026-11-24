"""Praat (via parselmouth) post-session acoustic analysis.

Import parselmouth lazily so the sidecar can run without it; callers should
treat AnalysisUnavailable as HTTP 501.
"""

from __future__ import annotations

import math
from typing import Any


class AnalysisUnavailable(RuntimeError):
    """parselmouth is not installed or cannot load the sound file."""


def _require_parselmouth():
    try:
        import parselmouth  # type: ignore
    except ImportError as e:
        raise AnalysisUnavailable(
            "parselmouth not installed; pip install praat-parselmouth"
        ) from e
    return parselmouth


def _freq_to_midi(freq: float) -> float:
    return 69.0 + 12.0 * math.log2(freq / 440.0)


def _midi_note_name(midi: float) -> str:
    names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    n = int(round(midi))
    return f"{names[(n % 12 + 12) % 12]}{n // 12 - 1}"


def _percentile(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    if len(sorted_vals) == 1:
        return sorted_vals[0]
    idx = p * (len(sorted_vals) - 1)
    lo = int(math.floor(idx))
    hi = int(math.ceil(idx))
    if lo == hi:
        return sorted_vals[lo]
    frac = idx - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def analyze_wav(path: str) -> dict[str, Any]:
    """Return pitch / intensity / formant summary for a mono or stereo WAV."""
    parselmouth = _require_parselmouth()

    try:
        snd = parselmouth.Sound(path)
    except Exception as e:  # noqa: BLE001 — parselmouth raises various types
        raise AnalysisUnavailable(f"could not read audio: {e}") from e

    if snd is None or snd.nx == 0:
        raise AnalysisUnavailable("empty or unreadable audio")

    # --- Pitch (F0) — floor/ceiling tuned for singing, not speech ---
    try:
        pitch = snd.to_pitch(time_step=0.01, pitch_floor=60.0, pitch_ceiling=1200.0)
        f0 = pitch.selected_array["frequency"]
        times = pitch.xs()  # parselmouth exposes xs as a method
    except Exception as e:  # noqa: BLE001
        raise AnalysisUnavailable(f"pitch analysis failed: {e}") from e

    voiced = [float(f) for f in f0 if f and f > 0]
    voiced_frac = (len(voiced) / len(f0)) if len(f0) else 0.0

    pitch_summary: dict[str, Any] = {
        "voicedFraction": round(voiced_frac, 4),
        "medianHz": None,
        "lowHz": None,
        "highHz": None,
        "lowNote": None,
        "highNote": None,
        "contour": [],
    }

    if voiced:
        sv = sorted(voiced)
        lo_hz = _percentile(sv, 0.05)
        hi_hz = _percentile(sv, 0.95)
        med_hz = _percentile(sv, 0.50)
        pitch_summary["medianHz"] = round(med_hz, 2)
        pitch_summary["lowHz"] = round(lo_hz, 2)
        pitch_summary["highHz"] = round(hi_hz, 2)
        lo_midi = _freq_to_midi(lo_hz)
        hi_midi = _freq_to_midi(hi_hz)
        pitch_summary["lowNote"] = _midi_note_name(lo_midi)
        pitch_summary["highNote"] = _midi_note_name(hi_midi)
        pitch_summary["lowMidi"] = round(lo_midi, 1)
        pitch_summary["highMidi"] = round(hi_midi, 1)

    # Contour for optional client viz / detector validation (downsample ≤ 200 pts)
    contour: list[dict[str, float]] = []
    if len(times):
        stride = max(1, len(times) // 200)
        for i in range(0, len(times), stride):
            f = float(f0[i]) if f0[i] else 0.0
            contour.append({"t": round(float(times[i]), 3), "hz": round(f, 2)})
    pitch_summary["contour"] = contour

    # --- Intensity ---
    intensity_summary: dict[str, Any] = {
        "meanDb": None,
        "peakDb": None,
        "stdDb": None,
    }
    try:
        intensity = snd.to_intensity(pitch_floor=100.0, time_step=0.01)
        # selected_array["intensity"] is in dB (SPL-like relative scale)
        db = [float(x) for x in intensity.selected_array["intensity"] if x is not None]
        # Praat leaves undefined frames as very small / zero-ish; filter silent
        db = [x for x in db if x > 1e-3]
        if db:
            mean = sum(db) / len(db)
            var = sum((x - mean) ** 2 for x in db) / len(db)
            intensity_summary["meanDb"] = round(mean, 2)
            intensity_summary["peakDb"] = round(max(db), 2)
            intensity_summary["stdDb"] = round(math.sqrt(var), 2)
    except Exception:
        pass  # intensity is best-effort; never fail the whole analysis

    # --- Formants (mean F1/F2/F3 on voiced frames) ---
    formant_summary: dict[str, Any] = {"f1": None, "f2": None, "f3": None}
    try:
        formant = snd.to_formant_burg(time_step=0.01, max_number_of_formants=5.0)
        f1s: list[float] = []
        f2s: list[float] = []
        f3s: list[float] = []
        # Sample formants on the same grid as pitch where voiced
        for i, t in enumerate(times):
            if not f0[i] or f0[i] <= 0:
                continue
            try:
                v1 = formant.get_value_at_time(1, float(t))
                v2 = formant.get_value_at_time(2, float(t))
                v3 = formant.get_value_at_time(3, float(t))
            except Exception:
                continue
            if v1 and v1 > 0:
                f1s.append(float(v1))
            if v2 and v2 > 0:
                f2s.append(float(v2))
            if v3 and v3 > 0:
                f3s.append(float(v3))
        if f1s:
            formant_summary["f1"] = round(sum(f1s) / len(f1s), 1)
        if f2s:
            formant_summary["f2"] = round(sum(f2s) / len(f2s), 1)
        if f3s:
            formant_summary["f3"] = round(sum(f3s) / len(f3s), 1)
    except Exception:
        pass

    duration = float(snd.duration)

    return {
        "ok": True,
        "durationSec": round(duration, 3),
        "sampleRate": int(snd.sampling_frequency),
        "pitch": pitch_summary,
        "intensity": intensity_summary,
        "formants": formant_summary,
    }


def praat_pitch_contour(path: str) -> list[tuple[float, float]]:
    """Full-rate Praat F0 contour [(t_sec, hz), ...] for detector validation."""
    parselmouth = _require_parselmouth()
    try:
        snd = parselmouth.Sound(path)
        pitch = snd.to_pitch(time_step=0.01, pitch_floor=60.0, pitch_ceiling=1200.0)
    except Exception as e:  # noqa: BLE001
        raise AnalysisUnavailable(str(e)) from e
    f0 = pitch.selected_array["frequency"]
    times = pitch.xs()
    out: list[tuple[float, float]] = []
    for i in range(len(times)):
        f = float(f0[i]) if f0[i] else 0.0
        out.append((float(times[i]), f))
    return out

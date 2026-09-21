"""Shared reference validation for the file picker, saving, and inference (no GPU needed)."""

import json
import sys

import miniaudio
import numpy as np

SAMPLE_RATE = 24000


def read_reference(path, start=0, end=None, validate=True):
    try:
        decoded = miniaudio.decode_file(
            path,
            output_format=miniaudio.SampleFormat.FLOAT32,
            nchannels=1,
            sample_rate=SAMPLE_RATE,
        )
    except (miniaudio.MiniaudioError, OSError) as exc:
        raise ValueError(
            "This recording could not be decoded. Choose an MP3, WAV, or FLAC file."
        ) from exc
    samples = np.asarray(decoded.samples, dtype=np.float32)
    duration = len(samples) / SAMPLE_RATE
    if not validate:
        return samples, duration
    if not isinstance(start, (int, float)) or not np.isfinite(start):
        raise ValueError("Enter a valid start time.")
    if end is None:
        end = duration
    if (
        not isinstance(end, (int, float))
        or not np.isfinite(end)
        or start < 0
        or end > duration + 0.02
        or end <= start
    ):
        raise ValueError(
            f"Choose a segment within this {duration:.1f}-second recording."
        )
    if end - start < 3 - 1 / SAMPLE_RATE or end - start > 30 + 1 / SAMPLE_RATE:
        raise ValueError(
            f"The selected sample is {end - start:.1f} seconds long. Open Edit voice and choose a 3–30-second segment, with the transcript for that segment."
        )
    segment = samples[
        round(start * SAMPLE_RATE) : min(len(samples), round(end * SAMPLE_RATE))
    ]
    if (
        not np.isfinite(segment).all()
        or not len(segment)
        or float(np.max(np.abs(segment))) < 0.001
    ):
        raise ValueError(
            "The selected segment is silent or invalid. Choose a clear section of speech."
        )
    return segment, duration


def main():
    try:
        path = sys.argv[1]
        selection = json.loads(sys.argv[2]) if len(sys.argv) > 2 else None
        if selection is None:
            _, duration = read_reference(path, validate=False)
            result = {"duration": duration}
        else:
            segment, duration = read_reference(
                path, selection.get("start", 0), selection.get("end")
            )
            result = {
                "duration": duration,
                "segmentDuration": len(segment) / SAMPLE_RATE,
            }
        print(json.dumps(result))
    except (IndexError, TypeError, ValueError, AttributeError) as exc:
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()

"""Local Qwen3-TTS worker. Only model downloads use the network."""

import base64
import contextlib
import io
import json
import sys
from pathlib import Path
from typing import Any, cast

PRESET_MODEL = "mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit"
CLONE_MODEL = "mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit"
model: Any = None
model_id: Any = None
reference_key: Any = None
reference_audio: Any = None


def decode_reference(path, start=0, end=None):
    import mlx.core as mx

    if __package__:
        from .reference import read_reference
    else:
        from reference import read_reference
    samples, _ = read_reference(path, start, end)
    return mx.array(samples)


def generate(text, voice, language, reference=None):
    global model, model_id, reference_key, reference_audio
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        import soundfile as sf
        from mlx_audio.tts.utils import load_model

        target = CLONE_MODEL if voice == "clone" else PRESET_MODEL
        if voice == "clone":
            if not reference or not reference.get("transcript", "").strip():
                raise ValueError(
                    "A reference recording and its transcript are required."
                )
            import os

            key = (
                reference["path"],
                os.stat(reference["path"]).st_mtime_ns,
                reference.get("start", 0),
                reference.get("end"),
            )
            if reference_key != key:
                reference_audio = decode_reference(
                    reference["path"], reference.get("start", 0), reference.get("end")
                )
                reference_key = key
        if model_id != target:
            # Keep only one model resident when switching between preset and clone modes.
            model = None
            model_id = None
            import gc

            import mlx.core as mx

            gc.collect()
            mx.clear_cache()
            model = load_model(cast(Path, target))
            if model is None:
                raise RuntimeError(f"Failed to load TTS model: {target}")
            model_id = target
        # The model and reference are initialized/validated above, but their
        # module-level and optional types are not narrowed by the assignments.
        results = (
            model.generate(
                text=text,
                ref_audio=reference_audio,
                ref_text=reference["transcript"] if reference is not None else "",
                lang_code=language,
                verbose=False,
            )
            if voice == "clone"
            else model.generate_custom_voice(
                text=text, speaker=voice, language=language
            )
        )
        segments = []
        sample_rate = 24000
        for result in results:
            segments.append(np.asarray(result.audio).reshape(-1))
            sample_rate = result.sample_rate
        if not segments:
            raise RuntimeError("Qwen returned no audio.")
        output = io.BytesIO()
        sf.write(
            output,
            np.concatenate(segments),
            sample_rate,
            format="WAV",
            subtype="PCM_16",
        )
        return base64.b64encode(output.getvalue()).decode("ascii")


def main():
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            text = request.get("text", "")
            if not isinstance(text, str) or not 1 <= len(text) <= 600:
                raise ValueError("Speech passages must contain 1–600 characters.")
            audio = generate(
                text, request["voice"], request["language"], request.get("reference")
            )
            result = {"id": request["id"], "audio": audio}
        except (KeyError, OSError, RuntimeError, TypeError, ValueError) as exc:
            result = {"id": request.get("id"), "error": str(exc)}
        print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()

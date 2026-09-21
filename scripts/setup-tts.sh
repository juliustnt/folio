#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ "$(uname -s)" != Darwin ] || [ "$(uname -m)" != arm64 ]; then
  echo 'The local MLX speech runtime requires an Apple Silicon Mac.' >&2
  exit 1
fi
PYTHON_BIN="${FOLIO_PYTHON_SETUP:-python3}"
if [ -z "${FOLIO_PYTHON_SETUP:-}" ] && command -v python3.13 >/dev/null 2>&1; then PYTHON_BIN=python3.13; fi
"$PYTHON_BIN" -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r speech/requirements.txt
.venv/bin/python -c 'from mlx_audio.tts.utils import load_model; import soundfile; print("Qwen runtime is ready. The speech model downloads on first reading.")'

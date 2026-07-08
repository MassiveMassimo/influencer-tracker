#!/usr/bin/env python3
"""Self-hosted Parakeet ASR for the transcribe stage (replaces Groq Whisper).

Reads a JSON job list [[code, wav_path], ...] from stdin, loads the NeMo
Parakeet model once (onnx-asr, CPU/ONNX — no GPU, no NeMo/CUDA), transcribes
each 16 kHz mono wav, and writes {code: text} JSON to stdout. Per-file errors go
to stderr and omit that code from the output (the caller logs the gap).

Run with the venv interpreter that has onnx-asr installed (PARAKEET_PYTHON).
"""
import json
import os
import sys

import onnx_asr

MODEL = "nemo-parakeet-tdt-0.6b-v2"
# Override the model path for environments where the HF cache symlinks break
# onnxruntime's external-data path validation (macOS). VM is unaffected (no env).
MODEL_PATH = os.environ.get("PARAKEET_MODEL_PATH")


def main() -> int:
    jobs = json.load(sys.stdin)
    if not jobs:
        json.dump({}, sys.stdout)
        return 0
    # Force CPU EP. The design is CPU/ONNX (no GPU); on macOS onnxruntime would
    # otherwise auto-select the CoreML EP, which fails to init this model's
    # external-data weights ("model_path must not be empty"). VM is already CPU-only.
    model = onnx_asr.load_model(MODEL, MODEL_PATH, providers=["CPUExecutionProvider"])
    out = {}
    for code, path in jobs:
        try:
            out[code] = model.recognize(path)
        except Exception as e:  # noqa: BLE001 — one bad file must not fail the batch
            sys.stderr.write(f"parakeet failed {code}: {e}\n")
    json.dump(out, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())

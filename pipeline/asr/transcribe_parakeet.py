#!/usr/bin/env python3
"""Self-hosted Parakeet ASR for the transcribe stage (replaces Groq Whisper).

Reads a JSON job list [[code, wav_path], ...] from stdin, loads the NeMo
Parakeet model once (onnx-asr, CPU/ONNX — no GPU, no NeMo/CUDA), transcribes
each 16 kHz mono wav, and writes {code: text} JSON to stdout. Per-file errors go
to stderr and omit that code from the output (the caller logs the gap).

Run with the venv interpreter that has onnx-asr installed (PARAKEET_PYTHON).
"""
import json
import sys

import onnx_asr

MODEL = "nemo-parakeet-tdt-0.6b-v2"


def main() -> int:
    jobs = json.load(sys.stdin)
    if not jobs:
        json.dump({}, sys.stdout)
        return 0
    model = onnx_asr.load_model(MODEL)
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

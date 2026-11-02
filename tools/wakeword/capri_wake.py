"""Capri's wake word, on this PC, with openWakeWord (https://github.com/dscripka/openWakeWord).
Capri sends it the microphone as raw 16 kHz, 16-bit mono audio on stdin; it prints "HIT <score>" on stdout each time it hears the word.
Usage: python capri_wake.py <model.onnx> [threshold=0.5]
Nothing is recorded or sent anywhere: the audio only passes through this program's memory."""
import sys
import time

import numpy as np
from openwakeword.model import Model

model_path = sys.argv[1]
threshold = float(sys.argv[2]) if len(sys.argv) > 2 else 0.5
CHUNK = 1280  # 80 ms at 16 kHz: what openWakeWord likes to be given

model = Model(wakeword_models=[model_path], inference_framework="onnx")
print("READY", flush=True)

buf = bytearray()
last_hit = 0.0
stdin = sys.stdin.buffer
while True:
    data = stdin.read1(8192)
    if not data:
        break  # Capri closed
    buf.extend(data)
    while len(buf) >= CHUNK * 2:
        frame = np.frombuffer(bytes(buf[: CHUNK * 2]), dtype=np.int16)
        del buf[: CHUNK * 2]
        scores = model.predict(frame)
        score = max(scores.values()) if scores else 0.0
        now = time.time()
        if score >= threshold and now - last_hit > 2.0:
            last_hit = now
            print(f"HIT {score:.2f}", flush=True)
            try:
                model.reset()
            except Exception:
                pass

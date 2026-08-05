"""Test A: duration=None (natural) vs Test B: duration eksplisit kecil."""
from pathlib import Path
import sys
import numpy as np
import soundfile as sf
import torch
from omnivoice.models.omnivoice import OmniVoice
from omnivoice.utils.common import get_best_device

ref_audio = "E:\\project\\movie2short\\data\\reference\\test_snippet.wav"
ref_text = Path("E:\\project\\movie2short\\data\\reference\\test_snippet.txt").read_text(encoding="utf-8").strip()
outdir = Path("E:\\project\\movie2short\\data\\output\\omnivoice_natural_test")
outdir.mkdir(parents=True, exist_ok=True)

mode = sys.argv[1] if len(sys.argv) > 1 else "none"
text = "Satu kata saja."
print(f"[TEST-{mode}] Loading model...", flush=True)
device = get_best_device()
print(f"[TEST-{mode}] device={device}", flush=True)
model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=device, dtype=torch.float16)
print(f"[TEST-{mode}] model loaded", flush=True)

kwargs = dict(
    text=text,
    language="Indonesian",
    ref_audio=str(ref_audio),
    ref_text=ref_text,
    num_step=16,
    speed=1.12,
    guidance_scale=2.0,
    denoise=True,
    postprocess_output=True,
)
if mode == "none":
    pass  # duration=None natural
elif mode == "short":
    kwargs["duration"] = 1.5  # explicit short duration
else:
    kwargs["duration"] = 3.0

print(f"[TEST-{mode}] generating...", flush=True)
audio = model.generate(**kwargs)[0]
audio = np.asarray(audio, dtype=np.float32).reshape(-1)
dur = len(audio) / model.sampling_rate
sf.write(outdir / f"test_{mode}.wav", audio, model.sampling_rate)
print(f"[TEST-{mode}] OK: {len(text)} chars -> {dur:.2f}s", flush=True)
print(f"[TEST-{mode}] DONE", flush=True)
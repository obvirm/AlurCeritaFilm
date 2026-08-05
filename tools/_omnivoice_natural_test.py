"""Smoke test: OmniVoice generate with duration=None (natural duration)."""
from pathlib import Path
import numpy as np
import soundfile as sf
import torch
from omnivoice.models.omnivoice import OmniVoice
from omnivoice.utils.common import get_best_device

ref_audio = "E:\\project\\movie2short\\data\\reference\\test_snippet.wav"
ref_text = Path("E:\\project\\movie2short\\data\\reference\\test_snippet.txt").read_text(encoding="utf-8").strip()
outdir = Path("E:\\project\\movie2short\\data\\output\\omnivoice_natural_test")
outdir.mkdir(parents=True, exist_ok=True)

device = get_best_device()
print(f"[TEST] Loading on {device}", flush=True)
model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=device, dtype=torch.float16)

tests = [
    ("Satu kata saja.", "short_1kata"),
    ("nah.", "short_nah"),
    ("Pagi-pagi Spongebob dibangunkan oleh 'alarm' unik dari si ikan pantomim, sampai-sampai ia jatuh dari tempat tidur.", "long_scene19"),
]
for text, name in tests:
    # duration=None: model estimates natural duration from text
    audio = model.generate(
        text=text,
        language="Indonesian",
        ref_audio=str(ref_audio),
        ref_text=ref_text,
        num_step=16,
        speed=1.12,
        guidance_scale=2.0,
        denoise=True,
        postprocess_output=True,
    )[0]
    audio = np.asarray(audio, dtype=np.float32).reshape(-1)
    dur = len(audio) / model.sampling_rate
    sf.write(outdir / f"{name}.wav", audio, model.sampling_rate)
    print(f"[TEST] {name}: {len(text)} chars -> {dur:.2f}s ({dur*30/len(text):.1f} ms/char)", flush=True)
    print(f"[TEST] saved {outdir / name}.wav", flush=True)
print("[TEST] DONE", flush=True)
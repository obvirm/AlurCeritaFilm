"""Generate one OmniVoice narration track with NATURAL per-scene durations.

Berbeda dengan omnivoice_manifest_tts.py (yang memaksa duration = durasi scene
video sehingga suara melebar), tool ini memakai duration=None supaya model
mengestimasi durasi natural dari teks. Setiap scene video nantinya dipotong
pas dengan durasi narasi scene-nya (narasi menentukan durasi).

Output:
- narration_scenes/scene_XXXX.wav  (audio natural per scene)
- narration_omnivoice_natural.wav  (concat semua scene, urutan manifest)
- narration_omnivoice_natural.json (metadata + durasi natural per scene)
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from omnivoice.models.omnivoice import OmniVoice
from omnivoice.utils.common import get_best_device


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--ref-audio", required=True)
    parser.add_argument("--ref-text", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default="k2-fsa/OmniVoice")
    parser.add_argument("--language", default="Indonesian")
    parser.add_argument("--speed", type=float, default=1.12)
    parser.add_argument("--num-step", type=int, default=16)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    manifest_path = Path(args.manifest).resolve()
    output_path = Path(args.output).resolve()
    ref_audio = Path(args.ref_audio).resolve()
    ref_text = Path(args.ref_text).read_text(encoding="utf-8").strip()

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    scenes = manifest.get("scenes", [])
    if not scenes:
        raise ValueError("Manifest contains no scenes")
    if not ref_audio.is_file():
        raise FileNotFoundError(f"Reference audio not found: {ref_audio}")
    if not ref_text:
        raise ValueError("Reference transcript is empty")

    device = get_best_device()
    print(f"[OmniVoice-natural] Loading {args.model} on {device}", flush=True)
    model = OmniVoice.from_pretrained(
        args.model,
        device_map=device,
        dtype=torch.float16,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    scene_dir = output_path.parent / "narration_scenes_natural"
    scene_dir.mkdir(parents=True, exist_ok=True)

    generated: list[np.ndarray] = []
    scene_files: list[str] = []
    scene_durations: list[float] = []
    for index, scene in enumerate(scenes):
        text = str(scene.get("narration_text", "")).strip()
        duration = float(scene["end_sec"]) - float(scene["start_sec"])
        if not text or duration <= 0:
            raise ValueError(f"Invalid narration scene at index {index}")

        print(
            f"[OmniVoice-natural] Scene {index + 1}/{len(scenes)} "
            f"(scene={duration:.2f}s, chars={len(text)}): {text[:60]}",
            flush=True,
        )
        # duration=None -> model estimates natural duration from text
        audio = model.generate(
            text=text,
            language=args.language,
            ref_audio=str(ref_audio),
            ref_text=ref_text,
            duration=None,
            num_step=args.num_step,
            speed=args.speed,
            guidance_scale=2.0,
            denoise=True,
            postprocess_output=True,
        )[0]
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)

        scene_path = scene_dir / f"scene_{index + 1:04d}.wav"
        sf.write(scene_path, audio, model.sampling_rate)
        generated.append(audio)
        scene_files.append(str(scene_path.relative_to(output_path.parent)))
        scene_durations.append(round(len(audio) / model.sampling_rate, 3))
        print(
            f"[OmniVoice-natural]   -> {scene_durations[-1]}s",
            flush=True,
        )

    track = np.concatenate(generated)
    sf.write(output_path, track, model.sampling_rate)

    metadata = {
        "engine": "OmniVoice",
        "mode": "natural-duration",
        "model": args.model,
        "referenceAudio": str(ref_audio),
        "language": args.language,
        "sampleRate": model.sampling_rate,
        "channels": 1,
        "durationSec": round(len(track) / model.sampling_rate, 3),
        "sceneCount": len(scenes),
        "sceneFiles": scene_files,
        # Keep each original visual scene intact. When narration is shorter,
        # silence is added after it. When narration is longer, the renderer
        # freezes the final frame instead of leaking into the next scene.
        "sceneDurationsSec": scene_durations,
        "sceneSourceDurationsSec": [
            round(float(scene["end_sec"]) - float(scene["start_sec"]), 3)
            for scene in scenes
        ],
    }
    metadata_path = output_path.with_suffix(".json")
    metadata_path.write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"[OmniVoice-natural] Narration track: {output_path}", flush=True)
    print(f"[OmniVoice-natural] Metadata: {metadata_path}", flush=True)


if __name__ == "__main__":
    main()

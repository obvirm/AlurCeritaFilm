"""Generate one OmniVoice narration track from a movie2short manifest.

The model is loaded once. Each scene is synthesized to the selected visual
scene duration, then all scene waveforms are concatenated in manifest order.
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
    print(f"[OmniVoice] Loading {args.model} on {device}", flush=True)
    model = OmniVoice.from_pretrained(
        args.model,
        device_map=device,
        dtype=torch.float16,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    scene_dir = output_path.parent / "narration_scenes"
    scene_dir.mkdir(parents=True, exist_ok=True)

    generated: list[np.ndarray] = []
    scene_files: list[str] = []
    for index, scene in enumerate(scenes):
        text = str(scene.get("narration_text", "")).strip()
        duration = float(scene["end_sec"]) - float(scene["start_sec"])
        if not text or duration <= 0:
            raise ValueError(f"Invalid narration scene at index {index}")

        print(
            f"[OmniVoice] Scene {index + 1}/{len(scenes)} "
            f"({duration:.2f}s): {text[:70]}",
            flush=True,
        )
        audio = model.generate(
            text=text,
            language=args.language,
            ref_audio=str(ref_audio),
            ref_text=ref_text,
            duration=duration,
            num_step=args.num_step,
            speed=args.speed,
            guidance_scale=2.0,
            denoise=True,
            postprocess_output=True,
        )[0]
        audio = np.asarray(audio, dtype=np.float32).reshape(-1)

        expected_samples = round(duration * model.sampling_rate)
        if len(audio) < expected_samples:
            audio = np.pad(audio, (0, expected_samples - len(audio)))
        elif len(audio) > expected_samples:
            audio = audio[:expected_samples]

        scene_path = scene_dir / f"scene_{index + 1:04d}.wav"
        sf.write(scene_path, audio, model.sampling_rate)
        generated.append(audio)
        scene_files.append(str(scene_path.relative_to(output_path.parent)))

    track = np.concatenate(generated)
    sf.write(output_path, track, model.sampling_rate)

    metadata = {
        "engine": "OmniVoice",
        "model": args.model,
        "referenceAudio": str(ref_audio),
        "language": args.language,
        "sampleRate": model.sampling_rate,
        "channels": 1,
        "durationSec": len(track) / model.sampling_rate,
        "sceneCount": len(scenes),
        "sceneFiles": scene_files,
    }
    metadata_path = output_path.with_suffix(".json")
    metadata_path.write_text(
        json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"[OmniVoice] Narration track: {output_path}", flush=True)
    print(f"[OmniVoice] Metadata: {metadata_path}", flush=True)


if __name__ == "__main__":
    main()

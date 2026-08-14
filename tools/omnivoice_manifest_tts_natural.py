"""Generate one OmniVoice narration track with NATURAL per-scene durations.

Berbeda dengan omnivoice_manifest_tts.py (yang memaksa duration = durasi scene
video sehingga suara melebar), tool ini memakai duration=None supaya model
mengestimasi durasi natural dari teks. Setiap scene video nantinya dipotong
pas dengan durasi narasi scene-nya (narasi menentukan durasi).

--lead / --tail (default 5s/5s): jeda diam di awal & akhir SETIAP clip TTS.
Gap ini HANYA ada di file raw per-scene (narration_scenes_natural/scene_XXXX.wav)
— fungsinya biar onset/ekor kalimat tidak terpotong langsung saat generate
(sumber halusinasi). Saat PENGGABUNGAN (concat ke satu track final), gap
DIHAPUS: track final murni suara natural tanpa jeda panjang.

Output:
- narration_scenes_natural/scene_XXXX.wav  (raw per scene, DENGAN gap)
- narration_omnivoice_natural.wav  (concat semua scene TANPA gap, urutan manifest)
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
    parser.add_argument(
        "--device",
        default=None,
        help="Force device: cpu / cuda / auto (default get_best_device)."
    )
    parser.add_argument(
        "--lead",
        type=float,
        default=5.0,
        help="Diam (detik) di AWAL tiap clip TTS — jeda sebelum kalimat mulai. 0 = mati.",
    )
    parser.add_argument(
        "--tail",
        type=float,
        default=5.0,
        help="Diam (detik) di AKHIR tiap clip TTS — jeda setelah kalimat selesai. 0 = mati.",
    )
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

    device = args.device if args.device and args.device != "auto" else get_best_device()
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
        sr = model.sampling_rate

        # Padding di RAW TTS: lead (diam sebelum kalimat) + tail (diam sesudah
        # kalimat) untuk SETIAP scene — biar onset/ekor kalimat tidak terpotong
        # langsung di batas clip (sumber "halusinasi"). Versi INI (dengan gap)
        # hanya disimpan sebagai file raw per-scene (buat didengar/debug).
        padded = audio
        if args.lead > 0:
            lead_pad = np.zeros(int(round(args.lead * sr)), dtype=np.float32)
            padded = np.concatenate([lead_pad, padded])
        if args.tail > 0:
            tail_pad = np.zeros(int(round(args.tail * sr)), dtype=np.float32)
            padded = np.concatenate([padded, tail_pad])

        scene_path = scene_dir / f"scene_{index + 1:04d}.wav"
        sf.write(scene_path, padded, model.sampling_rate)
        scene_files.append(str(scene_path.relative_to(output_path.parent)))

        # PENGGABUNGAN: gap TIDAK dibawa ke track final — yang di-merge adalah
        # suara asli (tanpa lead/tail), jadi narasi mengalir tanpa jeda panjang.
        # Gap hanya dipakai di level raw (sementara), dihilangkan saat merge.
        generated.append(audio)
        scene_durations.append(round(len(audio) / sr, 3))
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
        "leadSec": args.lead,
        "tailSec": args.tail,
        "gapAppliedTo": "raw-scene-files-only",  # gap TIDAK dibawa ke track gabungan
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

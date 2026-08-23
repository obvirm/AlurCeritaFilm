#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Higgs Audio v3 TTS — narasi per-scene dari manifest.json dengan voice cloning.
- Load model SEKALI, generate SEMUA scene, resume dari scene yang sudah ada.
- Log progres ke file (bukan stdout) supaya robust terhadap proses eksternal.
"""
import argparse, json, os, sys, time, traceback
from pathlib import Path

os.environ.setdefault('PYTORCH_CUDA_ALLOC_CONF', 'expandable_segments:True')
os.environ.setdefault('HF_HOME', r'E:\project\movie2short\.cache\huggingface')

import numpy as np
import torch
import soundfile as sf
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_REPO = r'E:\project\movie2short\models\higgs-transformers'
LOG_FILE = None

def log(msg):
    line = f'[{time.strftime("%H:%M:%S")}] {msg}'
    print(line, flush=True)
    if LOG_FILE:
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')

def main():
    global LOG_FILE
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--ref-audio", required=True)
    ap.add_argument("--ref-text", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--log", default=None)
    ap.add_argument("--max-new-tokens", type=int, default=2048)
    ap.add_argument("--temperature", type=float, default=0.7)
    ap.add_argument("--gpu-mb", type=int, default=5500)
    args = ap.parse_args()
    LOG_FILE = args.log

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    scenes_dir = out_path.parent / "narration_scenes_higgs"
    scenes_dir.mkdir(parents=True, exist_ok=True)

    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    scenes = manifest["scenes"]
    log(f"START {len(scenes)} scenes | model={MODEL_REPO}")

    # ---- load model (sekali) ----
    log("load tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_REPO, trust_remote_code=True)
    # Skip transformers' caching_allocator_warmup (crash hard 0xc0000005 di torch_cpu.dll di Windows)
    import transformers.modeling_utils as mu
    mu.caching_allocator_warmup = lambda *a, **k: None
    # Fix safetensors mmap backend crash (>4GB file di Windows, 0xc0000005) -> force pread
    import safetensors
    _orig_safe_open = safetensors.safe_open
    def _pread_open(*a, **kw):
        kw.setdefault('backend', 'pread')
        return _orig_safe_open(*a, **kw)
    safetensors.safe_open = _pread_open
    mu.safe_open = _pread_open
    log("load model (device_map auto, gpu limit %dMB)..." % args.gpu_mb)
    t0 = time.time()
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_REPO,
        trust_remote_code=True,
        torch_dtype=torch.bfloat16,
        device_map='auto',
        max_memory={0: f'{args.gpu_mb}MB', 'cpu': '20GB'},
        low_cpu_mem_usage=True,
    ).eval()
    model.get_audio_codec()
    SR = model.config.sample_rate
    log(f"model loaded in {time.time()-t0:.1f}s SR={SR}")

    # ---- reference ----
    ref_data, ref_sr = sf.read(args.ref_audio, dtype="float32", always_2d=True)
    ref_wav = torch.from_numpy(ref_data).mean(dim=1)
    ref_text = Path(args.ref_text).read_text(encoding="utf-8").strip()
    log(f"ref ok {ref_sr}Hz len={len(ref_wav)}")

    # ---- generate per scene dengan resume ----
    generated, durations, scene_files = [], [], []
    t_total = time.time()
    for i, sc in enumerate(scenes, 1):
        text = sc.get("narration_text", "").strip()
        if not text:
            log(f"scene {i}: SKIP (narration kosong)")
            continue
        wav_file = scenes_dir / f"scene_{i:04d}.wav"
        if wav_file.exists():
            audio, sr2 = sf.read(wav_file, dtype="float32")
            log(f"scene {i}: resume (sudah ada {len(audio)/SR:.2f}s)")
            generated.append(audio)
            durations.append(len(audio) / SR)
            scene_files.append(wav_file)
            continue
        t1 = time.time()
        try:
            audio = model.generate_speech(
                text, tokenizer,
                max_new_tokens=args.max_new_tokens,
                temperature=args.temperature,
                reference_audio=ref_wav,
                reference_sample_rate=ref_sr,
                reference_text=ref_text,
            )
        except Exception:
            log(f"scene {i}: GEN FAIL " + traceback.format_exc().splitlines()[-1][:200])
            raise
        if audio.numel() == 0:
            log(f"scene {i}: audio kosong! SKIP")
            continue
        audio = audio.detach().float().cpu().numpy()
        dur = len(audio) / SR
        sf.write(wav_file, audio, SR, subtype="PCM_16")
        generated.append(audio)
        durations.append(dur)
        scene_files.append(wav_file)
        log(f"scene {i}/{len(scenes)}: {dur:.2f}s ({len(text)} chars) in {time.time()-t1:.1f}s")

    track = np.concatenate(generated) if generated else np.zeros(0, dtype=np.float32)
    sf.write(out_path, track, SR, subtype="PCM_16")
    meta = {
        "engine": "HiggsAudioV3",
        "mode": "per-scene",
        "model": "multimodalart/higgs-audio-v3-tts-4b-transformers",
        "referenceAudio": str(Path(args.ref_audio).resolve()),
        "language": "Indonesian",
        "sampleRate": SR,
        "channels": 1,
        "durationSec": round(len(track) / SR, 3),
        "sceneCount": len(durations),
        "sceneFiles": [f"narration_scenes_higgs/scene_{i+1:04d}.wav" for i in range(len(durations))],
        "sceneDurationsSec": [round(d, 3) for d in durations],
    }
    meta_path = out_path.with_suffix(".json")
    meta_path.write_text(json.dumps(meta, indent=2), encoding="utf-8")
    log(f"TOTAL {meta['durationSec']}s -> {out_path} + {meta_path} | {time.time()-t_total:.1f}s")
    log("DONE_OK")

if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        log("FATAL: " + traceback.format_exc())
        sys.exit(1)
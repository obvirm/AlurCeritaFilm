"""Spawn the OmniVoice TTS pipeline as a detached process (survives parent exit)."""
import os
import subprocess

ROOT = r"E:\project\movie2short"
PY = os.path.join(ROOT, ".venv-omnivoice", "Scripts", "python.exe")
SCRIPT = os.path.join(ROOT, "tools", "omnivoice_manifest_tts_natural.py")
JOB = os.path.join(ROOT, "data", "output", "jobs", "1786720593364-fab644")
LOG = os.path.join(JOB, "tts_natural.log")

env = os.environ.copy()
env["HF_HOME"] = os.path.join(ROOT, ".cache", "huggingface")
env["HF_HUB_OFFLINE"] = "1"
env["CUDA_VISIBLE_DEVICES"] = "0"  # GPU tersedia (8.8 GB free) — jauh lebih cepat dari CPU

args = [
    PY,
    SCRIPT,
    "--manifest", os.path.join(JOB, "manifest.json"),
    "--ref-audio", os.path.join(ROOT, "data", "reference", "test_snippet.wav"),
    "--ref-text", os.path.join(ROOT, "data", "reference", "test_snippet.txt"),
    "--output", os.path.join(JOB, "narration_natural.wav"),
    "--device", "cuda",
]

logf = open(LOG, "w", encoding="utf-8")
proc = subprocess.Popen(
    args,
    cwd=ROOT,
    env=env,
    stdout=logf,
    stderr=subprocess.STDOUT,
    stdin=subprocess.DEVNULL,
    creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
    close_fds=True,
)
print(f"spawned pid={proc.pid}")

"""Spawn the movie2short render as a detached process."""
import os
import subprocess

ROOT = r"E:\project\movie2short"
JOB = os.path.join(ROOT, "data", "output", "jobs", "1786649103630-db4989")
LOG = os.path.join(JOB, "render.log")
VIDEO = r"C:\Users\X\Downloads\getvid.mp4"

env = os.environ.copy()

# Run via cmd.exe /c with a plain command line (no extra quoting on npx itself)
cmdline = (
    "npx tsx src/index.ts "
    f"--only-render \"{os.path.join(JOB, 'manifest.json')}\" "
    f"--video \"{VIDEO}\" "
    f"--out \"{JOB}\" "
    f"--audio \"{os.path.join(JOB, 'narration_natural.wav')}\" "
    f"--scene-durations \"{os.path.join(JOB, 'narration_natural.json')}\""
)

logf = open(LOG, "w", encoding="utf-8")
proc = subprocess.Popen(
    ["cmd.exe", "/c", cmdline],
    cwd=ROOT,
    env=env,
    stdout=logf,
    stderr=subprocess.STDOUT,
    stdin=subprocess.DEVNULL,
    creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
    close_fds=True,
)
print(f"spawned pid={proc.pid}")

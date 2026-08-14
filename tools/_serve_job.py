"""Serve the job output folder over HTTP (with Range support) for preview."""
import os
import subprocess

JOB = r"E:\project\movie2short\data\output\jobs\1786720593364-fab644"
PORT = "8137"

env = os.environ.copy()
proc = subprocess.Popen(
    ["python", "-m", "http.server", PORT, "--bind", "127.0.0.1"],
    cwd=JOB,
    env=env,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    stdin=subprocess.DEVNULL,
    creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP,
    close_fds=True,
)
print(f"serving {JOB} on http://127.0.0.1:{PORT}/ pid={proc.pid}")

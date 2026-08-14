"""Test: send FULL MP4 (11 min) directly to 9Router ag/gemini-3.6-flash-high."""
import base64
import json
import os
import urllib.request

KEY = "sk-bdce2f8bda4f930c-utjako-ab5e1326"
URL = "http://localhost:20128/v1/chat/completions"
MODEL = "ag/gemini-3.6-flash-high"
VIDEO = r"C:\Users\X\Downloads\getvid.mp4"

size = os.path.getsize(VIDEO)
print(f"video: {size/1024/1024:.1f} MB")
with open(VIDEO, "rb") as f:
    b64 = base64.b64encode(f.read()).decode()
print(f"base64 payload: {len(b64)/1024/1024:.1f} MB")

payload = {
    "model": MODEL,
    "stream": False,
    "max_tokens": 300,
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Video ini 11 menit. Ceritakan apa yang terjadi di 30 detik pertama secara singkat. Kamu melihat videonya dengan jelas?"},
                {"type": "image_url", "image_url": {"url": f"data:video/mp4;base64,{b64}"}},
            ],
        }
    ],
}

req = urllib.request.Request(
    URL,
    data=json.dumps(payload).encode(),
    headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
)
try:
    r = urllib.request.urlopen(req, timeout=600)
    resp = json.loads(r.read())
    msg = resp.get("choices", [{}])[0].get("message", {})
    print("MODEL:", MODEL)
    print("content:", json.dumps(msg.get("content"), ensure_ascii=False)[:400])
except Exception as e:
    print("FAIL:", e)
    if hasattr(e, "read"):
        print(e.read().decode()[:500])

"""Test: send MP4 directly to 9Router ag/gemini-3.6-flash-high (video input)."""
import base64
import json
import urllib.request

KEY = "sk-bdce2f8bda4f930c-utjako-ab5e1326"
URL = "http://localhost:20128/v1/chat/completions"
MODEL = "ag/gemini-3.6-flash-high"
VIDEO = r"data/output/_r9test/_quota_test.mp4"  # 4s clip

with open(VIDEO, "rb") as f:
    b64 = base64.b64encode(f.read()).decode()

payload = {
    "model": MODEL,
    "stream": False,
    "max_tokens": 300,
    "messages": [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "Deskripsikan video ini 1 kalimat saja. Kamu melihat videonya atau tidak?"},
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
    r = urllib.request.urlopen(req, timeout=180)
    resp = json.loads(r.read())
    msg = resp.get("choices", [{}])[0].get("message", {})
    print("MODEL:", MODEL)
    print("content:", json.dumps(msg.get("content"), ensure_ascii=False)[:500])
    if msg.get("content") is None:
        print("reasoning:", json.dumps(msg.get("reasoning"), ensure_ascii=False)[:200])
except Exception as e:
    print("FAIL:", e)
    if hasattr(e, "read"):
        print(e.read().decode()[:500])

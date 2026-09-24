#!/bin/sh
# Resolve Chromium Playwright untuk tscaps caption + overlay.
set -e

if [ -z "$TSCAPS_CHROME_PATH" ]; then
  # Chrome asli (bawa codec H.264) diutamakan — chromium Playwright tidak bisa decode H.264.
  if [ -f /usr/bin/google-chrome-stable ]; then
    export TSCAPS_CHROME_PATH=/usr/bin/google-chrome-stable
    echo "[entrypoint] TSCAPS_CHROME_PATH=$TSCAPS_CHROME_PATH (dengan H.264)"
  else
    CHROME="$(node -e "try{console.log(require('playwright').chromium.executablePath())}catch(e){}" 2>/dev/null || true)"
    if [ -n "$CHROME" ] && [ -f "$CHROME" ]; then
      export TSCAPS_CHROME_PATH="$CHROME"
      echo "[entrypoint] TSCAPS_CHROME_PATH=$CHROME"
    else
      echo "[entrypoint] WARNING: chromium playwright tidak ketemu, caption/overlay akan gagal." >&2
    fi
  fi
fi

mkdir -p /app/data/uploads /app/data/output/jobs

# HTTP server model Whisper lokal (template.ts redirect HF Hub → :8877).
# Background; gagal start tidak menggagalkan container.
mkdir -p /root/.cache/huggingface/hub
if command -v python3 >/dev/null 2>&1; then
  nohup python3 -c "
import http.server, socketserver, os
os.chdir('/root/.cache/huggingface/hub')
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        super().end_headers()
    def log_message(self, *a): pass
socketserver.TCPServer.allow_reuse_address = True
socketserver.TCPServer(('0.0.0.0', 8877), H).serve_forever()
" >/tmp/whisper-model-server.log 2>&1 &
  echo "[entrypoint] model server :8877 (pid $!)"
fi

if [ -z "$OPENAI_API_KEY" ]; then
  echo "[entrypoint] WARNING: OPENAI_API_KEY kosong — analysis butuh API cloud di VPS." >&2
fi

exec "$@"

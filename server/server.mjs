/**
 * MOVIE2SHORT Studio — Backend Server
 *
 * Vanilla Node HTTP server + WebSocket. Mengontrol pipeline sebagai subprocess:
 *   1. Analysis (Gemini/llava) -> manifest.json
 *   2. TTS OmniVoice natural -> narration wav + json
 *   3. Render FFmpeg (narasi master timeline)
 *   4. Caption tscaps (headless, template Loki) -> final_captioned_loki.mp4
 *
 * Endpoints:
 *   POST /api/upload?name=<file.mp4>   raw body -> data/uploads/<name>
 *   POST /api/run                      { videoPath, model, stretch, hzoom, cameraPlan, caption } -> { jobId }
 *   GET  /api/jobs/:id                 status + artifacts job
 *   GET  /api/outputs                  daftar job terakhir
 *   WS   /ws?job=<jobId>               stream log live
 *   GET  /files/<jobId>/<name>         serve artifact (video hasil, srt, dll)
 *   GET  /*                            static frontend dari server/public/
 *
 * Jalankan:  node server/server.mjs        (atau: npm run dev:ui)
 */
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOAD_DIR = path.join(ROOT, "data", "uploads");
const JOBS_DIR = path.join(ROOT, "data", "output", "jobs");

// ---------------------------------------------------------------------------
// Konfigurasi pipeline (bisa dioverride via env)
// ---------------------------------------------------------------------------
const CFG = {
  tsxCli: path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
  pythonTts: path.join(ROOT, ".venv-omnivoice", "Scripts", "python.exe"),
  ttsScript: path.join(ROOT, "tools", "omnivoice_manifest_tts_natural.py"),
  refAudio: path.join(ROOT, "data", "reference", "test_snippet.wav"),
  refText: path.join(ROOT, "data", "reference", "test_snippet.txt"),
  // tscaps (repo terpisah, headless caption via Playwright + Chrome)
  tscapsExamples: process.env.TSCAPS_EXAMPLES_DIR || path.resolve(ROOT, "..", "tscaps", "packages", "engine", "examples"),
  tscapsChrome: process.env.TSCAPS_CHROME_PATH || "C:\\Users\\X\\AppData\\Local\\ms-playwright\\chromium-1228\\chrome-win64\\chrome.exe",
  ttsEnv: {
    HF_HOME: "E:\\project\\movie2short\\.cache\\huggingface",
    HF_HUB_OFFLINE: "1",
    CUDA_VISIBLE_DEVICES: "",
  },
};

await fsp.mkdir(UPLOAD_DIR, { recursive: true });
await fsp.mkdir(JOBS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Job store
// ---------------------------------------------------------------------------
const jobs = new Map(); // jobId -> { id, status, stages, log[], createdAt, dir, artifacts }

/**
 * Restores finished jobs from disk on startup (job store is
 * in-memory). Scans JOBS_DIR for directories with a manifest.json and
 * at least one artifact; registers them as `done` so the frontend can
 * pick up results after a server restart.
 */
async function loadPersistedJobs() {
  const entries = await fsp.readdir(JOBS_DIR, { withFileTypes: true }).catch(() => []);
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(JOBS_DIR, e.name);
    if (!fs.existsSync(path.join(dir, "manifest.json"))) continue;
    const files = await fsp.readdir(dir).catch(() => []);
    const artifacts = [];
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      const kind =
        ext === ".mp4" ? "video" :
        ext === ".srt" ? "srt" :
        ext === ".wav" ? "audio" :
        ext === ".json" ? "json" :
        ext === ".txt" ? "text" : null;
      if (kind) artifacts.push({ name: f, path: path.join(dir, f), kind });
    }
    if (artifacts.length === 0) continue;
    const stat = await fsp.stat(dir).catch(() => null);
    const id = e.name;
    const job = {
      id,
      dir,
      status: "done",
      stage: "caption",
      log: [{
        t: new Date().toISOString(),
        level: "info",
        line: `[restored] job selesai dimuat ulang dari disk (${artifacts.length} artifact)`,
      }],
      createdAt: stat ? new Date(stat.mtimeMs).toISOString() : new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: null,
      artifacts,
    };
    jobs.set(id, job);
  }
}

await loadPersistedJobs();

function createJob() {
  const id = `${Date.now()}-${randomUUID().slice(0, 6)}`;
  const dir = path.join(JOBS_DIR, id);
  const job = {
    id,
    dir,
    status: "queued", // queued | running | done | error | cancelled
    stage: null, // analysis | tts | camera-plan | render | caption
    log: [],
    createdAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    artifacts: [], // { name, path, kind }
  };
  jobs.set(id, job);
  return job;
}

// ---------------------------------------------------------------------------
// WebSocket hub — broadcast log per job
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });
const wsClients = new Map(); // jobId -> Set<WebSocket>

function subscribe(jobId, ws) {
  if (!wsClients.has(jobId)) wsClients.set(jobId, new Set());
  wsClients.get(jobId).add(ws);
  ws.on("close", () => {
    const set = wsClients.get(jobId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) wsClients.delete(jobId);
    }
  });
}

function pushLog(job, line, level = "info") {
  const entry = { t: new Date().toISOString(), level, line: String(line).replace(/\r?\n$/, "") };
  job.log.push(entry);
  if (job.log.length > 4000) job.log.splice(0, job.log.length - 4000);
  const set = wsClients.get(job.id);
  if (set) {
    const msg = JSON.stringify({ type: "log", jobId: job.id, entry });
    for (const ws of set) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

function pushStatus(job, status, stage = job.stage) {
  job.status = status;
  if (stage !== undefined) job.stage = stage;
  if (status === "done" || status === "error") job.finishedAt = new Date().toISOString();
  const set = wsClients.get(job.id);
  if (set) {
    const msg = JSON.stringify({ type: "status", jobId: job.id, status, stage: job.stage });
    for (const ws of set) if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  }
}

// ---------------------------------------------------------------------------
// Subprocess helper — stream stdout/stderr ke log, resolve on exit
// ---------------------------------------------------------------------------
function run(job, label, cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    pushLog(job, `\n━━━ [${label}] ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...(opts.env || {}) },
      shell: opts.shell || false,
      windowsHide: true,
    });
    job._proc = child;
    child.stdout?.on("data", (d) => {
      for (const line of d.toString().split("\n")) if (line.trim()) pushLog(job, line, "out");
    });
    child.stderr?.on("data", (d) => {
      for (const line of d.toString().split("\n")) if (line.trim()) pushLog(job, line, "err");
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
  });
}

function runNode(job, label, script, args, opts = {}) {
  return run(job, label, process.execPath, [CFG.tsxCli, script, ...args], opts);
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
async function runPipeline(job, input) {
  const { videoPath, model, stretch, hzoom, cameraPlan, caption, lead, tail } = input;
  pushLog(job, `Video  : ${videoPath}`);
  pushLog(job, `Model  : ${model}`);
  pushLog(job, `Chunk  : ${input.chunk !== undefined ? (input.chunk === 0 ? "FULL (tanpa chunk)" : input.chunk + "s") : "40s (default)"} | Stretch: ${stretch ?? "-"} | hZoom: ${hzoom ?? "-"} | CameraPlan: ${cameraPlan ? "ON" : "OFF"} | Caption: ${caption ? "ON" : "OFF"} | Jeda TTS: lead ${lead ?? 5}s + tail ${tail ?? 5}s`);

  // 1. ANALYSIS -------------------------------------------------------------
  pushStatus(job, "running", "analysis");
  const manifestPath = path.join(job.dir, "manifest.json");
  await runNode(job, "ANALYSIS", "server/analyze-only.ts", [
    videoPath, job.dir, model,
  ], input.chunk !== undefined ? { env: { M2S_CHUNK_DURATION: String(input.chunk) } } : {});
  // Cek hasil analysis: manifest.json harus ada & punya scenes
  if (!fs.existsSync(manifestPath)) {
    let detail = "manifest.json tidak dibuat oleh analysis.";
    try {
      const stage1 = JSON.parse(await fsp.readFile(path.join(job.dir, "manifest_stage1.json"), "utf8"));
      if (!stage1.scenes?.length) {
        detail = `Analysis menghasilkan 0 scene. ${model.startsWith("gemini/") ? "Cek GEMINI_API_KEY di .env atau coba model llava:7b." : "Cek Ollama berjalan (llava:7b) atau coba model gemini/gemini-3.6-flash."}`;
      }
    } catch {}
    throw new Error(detail);
  }
  // Validasi tambahan: manifest bisa lolos tapi berisi 0 scene (mis. kuota
  // Gemini habis/429 di tengah analisis) — gagalkan lebih awal dengan hint.
  try {
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    if (!manifest.scenes?.length) {
      throw new Error(`Analysis menghasilkan 0 scene. ${model.startsWith("gemini/") ? "Kuota Gemini kemungkinan habis (429) — tunggu reset atau coba model llava:7b." : "Cek Ollama berjalan (llava:7b) atau coba model gemini/gemini-3.6-flash."}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Analysis menghasilkan 0 scene")) throw e;
    throw new Error(`manifest.json tidak valid: ${e instanceof Error ? e.message : String(e)}`);
  }
  pushLog(job, "[analysis] selesai -> manifest.json");

  // 2. CAMERA PLAN (opsional, pakai llava lokal) -----------------------------
  let cameraPlanPath;
  if (cameraPlan) {
    pushStatus(job, "running", "camera-plan");
    cameraPlanPath = path.join(job.dir, "camera_plan.json");
    try {
      await runNode(job, "CAMERA PLAN", "tools/director_positions.ts", [
        manifestPath, cameraPlanPath,
      ], { env: { DIRECTOR_VIDEO: videoPath } });
      pushLog(job, "[camera-plan] selesai");
    } catch (e) {
      pushLog(job, `[camera-plan] gagal, lanjut tanpa camera plan: ${e.message}`, "warn");
      cameraPlanPath = undefined;
    }
  }

  // 3. TTS OmniVoice natural --------------------------------------------------
  pushStatus(job, "running", "tts");
  const narrationWav = path.join(job.dir, "narration_omnivoice_natural.wav");
  const narrationJson = path.join(job.dir, "narration_omnivoice_natural.json");
  const ttsArgs = [
    CFG.ttsScript,
    "--manifest", manifestPath,
    "--ref-audio", CFG.refAudio,
    "--ref-text", CFG.refText,
    "--output", narrationWav,
  ];
  if (lead !== undefined && lead !== null) ttsArgs.push("--lead", String(lead));
  if (tail !== undefined && tail !== null) ttsArgs.push("--tail", String(tail));
  ttsArgs.push("--device", "cpu"); // force CPU — VRAM host jenuh; env CUDA_VISIBLE_DEVICES='' di-drop spawn Windows
  await run(job, "TTS OMNI-VOICE", CFG.pythonTts, ttsArgs, { env: CFG.ttsEnv });
  pushLog(job, "[tts] selesai -> " + narrationWav);

  // 4. RENDER FFmpeg (narasi master timeline) --------------------------------
  pushStatus(job, "running", "render");
  const finalShort = path.join(job.dir, "final_short.mp4");
  const renderArgs = [
    "--only-render", manifestPath,
    "--video", videoPath,
    "--audio", narrationWav,
    "--scene-durations", narrationJson,
    "--out", finalShort,
  ];
  if (cameraPlanPath) renderArgs.push("--camera-plan", cameraPlanPath);
  if (stretch !== undefined && stretch !== null) renderArgs.push("--stretch", String(stretch));
  if (hzoom !== undefined && hzoom !== null) renderArgs.push("--hzoom", String(hzoom));
  await runNode(job, "RENDER FFMPEG", "src/index.ts", renderArgs);
  pushLog(job, "[render] selesai -> final_short.mp4");
  job.artifacts.push({ name: "final_short.mp4", path: finalShort, kind: "video" });

  // 5. CAPTION tscaps headless (template pilihan user) -------------------------
  let finalCaptioned;
  if (caption) {
    pushStatus(job, "running", "caption");
    const tpl = input.template || "loki";
    const capName = `final_captioned_${tpl}.mp4`;
    const srtName = `final_captioned_${tpl}.srt`;
    const srtPath = path.join(job.dir, srtName);
    finalCaptioned = path.join(job.dir, capName);
    try {
      await run(job, `CAPTION TSCAPS (${tpl})`, process.execPath, [
        CFG.tsxCli, "cli/render-movie2short-template.ts",
        "--template", tpl,
        "--video", finalShort,
        "--manifest", manifestPath,
        "--durations", narrationJson,
        "--output", finalCaptioned,
        "--width", "1080",
        "--height", "1920",
      ], {
        cwd: CFG.tscapsExamples,
        env: { TSCAPS_CHROME_PATH: CFG.tscapsChrome },
      });
      pushLog(job, `[caption] selesai -> ${capName}`);
      job.artifacts.push({ name: capName, path: finalCaptioned, kind: "video" });
      if (fs.existsSync(srtPath)) job.artifacts.push({ name: srtName, path: srtPath, kind: "srt" });
    } catch (e) {
      pushLog(job, `[caption] gagal (video tetap tersedia tanpa caption): ${e.message}`, "warn");
    }
  }

  // Artifacts pendukung
  for (const [name, p, kind] of [
    ["manifest.json", manifestPath, "json"],
    ["narasi.txt", path.join(job.dir, "narasi.txt"), "text"],
    ["narration_omnivoice_natural.wav", narrationWav, "audio"],
    ["narration_omnivoice_natural.json", narrationJson, "json"],
  ]) {
    if (fs.existsSync(p)) job.artifacts.push({ name, path: p, kind });
  }

  pushStatus(job, "done");
  pushLog(job, "\n✅ Pipeline selesai.");
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".wav": "audio/wav",
  ".srt": "application/x-subrip; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(url.pathname);

  // --- CORS: frontend editor (tscaps-web di localhost:5173) -----------------
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- API: upload video ----------------------------------------------------
  if (pathname === "/api/upload" && req.method === "POST") {
    const name = path.basename(url.searchParams.get("name") || "upload.mp4");
    const dest = path.join(UPLOAD_DIR, name);
    try {
      const w = fs.createWriteStream(dest);
      req.pipe(w);
      await new Promise((resolve, reject) => {
        w.on("finish", resolve);
        w.on("error", reject);
        req.on("error", reject);
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, videoPath: dest, name }));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // --- API: jalankan pipeline -----------------------------------------------
  if (pathname === "/api/run" && req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;
    let input;
    try { input = JSON.parse(body); } catch { input = {}; }
    const videoPath = input.videoPath;
    if (!videoPath || !fs.existsSync(videoPath)) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "videoPath tidak valid" }));
      return;
    }
    // Concurrency guard: hanya satu job aktif sekaligus (host RAM/VRAM terbatas)
    const activeJob = [...jobs.values()].find((j) => j.status === "running");
    if (activeJob) {
      res.writeHead(409, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: `Job #${activeJob.id} masih berjalan. Tunggu selesai atau batalkan dulu.` }));
      return;
    }
    const job = createJob();
    await fsp.mkdir(job.dir, { recursive: true });
    const sanitized = {
      videoPath,
      model: input.model || "gemini/gemini-3.6-flash",
      chunk: input.chunk !== undefined ? Number(input.chunk) : undefined, // 0 = tanpa chunk (full video)
      stretch: input.stretch !== undefined ? Number(input.stretch) : undefined,
      hzoom: input.hzoom !== undefined ? Number(input.hzoom) : undefined,
      cameraPlan: !!input.cameraPlan,
      caption: input.caption !== false,
      template: typeof input.template === "string" ? input.template : "loki",
      lead: input.lead !== undefined ? Number(input.lead) : 5,
      tail: input.tail !== undefined ? Number(input.tail) : 5,
    };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, jobId: job.id }));
    runPipeline(job, sanitized).catch((e) => {
      if (job.status !== "cancelled") {
        job.error = e.message;
        pushLog(job, `\n❌ Pipeline error: ${e.message}`, "err");
        pushStatus(job, "error");
      }
    });
    return;
  }

  // --- API: batalkan job --------------------------------------------------------
  const cancelMatch = pathname.match(/^\/api\/jobs\/([\w-]+)\/cancel$/);
  if (cancelMatch && req.method === "POST") {
    const job = jobs.get(cancelMatch[1]);
    if (!job) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "job not found" }));
      return;
    }
    if (job.status === "running" && job._proc) {
      try { job._proc.kill(); } catch {}
    }
    job.status = "cancelled";
    job.finishedAt = new Date().toISOString();
    pushLog(job, "\n⛔ Job dibatalkan oleh user.", "warn");
    pushStatus(job, "cancelled");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // --- API: daftar template tscaps ----------------------------------------------
  if (pathname === "/api/templates" && req.method === "GET") {
    try {
      const tplDir = path.join(CFG.tscapsExamples, "..", "..", "..", "templates");
      const entries = await fsp.readdir(tplDir, { withFileTypes: true });
      const templates = [];
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith("_")) continue;
        const tplJsonPath = path.join(tplDir, e.name, "template.json");
        if (!fs.existsSync(tplJsonPath)) continue;
        try {
          const meta = JSON.parse(await fsp.readFile(tplJsonPath, "utf8"));
          const colors = (meta.styleControls || [])
            .filter((c) => c.type === "color" && c.default)
            .map((c) => c.default);
          const swatch = colors.length >= 2
            ? `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`
            : colors[0] || "#888";
          // kirim css + config untuk preview asli di browser
          const cssPath = path.join(tplDir, e.name, "style.css");
          const css = fs.existsSync(cssPath) ? await fsp.readFile(cssPath, "utf8") : "";
          templates.push({ id: e.name, name: meta.name || e.name, swatch, css, json: meta });
        } catch {}
      }
      templates.sort((a, b) => a.id.localeCompare(b.id));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, templates }));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: String(e) }));
    }
    return;
  }

  // --- API: status job --------------------------------------------------------
  const jobMatch = pathname.match(/^\/api\/jobs\/([\w-]+)$/);
  if (jobMatch) {
    const job = jobs.get(jobMatch[1]);
    if (!job) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "job not found" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      job: {
        id: job.id,
        status: job.status,
        stage: job.stage,
        error: job.error,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt,
        artifacts: job.artifacts,
      },
    }));
    return;
  }

  // --- API: daftar jobs --------------------------------------------------------
  if (pathname === "/api/jobs" && req.method === "GET") {
    const list = [...jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20)
      .map((j) => ({
        id: j.id,
        status: j.status,
        stage: j.stage,
        createdAt: j.createdAt,
        finishedAt: j.finishedAt,
        artifacts: j.artifacts.map((a) => a.name),
      }));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, jobs: list }));
    return;
  }

  // --- API: log job ------------------------------------------------------------
  const logMatch = pathname.match(/^\/api\/jobs\/([\w-]+)\/log$/);
  if (logMatch) {
    const job = jobs.get(logMatch[1]);
    if (!job) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, log: job.log }));
    return;
  }

  // --- API: serve artifact --------------------------------------------------------
  const fileMatch = pathname.match(/^\/files\/([\w-]+)\/([^/]+)$/);
  if (fileMatch) {
    const [, jobId, fileName] = fileMatch;
    const job = jobs.get(jobId);
    const safeName = path.basename(fileName);
    const candidate = job
      ? job.artifacts.find((a) => a.name === safeName)
      : null;
    if (!candidate) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "artifact not found" }));
      return;
    }
    const ext = path.extname(safeName).toLowerCase();
    const stat = fs.statSync(candidate.path);
    const size = stat.size;
    // Dukungan Range (seek video besar) — single range saja, cukup untuk <video>
    const rangeHeader = req.headers.range;
    if (rangeHeader) {
      const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      let start = m && m[1] ? parseInt(m[1], 10) : 0;
      let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
      if (isNaN(start) || start < 0) start = 0;
      if (isNaN(end) || end >= size) end = size - 1;
      if (start > end) {
        res.writeHead(416, { "content-range": `bytes */${size}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        "content-type": MIME[ext] || "application/octet-stream",
        "content-length": end - start + 1,
        "content-range": `bytes ${start}-${end}/${size}`,
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      });
      fs.createReadStream(candidate.path, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, {
      "content-type": MIME[ext] || "application/octet-stream",
      "content-length": size,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    });
    fs.createReadStream(candidate.path).pipe(res);
    return;
  }

  // --- Static frontend ------------------------------------------------------------
  if (pathname === "/") {
    const p = path.join(PUBLIC_DIR, "index.html");
    res.writeHead(200, { "content-type": MIME[".html"] });
    fs.createReadStream(p).pipe(res);
    return;
  }
  // Path traversal guard: pastikan path tetap di dalam PUBLIC_DIR
  // (URL constructor menormalisasi ../ tapi %5c -> backslash Windows bisa lolos)
  const staticPath = path.join(PUBLIC_DIR, pathname.replace(/^\/+/, ""));
  const resolvedStatic = path.resolve(staticPath);
  if (resolvedStatic.startsWith(PUBLIC_DIR + path.sep) && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    const ext = path.extname(staticPath).toLowerCase();
    res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(staticPath).pipe(res);
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: "not found" }));
});

// Upgrade HTTP -> WebSocket
server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const jobId = url.searchParams.get("job");
  if (!jobId) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => subscribe(jobId, ws));
});

const PORT = process.env.PORT || 3131;
server.listen(PORT, () => {
  console.log(`🎬 MOVIE2SHORT Studio UI`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   Public : ${PUBLIC_DIR}`);
  console.log(`   Jobs   : ${JOBS_DIR}`);
});

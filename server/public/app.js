/* ============================================================
   MOVIE2SHORT Studio — frontend logic (vanilla JS, no build)
   ============================================================ */
"use strict";

const $ = (sel) => document.querySelector(sel);

const el = {
  status: $("#server-status"),
  dropzone: $("#dropzone"),
  videoInput: $("#video-input"),
  dzInner: $("#dz-inner"),
  dzFile: $("#dz-file"),
  dzFileName: $("#dz-file-name"),
  dzFileMeta: $("#dz-file-meta"),
  dzRemove: $("#dz-remove"),
  model: $("#model"),
  stretch: $("#stretch"),
  stretchVal: $("#stretch-val"),
  hzoom: $("#hzoom"),
  hzoomVal: $("#hzoom-val"),
  cameraPlan: $("#camera-plan"),
  caption: $("#caption"),
  template: $("#template"),
  btnRun: $("#btn-run"),
  btnRunText: $("#btn-run-text"),
  resultActions: $("#result-actions"),
  resultVideo: $("#result-video"),
  videoPreview: $("#video-input-preview"),
  previewInput: $("#preview-input"),
  previewOutput: $("#preview-output"),
  gallery: $("#gallery"),
  consoleEl: $("#console"),
  btnClearLog: $("#btn-clear-log"),
};

let selectedFile = null;
let selectedName = null;
let uploadedPath = null;
let activeJobId = null;
let ws = null;
let pollTimer = null;
let selectedTemplate = "loki";

/* ---------------- Server status ---------------- */
async function checkServer() {
  try {
    const r = await fetch("/api/jobs");
    if (r.ok) {
      el.status.classList.add("online");
      el.status.classList.remove("offline");
      el.status.innerHTML = `<span class="dot"></span> Server online`;
    }
  } catch {
    el.status.classList.add("offline");
    el.status.classList.remove("online");
    el.status.innerHTML = `<span class="dot"></span> Server offline`;
  }
}
checkServer();
setInterval(checkServer, 15000);

/* ---------------- Console log ---------------- */
function logLine(text, level = "out") {
  const div = document.createElement("div");
  div.className = `line ${level}`;
  div.textContent = text;
  el.consoleEl.appendChild(div);
  el.consoleEl.scrollTop = el.consoleEl.scrollHeight;
}

function logSys(text) { logLine(text, "sys"); }
function logInfo(text) { logLine(text, "info"); }

el.btnClearLog.addEventListener("click", () => { el.consoleEl.innerHTML = ""; });

/* ---------------- Dropzone / upload ---------------- */
/* ---------------- Gallery template ---------------- */
async function loadTemplates() {
  try {
    const r = await fetch("/api/templates");
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);
    const templates = data.templates;
    el.gallery.innerHTML = "";
    // isi dropdown juga
    el.template.innerHTML = templates
      .map((t) => `<option value="${t.id}">${t.name}</option>`)
      .join("");
    el.template.value = selectedTemplate;
    for (const t of templates) {
      const item = document.createElement("div");
      item.className = "gallery-item" + (t.id === selectedTemplate ? " selected" : "");
      item.dataset.id = t.id;
      item.innerHTML =
        `<div class="gallery-preview" data-tpl="${t.id}"></div>` +
        `<div class="gallery-name">${t.name}</div>`;
      item.addEventListener("click", () => selectTemplate(t.id));
      el.gallery.appendChild(item);
      renderTemplatePreview(item.querySelector(".gallery-preview"), t);
    }
  } catch (e) {
    logSys(`⚠ Template gallery gagal dimuat: ${e.message}`);
  }
}

/* Render preview asli: shadow DOM + style.css template + vars dari template.json */
function renderTemplatePreview(host, t) {
  const tpl = t.json || {};
  const typo = tpl.typography || {};
  const vars = {
    "--tscaps-font-family": `'${typo.fontFamily ?? "sans-serif"}'`,
    "--tscaps-font-size": "20px", // ukuran tetap agar terlihat di card kecil
    "--tscaps-font-weight": String(typo.fontWeight ?? 400),
    "--tscaps-letter-spacing": `${typo.letterSpacing ?? 0}em`,
    "--tscaps-word-spacing": `${typo.wordSpacing ?? 0.1}em`,
    "--tscaps-line-spacing": `${typo.lineSpacing ?? 0.1}em`,
    "--tscaps-text-transform": typo.textCase ?? "none",
    "--tscaps-text-align": typo.textAlign ?? "center",
    "--tscaps-font-style": typo.italic ? "italic" : "normal",
    // variabel animasi: buat state "sedang dinarasikan" aktif langsung
    "--on-segment-starts": "0s",
    "--on-line-being-narrated-starts": "0s",
    "--on-word-being-narrated-starts": "0s",
    "--word-being-narrated-duration": "2s",
  };
  for (const c of tpl.styleControls || []) {
    if (c.default === undefined || c.default === null) continue;
    const key = `--tscaps-${c.id}`;
    if (c.type === "color") vars[key] = String(c.default);
    else if (c.type === "float" || c.type === "integer") vars[key] = c.unit ? `${c.default}${c.unit}` : String(c.default);
    else if (c.type === "toggle") vars[key] = c.default ? (c.valueOn ?? "1") : (c.valueOff ?? "0");
    else vars[key] = String(c.default);
  }
  const varCss = Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join("\n");
  const align = tpl.alignment || {};
  const vAlign = align.verticalAlign === "top" ? "flex-start" : align.verticalAlign === "bottom" ? "flex-end" : "center";
  const hAlign = align.horizontalAlign === "left" ? "flex-start" : align.horizontalAlign === "right" ? "flex-end" : "center";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { display: block; }
      .preview {
        position: absolute; inset: 0;
        display: flex;
        align-items: ${vAlign};
        justify-content: ${hAlign};
        padding: 6px;
        overflow: hidden;
      }
      .preview-inner {
        ${varCss}
        width: 100%;
      }
      ${t.css || ""}
    </style>
    <div class="preview"><div class="preview-inner">
      <div class="segment">
        <div class="line">
          <span class="word word-being-narrated">Caption</span>
          <span class="word">nyala</span>
        </div>
      </div>
    </div></div>`;
}

function selectTemplate(id) {
  selectedTemplate = id;
  el.template.value = id;
  for (const item of el.gallery.querySelectorAll(".gallery-item")) {
    item.classList.toggle("selected", item.dataset.id === id);
  }
  logSys(`Template caption: ${id}`);
}

el.template.addEventListener("change", () => selectTemplate(el.template.value));

el.dropzone.addEventListener("click", () => el.videoInput.click());
el.dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  el.dropzone.classList.add("drag");
});
el.dropzone.addEventListener("dragleave", () => el.dropzone.classList.remove("drag"));
el.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  el.dropzone.classList.remove("drag");
  const file = e.dataTransfer.files?.[0];
  if (file) selectFile(file);
});
el.videoInput.addEventListener("change", () => {
  if (el.videoInput.files?.[0]) selectFile(el.videoInput.files[0]);
});
el.dzRemove.addEventListener("click", (e) => {
  e.stopPropagation();
  selectedFile = null;
  uploadedPath = null;
  el.dzInner.classList.remove("hidden");
  el.dzFile.classList.add("hidden");
  el.btnRun.disabled = true;
});

function selectFile(file) {
  selectedFile = file;
  el.dzInner.classList.add("hidden");
  el.dzFile.classList.remove("hidden");
  el.dzFileName.textContent = file.name;
  el.dzFileMeta.textContent = (file.size / 1024 / 1024).toFixed(1) + " MB";
  // Preview input: objectURL lokal, tanpa upload
  const url = URL.createObjectURL(file);
  el.videoPreview.src = url;
  el.videoPreview.hidden = false;
  el.previewInput.querySelector(".preview-empty")?.remove();
  logSys(`Video dipilih: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`);
  el.btnRun.disabled = false;
  el.btnRunText.textContent = "Upload & Generate";
}

async function uploadVideo() {
  if (!selectedFile) throw new Error("Pilih video dulu");
  logInfo(`Uploading ${selectedFile.name}…`);
  el.btnRunText.textContent = "Uploading…";
  const safeName = selectedFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const res = await fetch(`/api/upload?name=${encodeURIComponent(safeName)}`, {
    method: "POST",
    body: selectedFile,
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Upload gagal");
  uploadedPath = data.videoPath;
  logInfo(`Upload selesai: ${uploadedPath}`);
  return data;
}

/* ---------------- Sliders ---------------- */
function bindSlider(input, output, fmt) {
  const update = () => { output.textContent = fmt(input.value); };
  input.addEventListener("input", update);
  update();
}
bindSlider(el.stretch, el.stretchVal, (v) => Number(v).toFixed(2));
bindSlider(el.hzoom, el.hzoomVal, (v) => Number(v).toFixed(2));

/* ---------------- WebSocket ---------------- */
function connectWS(jobId) {
  return new Promise((resolve) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const wsUrl = `${proto}://${location.host}/ws?job=${jobId}`;
    ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve();
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type === "log") {
        logLine(msg.entry.line, msg.entry.level);
      } else if (msg.type === "status") {
        handleStatus(msg);
      }
    };
    ws.onclose = () => { ws = null; };
    ws.onerror = () => resolve();
  });
}

function setRunningUI() {
  el.btnRun.disabled = true;
  el.btnRunText.textContent = "Memproses…";
  startPolling();
}

function setIdleUI() {
  el.btnRun.disabled = false;
  el.btnRunText.textContent = "Mulai Generate";
  stopPolling();
}

function handleStatus(msg) {
  if (msg.status === "running") {
    setRunningUI();
  } else if (msg.status === "done") {
    setIdleUI();
    loadResult();
    logSys("✅ Pipeline selesai!");
  } else if (msg.status === "error") {
    setIdleUI();
    el.btnRunText.textContent = "Coba Lagi";
    logSys("❌ Pipeline gagal — lihat log di atas.");
  } else if (msg.status === "cancelled") {
    setIdleUI();
    logSys("⛔ Job dibatalkan.");
  }
}

/* Polling fallback — aman jika WebSocket turun */
function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    if (!activeJobId) return;
    try {
      const r = await fetch(`/api/jobs/${activeJobId}`);
      const data = await r.json();
      if (!data.ok) return;
      const status = data.job.status;
      if (status === "done" || status === "error" || status === "cancelled") {
        handleStatus({ status });
      }
    } catch {}
  }, 5000);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/* ---------------- Run ---------------- */
el.btnRun.addEventListener("click", async () => {
  if (el.btnRun.disabled) return;
  try {
    el.consoleEl.innerHTML = "";

    if (!uploadedPath) await uploadVideo();
    if (!uploadedPath) throw new Error("Upload gagal");

    const payload = {
      videoPath: uploadedPath,
      model: el.model.value,
      stretch: Number(el.stretch.value),
      hzoom: Number(el.hzoom.value),
      cameraPlan: el.cameraPlan.checked,
      caption: el.caption.checked,
      template: selectedTemplate,
    };
    logSys(`Mengirim job: model=${payload.model} stretch=${payload.stretch} hzoom=${payload.hzoom} cameraPlan=${payload.cameraPlan} caption=${payload.caption} template=${payload.template}`);
    el.btnRun.disabled = true;
    el.btnRunText.textContent = "Mengirim…";

    const res = await fetch("/api/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Gagal start job");
    activeJobId = data.jobId;
    logSys(`Job #${activeJobId} dibuat.`);
    el.btnRun.disabled = true;
    el.btnRunText.textContent = "Memproses…";
    await connectWS(activeJobId);
  } catch (e) {
    logSys(`❌ ${e.message}`);
    el.btnRun.disabled = false;
    el.btnRunText.textContent = "Coba Lagi";
  }
});

/* ---------------- Cancel ---------------- */
el.btnRun.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  if (activeJobId && el.btnRun.disabled && el.btnRunText.textContent === "Memproses…") cancelJob();
});

async function cancelJob() {
  try {
    const res = await fetch(`/api/jobs/${activeJobId}/cancel`, { method: "POST" });
    const data = await res.json();
    if (data.ok) logSys("⛔ Permintaan pembatalan terkirim.");
  } catch (e) {
    logSys(`❌ Gagal membatalkan: ${e.message}`);
  }
}

/* ---------------- Result ---------------- */
async function loadResult() {
  if (!activeJobId) return;
  const res = await fetch(`/api/jobs/${activeJobId}`);
  const data = await res.json();
  if (!data.ok) return;
  const job = data.job;
  const videoArtifact =
    job.artifacts.find((a) => a.name.includes("captioned")) ||
    job.artifacts.find((a) => a.name === "final_short.mp4");
  if (!videoArtifact) return;

  const videoUrl = `/files/${job.id}/${encodeURIComponent(videoArtifact.name)}`;
  el.resultVideo.src = videoUrl;
  el.resultVideo.hidden = false;
  el.previewOutput.querySelector(".preview-empty")?.remove();

  el.resultActions.innerHTML = "";
  const dl = document.createElement("a");
  dl.href = videoUrl;
  dl.download = videoArtifact.name;
  dl.textContent = "Download";
  el.resultActions.appendChild(dl);

  const srt = job.artifacts.find((a) => a.name.endsWith(".srt"));
  if (srt) {
    const dlSrt = document.createElement("a");
    dlSrt.href = `/files/${job.id}/${encodeURIComponent(srt.name)}`;
    dlSrt.download = srt.name;
    dlSrt.textContent = "SRT";
    el.resultActions.appendChild(dlSrt);
  }
  const mani = job.artifacts.find((a) => a.name === "manifest.json");
  if (mani) {
    const dlM = document.createElement("a");
    dlM.href = `/files/${job.id}/manifest.json`;
    dlM.download = "manifest.json";
    dlM.textContent = "Manifest";
    el.resultActions.appendChild(dlM);
  }
}

/* ---------------- Init ---------------- */
logSys("Movie2Short Studio siap. Pilih video lalu klik Mulai Generate.");
logSys("Tip: klik kanan tombol saat memproses untuk membatalkan job.");
loadTemplates();

/**
 * SQLite database for movie2short job persistence.
 *
 * Uses sql.js (pure JS/WASM SQLite) — no native compilation needed.
 * Data is kept in memory and periodically flushed to disk.
 *
 * Schema:
 *   jobs          – one row per pipeline run
 *   job_artifacts – files produced (video, srt, json, …)
 *   job_logs      – timestamped log lines
 *   scenes        – per-scene data extracted during analysis
 */
import initSqlJs from "sql.js";
import path from "node:path";
import fs from "node:fs";

let _db;
let _dbPath;
let _dirty = false;
let _flushTimer = null;

/**
 * Open (or create) the database. Async init required for WASM loading.
 * @param {string} dir  Directory that will contain movie2short.db
 */
export async function initDb(dir) {
  fs.mkdirSync(dir, { recursive: true });
  _dbPath = path.join(dir, "movie2short.db");
  const SQL = await initSqlJs();
  // Load existing DB or create new
  if (fs.existsSync(_dbPath)) {
    const buf = fs.readFileSync(_dbPath);
    _db = new SQL.Database(buf);
  } else {
    _db = new SQL.Database();
  }
  _db.run("PRAGMA journal_mode = WAL");
  _db.run("PRAGMA foreign_keys = ON");
  migrate();
  // Flush to disk every 5 seconds if dirty
  _flushTimer = setInterval(() => { if (_dirty) flush(); }, 5000);
  return _db;
}

/** Return the active db instance (must call initDb first). */
export function getDb() {
  if (!_db) throw new Error("db not initialised – call initDb() first");
  return _db;
}

/** Force flush to disk. */
export function flush() {
  if (!_db || !_dbPath || !_dirty) return;
  const data = _db.export();
  fs.writeFileSync(_dbPath, Buffer.from(data));
  _dirty = false;
}

// ── schema ──────────────────────────────────────────────────────────────────

function migrate() {
  const db = getDb();
  db.run(`
    CREATE TABLE IF NOT EXISTS jobs (
      id            TEXT PRIMARY KEY,
      dir           TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'queued',
      stage         TEXT,
      error         TEXT,
      video_path    TEXT,
      config_json   TEXT,
      created_at    TEXT NOT NULL,
      finished_at   TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS job_artifacts (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id    TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      name      TEXT NOT NULL,
      file_path TEXT NOT NULL,
      kind      TEXT NOT NULL DEFAULT 'video'
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS job_logs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id    TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      t         TEXT NOT NULL,
      level     TEXT NOT NULL DEFAULT 'info',
      line      TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS scenes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id          TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      scene_id        TEXT NOT NULL,
      start_sec       REAL NOT NULL,
      end_sec         REAL NOT NULL,
      description     TEXT,
      narration_text  TEXT,
      subject_x_pct   REAL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_jobs_status    ON jobs(status)");
  db.run("CREATE INDEX IF NOT EXISTS idx_jobs_created   ON jobs(created_at DESC)");
  db.run("CREATE INDEX IF NOT EXISTS idx_artifacts_job  ON job_artifacts(job_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_logs_job       ON job_logs(job_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_scenes_job     ON scenes(job_id)");
}

// ── query helpers ───────────────────────────────────────────────────────────

/** Run a query and return all rows as objects. */
function all(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

/** Run a query and return first row as object, or null. */
function one(sql, params = []) {
  const db = getDb();
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  let row = null;
  if (stmt.step()) row = stmt.getAsObject();
  stmt.free();
  return row;
}

/** Run a write statement and mark dirty. */
function run(sql, params = []) {
  const db = getDb();
  const safe = params.map((p) => (p === undefined ? null : p));
  db.run(sql, safe);
  _dirty = true;
}

// ── mapped helpers ──────────────────────────────────────────────────────────

function _mapJob(row) {
  return {
    id: row.id,
    dir: row.dir,
    status: row.status,
    stage: row.stage,
    error: row.error,
    videoPath: row.video_path,
    config: row.config_json ? JSON.parse(row.config_json) : null,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

/** Insert a new job. Returns the job row. */
export function insertJob({ id, dir, status, videoPath, config, createdAt }) {
  run(
    `INSERT INTO jobs (id, dir, status, video_path, config_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, dir, status ?? "queued", videoPath ?? null, config ? JSON.stringify(config) : null, createdAt],
  );
  return getJob(id);
}

/** Update job fields (partial). Pass only keys to set. */
export function updateJob(id, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    const col = {
      status: "status", stage: "stage", error: "error",
      finishedAt: "finished_at", dir: "dir",
    }[k];
    if (!col) continue;
    sets.push(`${col} = ?`);
    vals.push(v);
  }
  if (sets.length === 0) return;
  vals.push(id);
  run(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`, vals);
}

/** Get a single job (without logs/artifacts). */
export function getJob(id) {
  const row = one("SELECT * FROM jobs WHERE id = ?", [id]);
  return row ? _mapJob(row) : null;
}

/** List latest N jobs (summary only, no logs). */
export function listJobs(limit = 20) {
  return all("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", [limit]).map(_mapJob);
}

/** Get job logs. */
export function getJobLogs(id) {
  return all("SELECT t, level, line FROM job_logs WHERE job_id = ? ORDER BY id", [id]);
}

/** Get job artifacts. */
export function getJobArtifacts(id) {
  return all("SELECT name, file_path AS path, kind FROM job_artifacts WHERE job_id = ?", [id]);
}

/** Append a log line. */
export function appendLog(jobId, { t, level, line }) {
  run("INSERT INTO job_logs (job_id, t, level, line) VALUES (?, ?, ?, ?)", [jobId, t, level ?? "info", line]);
}

/** Add an artifact. */
export function addArtifact(jobId, { name, path: filePath, kind }) {
  run("INSERT INTO job_artifacts (job_id, name, file_path, kind) VALUES (?, ?, ?, ?)", [jobId, name, filePath, kind ?? "video"]);
}

/** Add scenes (bulk). */
export function addScenes(jobId, scenes) {
  const db = getDb();
  db.run("BEGIN TRANSACTION");
  try {
    for (const s of scenes) {
      run(
        "INSERT INTO scenes (job_id, scene_id, start_sec, end_sec, description, narration_text, subject_x_pct) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [jobId, s.id, s.start_sec, s.end_sec, s.description ?? null, s.narration_text ?? null, s.subject_x_pct ?? null],
      );
    }
    db.run("COMMIT");
  } catch (e) {
    db.run("ROLLBACK");
    throw e;
  }
}

/** Get scenes for a job. */
export function getScenes(jobId) {
  return all("SELECT * FROM scenes WHERE job_id = ? ORDER BY id", [jobId]);
}

/** Delete a job and cascade. */
export function deleteJob(id) {
  run("DELETE FROM jobs WHERE id = ?", [id]);
  flush();
}

/** Close the database — flush to disk first. */
export function closeDb() {
  if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null; }
  flush();
  if (_db) { _db.close(); _db = null; }
}

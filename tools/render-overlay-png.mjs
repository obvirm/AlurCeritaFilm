#!/usr/bin/env node
/**
 * Screenshot satu halaman overlay 1080x1920 transparan -> PNG.
 * Dipakai pipeline movie2short untuk overlay HTML+CSS full-custom.
 *
 * Usage:
 *   node tools/render-overlay-png.mjs --html <overlay.html> --output <overlay.png>
 *     --chrome <chrome.exe> [--width 1080 --height 1920]
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--") && i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      args[a.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const r of ["html", "output"]) {
    if (!args[r]) throw new Error(`Argumen wajib hilang: --${r}`);
  }
  const htmlPath = path.resolve(args.html);
  const outPath = path.resolve(args.output);
  if (!fs.existsSync(htmlPath)) throw new Error(`HTML tidak ada: ${htmlPath}`);
  const width = Number(args.width || 1080);
  const height = Number(args.height || 1920);
  const chrome = args.chrome || process.env.TSCAPS_CHROME_PATH;
  if (!chrome || !fs.existsSync(chrome)) {
    throw new Error(`Chrome tidak ditemukan: ${chrome || "(kosong)"}`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on("pageerror", (e) => console.error(`[overlay page error] ${e.message}`));
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: outPath, omitBackground: true });
    console.log(`[overlay] PNG: ${outPath}`);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(`[overlay] FAILED: ${e.message}`);
  process.exitCode = 1;
});

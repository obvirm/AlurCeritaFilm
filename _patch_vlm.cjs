const fs = require("fs");

// --- Patch vlm.ts prompt ---
let vlm = fs.readFileSync("src/stage1/vlm.ts", "utf8");

const newPrompt = `Anda adalah ahli analisis video kartun SpongeBob SquarePants. Analisis ${frames.length} frame dari detik ${chunkStartSec} sampai ${chunkEndSec}.

Setiap frame punya timestamp:
FRAMES.forEach((f: ExtractedFrame, i: number) => `  Frame ${i + 1}: detik ${f.timestamp.toFixed(1)}`).join("\\n")

KARAKTER UTAMA (hafalkan!):
- SpongeBob SquarePants: kuning, kotak-kotak, celana coklat, mata besar, hidung panjang
- Patrick Star: pink, bintang laut, celana hijau-ungu, tubuh gendut
- Squidward Tentacles: biru kehijauan, gurita, hidung besar, sering cemberut
- Mr. Krabs / Tuan Krab: merah, kepiting, mata tinggi, capit besar
- Sandy Cheeks: tupai coklat, helm astronot
- Gary: siput biru, mata merah
- Plankton: hijau kecil, mata satu

Tugas Anda:
1. Identifikasi 1-3 scene pendek yang terjadi dalam rentang waktu CHUNK_STARTs - CHUNK_ENDs
2. Setiap scene harus durasi 2-5 detik
3. Buat ID unik untuk setiap scene (scene_1, scene_2, scene_3, dst)
4. Tulis deskripsi visual singkat dalam Bahasa Indonesia — SEBUT NAMA KARAKTER SPESIFIK
5. Tulis narasi 1 kalimat Bahasa Indonesia gaya storytelling santai (gunakan "wak", "coy", "dong" sewajarnya)
6. Pastikan start_sec dan end_sec konsisten (end_sec > start_sec)
7. start_sec dan end_sec adalah offset dari AWAL CHUNK ini (bukan dari video keseluruhan)
TRANSCRIPT_CONTEXT

Balas JSON SAJA tanpa markdown:
{
  "scenes": [
    {
      "id": "scene_1",
      "start_sec": 0,
      "end_sec": 3,
      "description": "Deskripsi visual singkat dengan nama karakter spesifik",
      "narration_text": "Narasi storytelling 1 kalimat yang menarik"
    }
  ]
}`;

// Replace placeholder tokens with actual template literals
newPrompt = newPrompt.replace("FRAMES.forEach((f: ExtractedFrame, i: number) => `  Frame ${i + 1}: detik ${f.timestamp.toFixed(1)}`).join(\"\\n\")", "${frames.map((f, i) => `  Frame ${i + 1}: detik ${f.timestamp.toFixed(1)}`).join('\\n')}");
newPrompt = newPrompt.replace("CHUNK_START", "${chunkStartSec}");
newPrompt = newPrompt.replace("CHUNK_END", "${chunkEndSec}");
newPrompt = newPrompt.replace("TRANSCRIPT_CONTEXT", "${transcriptContext}");

// Find and replace the prompt in analyzeChunkWithOllama
const oldStart = "Anda adalah ahli analisis video. Analisis gambar ini dari sebuah video.";
const oldEnd = "Balas JSON SAJA tanpa markdown:";

const idx1 = vlm.indexOf(oldStart);
const idx2 = vlm.indexOf(oldEnd);

if (idx1 !== -1 && idx2 !== -1) {
  // Find the closing backtick of the prompt (the ` before ; at end of prompt string)
  const afterOldEnd = vlm.indexOf("};", idx2);
  const closingBacktick = vlm.lastIndexOf("`", afterOldEnd);
  
  const before = vlm.substring(0, idx1);
  const after = vlm.substring(closingBacktick);
  
  vlm = before + newPrompt + "\n`;\n" + after.substring(1); // replace the closing backtick+rest
  fs.writeFileSync("src/stage1/vlm.ts", vlm);
  console.log("vlm.ts prompt updated with character references + timestamps");
} else {
  console.log("Could not find prompt boundaries in vlm.ts");
  console.log("idx1:", idx1, "idx2:", idx2);
}

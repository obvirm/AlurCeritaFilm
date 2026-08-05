// Download GGUF via Node.js https
import https from "https";
import fs from "fs";

const url = "https://huggingface.co/Qwen/Qwen2.5-VL-7B-GGUF/resolve/main/qwen2.5-vl-7b-q4_k_m.gguf";
const dest = "E:/project/movie2short/qwen2.5-vl-7b.gguf";

console.log("Downloading Qwen2.5-VL-7B GGUF via Node.js...");
const file = fs.createWriteStream(dest);

https.get(url, { timeout: 1800000 }, (res) => {
    console.log("Status:", res.statusCode);
    if (res.statusCode === 302 || res.statusCode === 301) {
        console.log("Redirect to:", res.headers.location);
        https.get(res.headers.location, { timeout: 1800000 }, (res2) => {
            console.log("Status:", res2.statusCode);
            const total = parseInt(res2.headers["content-length"] || "0");
            let downloaded = 0;
            res2.on("data", (chunk) => {
                downloaded += chunk.length;
                if (downloaded % (1024*1024) < 1000) {
                    process.stdout.write(`\r  ${(downloaded/1024/1024).toFixed(0)}/${(total/1024/1024).toFixed(0)} MB`);
                }
            });
            res2.pipe(file);
            res2.on("end", () => {
                const stats = fs.statSync(dest);
                console.log(`\nDone! ${(stats.size/1024/1024/1024).toFixed(2)} GB`);
            });
        });
    } else {
        res.pipe(file);
        res.on("end", () => {
            const stats = fs.statSync(dest);
            console.log(`\nDone! ${(stats.size/1024/1024/1024).toFixed(2)} GB`);
        });
    }
}).on("error", (e) => console.log("Error:", e.message));

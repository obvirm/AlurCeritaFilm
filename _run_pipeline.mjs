import { synthesizeNarration } from "./src/stage2/narrationSynthesizer.js";
import { runAnalysisPipeline } from "./src/analyzer.js";
const result = await runAnalysisPipeline({
  videoPath: "data/input/getvid.mp4",
  outputDir: "data/output/getvid_v9",
  ollamaModel: "gemma4:12b"
});
console.log("Pipeline done:", result);

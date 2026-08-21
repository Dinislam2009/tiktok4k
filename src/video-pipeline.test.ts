import { spawn } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { analyzeVideo } from "./video/analyzer.js";
import { FFmpegRenderer } from "./video/ffmpeg.js";
import { createOptimizationPlan, validateOptimizationInput } from "./video/optimization.js";

const ROOT = process.cwd();
const BIN_DIR = path.join(ROOT, "binaries", "ffmpeg");
const FFMPEG = process.env.FFMPEG_BIN ?? path.join(BIN_DIR, process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
const FFPROBE = process.env.FFPROBE_BIN ?? path.join(BIN_DIR, process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
const TMP = path.join(ROOT, "temp", "video-pipeline-test");
const INPUT = path.join(TMP, "input.mp4");
const OUTPUT = path.join(TMP, "output.mp4");
const LOW_FPS = path.join(TMP, "low-fps.mp4");

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}: ${stderr.slice(-4000)}`));
    });
  });
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main() {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });

  console.log("[1/5] Generate 1080p60 source video with audio...");
  await run(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=60",
    "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000",
    "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-crf", "28",
    "-c:a", "aac", "-b:a", "128k", "-shortest", INPUT,
  ]);

  console.log("[2/5] Analyze source and validate optimization plan...");
  const source = await analyzeVideo(INPUT);
  assert(source.width === 1920 && source.height === 1080, `unexpected source resolution ${source.width}x${source.height}`);
  assert(source.fps >= 59.9 && source.fps <= 60.1, `unexpected source FPS ${source.fps}`);
  assert(source.audioCodec === "aac", `expected AAC audio, got ${source.audioCodec}`);
  validateOptimizationInput(source);
  const plan = createOptimizationPlan(source, { target: "tiktok", quality: "balanced", framing: "fit", codec: "libx264" });
  assert(plan.actions.reencodeVideo, "balanced mode must re-encode video");
  assert(!plan.actions.crop && !plan.actions.pad && !plan.actions.scale, "source geometry must be preserved");

  console.log("[3/5] Render through FFmpegRenderer...");
  const renderer = new FFmpegRenderer();
  let sawProgress = false;
  await renderer.render({ inputPath: INPUT, outputPath: OUTPUT, target: "tiktok", quality: "balanced", framing: "fit", codec: "libx264", preset: "ultrafast" }, (progress) => {
    if (progress.percent > 0) sawProgress = true;
  });
  assert(sawProgress, "renderer did not emit progress");

  console.log("[4/5] Validate rendered output metadata...");
  const output = await analyzeVideo(OUTPUT);
  const outputStat = await stat(OUTPUT);
  assert(outputStat.size > 0, "output file is empty");
  assert(output.container.includes("mp4"), `unexpected container ${output.container}`);
  assert(output.videoCodec === "h264", `expected h264 output, got ${output.videoCodec}`);
  assert(output.pixelFormat === "yuv420p", `expected yuv420p output, got ${output.pixelFormat}`);
  assert(output.audioCodec === "aac", `expected AAC output, got ${output.audioCodec}`);
  assert(Math.abs(output.fps - source.fps) <= 0.1, `FPS changed from ${source.fps} to ${output.fps}`);
  assert(Math.abs(output.duration - source.duration) <= 0.15, `duration changed from ${source.duration} to ${output.duration}`);
  assert(output.width === source.width && output.height === source.height, `resolution changed from ${source.width}x${source.height} to ${output.width}x${output.height}`);

  console.log("[5/5] Verify low-FPS input is rejected...");
  await run(FFMPEG, [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30", "-t", "1",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", LOW_FPS,
  ]);
  const low = await analyzeVideo(LOW_FPS);
  let rejected = false;
  try { validateOptimizationInput(low); } catch { rejected = true; }
  assert(rejected, `30 FPS input was not rejected (detected ${low.fps})`);

  console.log("VIDEO PIPELINE TESTS: PASS");
  console.log(JSON.stringify({ source: { width: source.width, height: source.height, fps: source.fps, duration: source.duration }, output: { width: output.width, height: output.height, fps: output.fps, duration: output.duration, codec: output.videoCodec, audio: output.audioCodec, bytes: outputStat.size } }, null, 2));
  await rm(TMP, { recursive: true, force: true });
}

main().catch(async (error) => {
  console.error("VIDEO PIPELINE TESTS: FAIL");
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  await rm(TMP, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});

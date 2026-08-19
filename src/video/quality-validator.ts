import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { analyzeVideo } from "./analyzer.js";
import type { VideoMetadata } from "./types.js";

export interface QualityMetrics {
  ssim: number | null;
  psnr: number | null;
  vmaf: number | null;
  note: string;
}

export interface QualityValidation {
  source: VideoMetadata;
  output: VideoMetadata;
  changes: {
    width: number;
    height: number;
    fps: number;
    duration: number;
    fileSize: number;
    videoBitrate: number;
    audioBitrate: number | null;
  };
  metrics: QualityMetrics;
  warnings: string[];
  passed: boolean;
}

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;
const TARGET_FPS = 30;
const FPS_TOLERANCE = 0.1;
const DURATION_TOLERANCE = 0.15;

const MIN_SSIM = 0.99;
const MIN_PSNR_DB = 40;
const MIN_VMAF = 90.0;
const METRIC_TIMEOUT_MS = 240_000; // 4 минут терең талдау үшін

const NULL_DEVICE = process.platform === "win32" ? "NUL" : "/dev/null";

function getBinary(): string {
  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const executable = path.resolve(process.cwd(), "binaries", "ffmpeg", binaryName);
  if (!existsSync(executable)) throw new Error(`FFmpeg binary not found: ${executable}`);
  return executable;
}

function parseMetricValue(stderr: string, type: "SSIM" | "PSNR" | "VMAF"): number | null {
  let patterns: RegExp[] = [];

  if (type === "SSIM") {
    patterns = [/SSIM\s+[Yy]:[^\n]*?All:\s*([0-9.]+)/i, /All:\s*([0-9.]+)/i];
  } else if (type === "PSNR") {
    patterns = [/PSNR\s+[yY]:[^\n]*?average:\s*([0-9.]+)/i, /average:\s*([0-9.]+)/i];
  } else if (type === "VMAF") {
    patterns = [/VMAF\s+score:\s*([0-9.]+)/i, /vmaf[^\n]*?score:\s*([0-9.]+)/i, /mean:\s*([0-9.]+)/i];
  }

  for (const pattern of patterns) {
    const match = stderr.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }

  return null;
}

// SSIM & PSNR-ді 1 паста біріктіріп есептеу (уақытты 3 есе үнемдейді)
async function runSsimPsnrPass(
  sourcePath: string,
  outputPath: string
): Promise<{ ssim: number | null; psnr: number | null }> {
  const ffmpeg = getBinary();
  
  const filterComplex = [
    `[0:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${TARGET_WIDTH}:${TARGET_HEIGHT},setsar=1,fps=${TARGET_FPS},settb=1/${TARGET_FPS},setpts=PTS-STARTPTS[ref]`,
    `[1:v]fps=${TARGET_FPS},settb=1/${TARGET_FPS},setpts=PTS-STARTPTS[enc]`,
    `[ref]split=2[r1][r2]`,
    `[enc]split=2[e1][e2]`,
    `[r1][e1]ssim[s_out]`,
    `[r2][e2]psnr[p_out]`
  ].join(";");

  return await new Promise((resolve) => {
    const child = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        "-i", sourcePath,
        "-i", outputPath,
        "-filter_complex", filterComplex,
        "-map", "[s_out]",
        "-map", "[p_out]",
        "-an",
        "-f", "null",
        NULL_DEVICE,
      ],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }
    );

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 300000) stderr = stderr.slice(-300000);
    });

    const timeout = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ ssim: null, psnr: null });
    }, METRIC_TIMEOUT_MS);

    child.on("close", () => {
      clearTimeout(timeout);
      const ssim = parseMetricValue(stderr, "SSIM");
      const psnr = parseMetricValue(stderr, "PSNR");
      resolve({ ssim, psnr });
    });

    child.on("error", () => {
      clearTimeout(timeout);
      resolve({ ssim: null, psnr: null });
    });
  });
}

// VMAF есептеу (жеке пасс)
async function runVmafPass(
  sourcePath: string,
  outputPath: string
): Promise<number | null> {
  const ffmpeg = getBinary();
  
  const filterComplex = [
    `[0:v]scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${TARGET_WIDTH}:${TARGET_HEIGHT},setsar=1,fps=${TARGET_FPS},settb=1/${TARGET_FPS},setpts=PTS-STARTPTS[ref]`,
    `[1:v]fps=${TARGET_FPS},settb=1/${TARGET_FPS},setpts=PTS-STARTPTS[enc]`,
    `[ref][enc]libvmaf[out]`
  ].join(";");

  return await new Promise((resolve) => {
    const child = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        "-i", sourcePath,
        "-i", outputPath,
        "-filter_complex", filterComplex,
        "-map", "[out]",
        "-an",
        "-f", "null",
        NULL_DEVICE,
      ],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] }
    );

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 300000) stderr = stderr.slice(-300000);
    });

    const timeout = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve(null);
    }, METRIC_TIMEOUT_MS);

    child.on("close", () => {
      clearTimeout(timeout);
      const vmaf = parseMetricValue(stderr, "VMAF");
      resolve(vmaf);
    });

    child.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

async function measureQuality(sourcePath: string, outputPath: string): Promise<QualityMetrics> {
  console.log("⏳ [1/2] SSIM & PSNR есептелуде...");
  const { ssim, psnr } = await runSsimPsnrPass(sourcePath, outputPath);

  console.log("⏳ [2/2] VMAF есептелуде (бұл 1-2 минут алуы мүмкін)...");
  const vmaf = await runVmafPass(sourcePath, outputPath);

  const notes: string[] = [
    "Normalized both streams to 30 fps, 1/30 timebase, and matching 9:16 geometry before metric evaluation.",
  ];

  if (ssim !== null) notes.push(`SSIM: ${ssim.toFixed(6)}`);
  if (psnr !== null) notes.push(`PSNR: ${psnr.toFixed(3)} dB`);
  if (vmaf !== null) notes.push(`VMAF: ${vmaf.toFixed(2)}`);

  return { ssim, psnr, vmaf, note: notes.join(" ") };
}

export async function validateOutput(
  sourcePath: string,
  outputPath: string,
): Promise<QualityValidation> {
  const [source, output] = await Promise.all([
    analyzeVideo(sourcePath),
    analyzeVideo(outputPath),
  ]);

  const warnings: string[] = [];

  if (output.duration <= 0 || Math.abs(output.duration - source.duration) > DURATION_TOLERANCE) {
    warnings.push(`Duration changed unexpectedly: source ${source.duration.toFixed(3)}s, output ${output.duration.toFixed(3)}s.`);
  }

  if (output.width !== TARGET_WIDTH || output.height !== TARGET_HEIGHT) {
    warnings.push(`Unexpected output resolution: expected ${TARGET_WIDTH}x${TARGET_HEIGHT}, got ${output.width}x${output.height}.`);
  }

  if (Math.abs(output.fps - TARGET_FPS) > FPS_TOLERANCE) {
    warnings.push(`Unexpected output FPS: expected ${TARGET_FPS}, got ${output.fps}.`);
  }

  if (output.videoCodec !== "h264" && output.videoCodec !== "hevc") {
    warnings.push(`Unexpected output video codec: ${output.videoCodec}.`);
  }

  if (output.pixelFormat !== "yuv420p") {
    warnings.push(`Unexpected output pixel format: ${output.pixelFormat ?? "unknown"}.`);
  }

  if (output.audioCodec !== "aac") {
    warnings.push(`Unexpected output audio codec: ${output.audioCodec ?? "none"}.`);
  }

  if (source.audioCodec !== null && output.audioCodec === null) {
    warnings.push("Audio stream is missing from the output.");
  }

  if (output.width <= 0 || output.height <= 0) {
    warnings.push("Output resolution is invalid.");
  }

  const metrics = await measureQuality(sourcePath, outputPath);

  if (metrics.ssim === null) {
    warnings.push("SSIM metric could not be calculated (null).");
  } else if (metrics.ssim < MIN_SSIM) {
    warnings.push(`SSIM quality is below threshold: ${metrics.ssim.toFixed(6)} < ${MIN_SSIM}.`);
  }

  if (metrics.psnr === null) {
    warnings.push("PSNR metric could not be calculated (null).");
  } else if (metrics.psnr < MIN_PSNR_DB) {
    warnings.push(`PSNR quality is below threshold: ${metrics.psnr.toFixed(3)} dB < ${MIN_PSNR_DB} dB.`);
  }

  if (metrics.vmaf === null) {
    warnings.push("VMAF metric could not be calculated (null).");
  } else if (metrics.vmaf < MIN_VMAF) {
    warnings.push(`VMAF quality is below threshold: ${metrics.vmaf.toFixed(2)} < ${MIN_VMAF}.`);
  }

  return {
    source,
    output,
    changes: {
      width: output.width - source.width,
      height: output.height - source.height,
      fps: output.fps - source.fps,
      duration: output.duration - source.duration,
      fileSize: output.fileSize - source.fileSize,
      videoBitrate: output.bitrate - source.bitrate,
      audioBitrate:
        output.audioBitrate !== null && source.audioBitrate !== null
          ? output.audioBitrate - source.audioBitrate
          : null,
    },
    metrics,
    warnings,
    passed: warnings.length === 0,
  };
}
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

function getBinary(): string {
  const executable = path.resolve(process.cwd(), "binaries", "ffmpeg", "ffmpeg.exe");
  if (!existsSync(executable)) throw new Error(`FFmpeg binary not found: ${executable}`);
  return executable;
}

function parseMetric(stderr: string, name: "SSIM" | "PSNR"): number | null {
  const patterns = name === "SSIM"
    ? [
        /SSIM\s+Y:[^\n]*?All:\s*([0-9.]+)/i,
        /All:\s*([0-9.]+)/i,
      ]
    : [
        /PSNR\s+y:[^\n]*?average:\s*([0-9.]+)/i,
        /PSNR[^\n]*?average:\s*([0-9.]+)/i,
      ];

  for (const pattern of patterns) {
    const match = stderr.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }

  return null;
}

const cropFilter =
  `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${TARGET_WIDTH}:${TARGET_HEIGHT},setsar=1`;

function buildReferenceFilter(): string {
  return [
    `[0:v]${cropFilter},fps=${TARGET_FPS},settb=1/${TARGET_FPS},setpts=PTS-STARTPTS[reference]`,
    `[1:v]fps=${TARGET_FPS},settb=1/${TARGET_FPS},setpts=PTS-STARTPTS[encoded]`,
  ].join(";");
}

async function runMetric(
  sourcePath: string,
  outputPath: string,
  metric: "ssim" | "psnr",
): Promise<{ value: number | null; code: number | null }> {
  const ffmpeg = getBinary();
  const filter = `${buildReferenceFilter()};[reference][encoded]${metric}=stats_file=-`;

  return await new Promise((resolve) => {
    const child = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-nostdin",
        "-i", sourcePath,
        "-i", outputPath,
        "-filter_complex", filter,
        "-f", "null",
        "NUL",
      ],
      { windowsHide: true },
    );

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 300000) stderr = stderr.slice(-300000);
    });
    child.on("error", () => resolve({ value: null, code: null }));
    child.on("close", (code) => {
      resolve({
        value: parseMetric(stderr, metric === "ssim" ? "SSIM" : "PSNR"),
        code,
      });
    });
  });
}

async function measureQuality(sourcePath: string, outputPath: string): Promise<QualityMetrics> {
  // SSIM and PSNR are deterministic and available in the bundled FFmpeg.
  // Do not run libvmaf here: the Windows build may require an external model
  // and can make the quality command appear frozen.
  const ssimResult = await runMetric(sourcePath, outputPath, "ssim");
  const psnrResult = await runMetric(sourcePath, outputPath, "psnr");

  const successful: string[] = [];
  if (ssimResult.value !== null) successful.push(`SSIM ${ssimResult.value.toFixed(6)}`);
  if (psnrResult.value !== null) successful.push(`PSNR ${psnrResult.value.toFixed(3)} dB`);

  const failures: string[] = [];
  if (ssimResult.value === null) failures.push(`SSIM (exit ${ssimResult.code ?? "error"})`);
  if (psnrResult.value === null) failures.push(`PSNR (exit ${psnrResult.code ?? "error"})`);

  let note = "Metrics compare the encoded video against the source after applying the same 9:16 crop/scale transform, with both streams normalized to 30 fps and a 1/30 timebase.";
  if (successful.length > 0) note += ` ${successful.join("; ")}.`;
  if (failures.length > 0) note += ` Could not parse: ${failures.join(", ")}.`;
  note += " VMAF is disabled for this validator.";

  return {
    ssim: ssimResult.value,
    psnr: psnrResult.value,
    vmaf: null,
    note,
  };
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
    warnings.push(
      `Duration changed unexpectedly: source ${source.duration.toFixed(3)}s, output ${output.duration.toFixed(3)}s.`,
    );
  }

  if (output.width !== TARGET_WIDTH || output.height !== TARGET_HEIGHT) {
    warnings.push(
      `Unexpected output resolution: expected ${TARGET_WIDTH}x${TARGET_HEIGHT}, got ${output.width}x${output.height}.`,
    );
  }

  if (Math.abs(output.fps - TARGET_FPS) > FPS_TOLERANCE) {
    warnings.push(
      `Unexpected output FPS: expected ${TARGET_FPS}, got ${output.fps}.`,
    );
  }

  if (output.videoCodec !== "h264" && output.videoCodec !== "hevc") {
    warnings.push(`Unexpected output video codec: ${output.videoCodec}.`);
  }

  if (output.pixelFormat !== "yuv420p") {
    warnings.push(
      `Unexpected output pixel format: ${output.pixelFormat ?? "unknown"}.`,
    );
  }

  if (output.audioCodec !== "aac") {
    warnings.push(
      `Unexpected output audio codec: ${output.audioCodec ?? "none"}.`,
    );
  }

  if (source.audioCodec !== null && output.audioCodec === null) {
    warnings.push("Audio stream is missing from the output.");
  }

  if (output.width <= 0 || output.height <= 0) {
    warnings.push("Output resolution is invalid.");
  }

  const metrics = await measureQuality(sourcePath, outputPath);

  if (metrics.ssim === null) {
    warnings.push("SSIM could not be measured.");
  } else if (metrics.ssim < MIN_SSIM) {
    warnings.push(`SSIM quality is below the minimum threshold: ${metrics.ssim.toFixed(6)} < ${MIN_SSIM}.`);
  }

  if (metrics.psnr === null) {
    warnings.push("PSNR could not be measured.");
  } else if (metrics.psnr < MIN_PSNR_DB) {
    warnings.push(`PSNR quality is below the minimum threshold: ${metrics.psnr.toFixed(3)} dB < ${MIN_PSNR_DB} dB.`);
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

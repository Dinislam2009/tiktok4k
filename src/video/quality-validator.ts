import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { analyzeVideo } from "./analyzer.js";
import type { VideoMetadata } from "./types.js";

export interface QualityMetrics {
  ssim: number | null;
  psnr: number | null;
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

function getBinary(): string {
  const executable = path.resolve(process.cwd(), "binaries", "ffmpeg", "ffmpeg.exe");
  if (!existsSync(executable)) throw new Error(`FFmpeg binary not found: ${executable}`);
  return executable;
}

function parseMetric(stderr: string, name: "SSIM" | "PSNR"): number | null {
  const patterns = name === "SSIM"
    ? [
        /SSIM.*?All:\s*([0-9.]+)/i,
        /All:\s*([0-9.]+)/i,
      ]
    : [
        /PSNR.*?average:\s*([0-9.]+)/i,
        /PSNR average:\s*([0-9.]+)/i,
        /PSNR y:\s*([0-9.]+)/i,
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

async function measureQuality(sourcePath: string, outputPath: string): Promise<QualityMetrics> {
  const ffmpeg = getBinary();
  const cropFilter =
    "scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1";

  const filter =
    `[0:v]${cropFilter},setpts=PTS-STARTPTS[source];` +
    `[1:v]setpts=PTS-STARTPTS[encoded];` +
    `[source][encoded]ssim=stats_file=-[ssim];` +
    `[source][encoded]psnr=stats_file=-[psnr]`;

  return await new Promise<QualityMetrics>((resolve) => {
    const child = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-i", sourcePath,
        "-i", outputPath,
        "-filter_complex", filter,
        "-map", "[ssim]",
        "-map", "[psnr]",
        "-f", "null",
        "-",
      ],
      { windowsHide: true },
    );

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 200000) stderr = stderr.slice(-200000);
    });
    child.on("error", () => {
      resolve({ ssim: null, psnr: null, note: "Quality metrics could not be started." });
    });
    child.on("close", (code) => {
      const ssim = parseMetric(stderr, "SSIM");
      const psnr = parseMetric(stderr, "PSNR");

      if (ssim !== null && psnr !== null) {
        resolve({
          ssim,
          psnr,
          note: "Metrics compare the encoded video against the source after applying the same 9:16 crop/scale transform.",
        });
        return;
      }

      resolve({
        ssim,
        psnr,
        note: code === 0
          ? "FFmpeg completed, but its SSIM/PSNR log format was not recognized."
          : `FFmpeg quality comparison failed with exit code ${code}.`,
      });
    });
  });
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

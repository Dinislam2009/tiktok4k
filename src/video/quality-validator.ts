import path from "node:path";
import { existsSync } from "node:fs";
import { analyzeVideo } from "./analyzer.js";
import { calculateMetrics } from "./quality.js";
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

const FPS_TOLERANCE = 0.1;
const DURATION_TOLERANCE = 0.15;
const MIN_SSIM = 0.96;
const MIN_PSNR_DB = 36;
const MIN_VMAF = 90;

function getDisplayDimensions(metadata: Pick<VideoMetadata, "width" | "height" | "rotation">) {
  const normalizedRotation = ((metadata.rotation % 360) + 360) % 360;
  const quarterTurn = normalizedRotation === 90 || normalizedRotation === 270;
  return quarterTurn
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

function getFFmpegBinary(): string {
  const executableName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const executable = path.resolve(process.cwd(), "binaries", "ffmpeg", executableName);
  if (!existsSync(executable)) throw new Error(`FFmpeg binary not found: ${executable}`);
  return executable;
}

async function measureQuality(sourcePath: string, outputPath: string): Promise<QualityMetrics> {
  getFFmpegBinary();
  console.log("[quality] SSIM + PSNR + VMAF есептелуде...");

  try {
    const metrics = await calculateMetrics(sourcePath, outputPath);
    return {
      ssim: metrics.ssim,
      psnr: metrics.psnr,
      vmaf: metrics.vmaf,
      note: `FFmpeg нақты метрикаларды есептеді: SSIM ${metrics.ssim.toFixed(6)}, PSNR ${metrics.psnr.toFixed(3)} dB, VMAF ${metrics.vmaf.toFixed(2)}.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ssim: null, psnr: null, vmaf: null, note: `Quality measurement failed: ${message}` };
  }
}

export async function validateOutput(sourcePath: string, outputPath: string): Promise<QualityValidation> {
  const [source, output] = await Promise.all([analyzeVideo(sourcePath), analyzeVideo(outputPath)]);
  const warnings: string[] = [];
  const sourceDisplay = getDisplayDimensions(source);
  const outputDisplay = getDisplayDimensions(output);

  if (output.duration <= 0 || Math.abs(output.duration - source.duration) > DURATION_TOLERANCE) {
    warnings.push(`Duration changed unexpectedly: source ${source.duration.toFixed(3)}s, output ${output.duration.toFixed(3)}s.`);
  }

  if (outputDisplay.width !== sourceDisplay.width || outputDisplay.height !== sourceDisplay.height) {
    warnings.push(`Unexpected output display resolution: expected ${sourceDisplay.width}x${sourceDisplay.height}, got ${outputDisplay.width}x${outputDisplay.height}.`);
  }

  if (Math.abs(output.fps - source.fps) > FPS_TOLERANCE) {
    warnings.push(`Unexpected output FPS: expected ${source.fps}, got ${output.fps}.`);
  }

  if (output.videoCodec !== "h264" && output.videoCodec !== "hevc") {
    warnings.push(`Unexpected output video codec: ${output.videoCodec}.`);
  }

  const expectedPixelFormat = source.isHDR && output.videoCodec === "h264" ? "yuv420p10le" : "yuv420p";
  if (output.pixelFormat !== expectedPixelFormat) {
    warnings.push(`Unexpected output pixel format: expected ${expectedPixelFormat}, got ${output.pixelFormat ?? "unknown"}.`);
  }

  if (source.isHDR !== output.isHDR) {
    warnings.push(`HDR state changed unexpectedly: source ${source.isHDR}, output ${output.isHDR}.`);
  }

  if (output.audioCodec !== "aac" && output.audioCodec !== source.audioCodec) {
    warnings.push(`Unexpected output audio codec: ${output.audioCodec ?? "none"}.`);
  }

  if (source.audioCodec !== null && output.audioCodec === null) {
    warnings.push("Audio stream is missing from the output.");
  }

  const metrics = await measureQuality(sourcePath, outputPath);

  if (metrics.ssim === null) warnings.push("SSIM metric could not be calculated.");
  else if (metrics.ssim < MIN_SSIM) warnings.push(`SSIM quality is below threshold: ${metrics.ssim.toFixed(6)} < ${MIN_SSIM}.`);

  if (metrics.psnr === null) warnings.push("PSNR metric could not be calculated.");
  else if (metrics.psnr < MIN_PSNR_DB) warnings.push(`PSNR quality is below threshold: ${metrics.psnr.toFixed(3)} dB < ${MIN_PSNR_DB} dB.`);

  if (metrics.vmaf === null) warnings.push("VMAF metric could not be calculated.");
  else if (metrics.vmaf < MIN_VMAF) warnings.push(`VMAF quality is below threshold: ${metrics.vmaf.toFixed(2)} < ${MIN_VMAF}.`);

  return {
    source,
    output,
    changes: {
      width: outputDisplay.width - sourceDisplay.width,
      height: outputDisplay.height - sourceDisplay.height,
      fps: output.fps - source.fps,
      duration: output.duration - source.duration,
      fileSize: output.fileSize - source.fileSize,
      videoBitrate: output.bitrate - source.bitrate,
      audioBitrate: output.audioBitrate !== null && source.audioBitrate !== null ? output.audioBitrate - source.audioBitrate : null,
    },
    metrics,
    warnings,
    passed: warnings.length === 0,
  };
}

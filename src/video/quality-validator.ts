import { analyzeVideo } from "./analyzer.js";
import type { VideoMetadata } from "./types.js";

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
  warnings: string[];
  passed: boolean;
}

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;
const TARGET_FPS = 30;
const FPS_TOLERANCE = 0.1;
const DURATION_TOLERANCE = 0.15;
const MIN_VIDEO_BITRATE_KBPS = 2000;

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
    warnings.push(`Unexpected output pixel format: ${output.pixelFormat ?? "unknown"}.`);
  }

  if (output.audioCodec !== "aac") {
    warnings.push(`Unexpected output audio codec: ${output.audioCodec ?? "none"}.`);
  }

  // AAC bitrate reported by FFprobe for MP4 can be misleading with the native
  // FFmpeg AAC encoder. Validate that an AAC stream exists, but do not reject
  // an otherwise valid output based on stream bit_rate metadata.

  if (output.width <= 0 || output.height <= 0) {
    warnings.push("Output resolution is invalid.");
  }

  if (output.bitrate > 0 && output.bitrate / 1000 < MIN_VIDEO_BITRATE_KBPS) {
    warnings.push(
      `Video bitrate is unusually low: ${Math.round(output.bitrate / 1000)} kbps. Expected at least ${MIN_VIDEO_BITRATE_KBPS} kbps for a 1080x1920 TikTok output.`,
    );
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
    warnings,
    passed: warnings.length === 0,
  };
}

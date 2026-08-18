import type { VideoMetadata } from "./types.js";

export type SocialTarget = "tiktok" | "instagram_reels";
export type QualityMode = "quality" | "balanced" | "size";
export type VideoCodec = "libx264" | "libx265";

export interface OptimizationRequest {
  target: SocialTarget;
  quality: QualityMode;
  codec?: VideoCodec;
  keepAspectRatio?: boolean;
}

export interface OptimizationPlan {
  target: SocialTarget;
  quality: QualityMode;
  input: Pick<VideoMetadata, "width" | "height" | "fps" | "videoCodec" | "bitrate" | "pixelFormat" | "isHDR"> & {
    duration: number;
  };
  output: {
    width: number;
    height: number;
    fps: number;
    codec: VideoCodec;
    pixelFormat: "yuv420p";
    videoBitrateKbps: number;
    audioBitrateKbps: number;
    container: "mp4";
  };
  actions: {
    scale: boolean;
    crop: boolean;
    reencodeVideo: boolean;
    reencodeAudio: boolean;
  };
  warnings: string[];
}

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function selectBitrate(
  width: number,
  height: number,
  fps: number,
  quality: QualityMode,
): number {
  const pixels = width * height;
  const frameFactor = clamp(fps / 30, 1, 2);
  const pixelFactor = clamp(pixels / (1080 * 1920), 0.75, 1.5);

  const base = quality === "quality" ? 12000 : quality === "size" ? 6000 : 8500;
  return Math.round(base * pixelFactor * frameFactor);
}

export function createOptimizationPlan(
  metadata: VideoMetadata,
  request: OptimizationRequest,
): OptimizationPlan {
  const codec = request.codec ?? "libx264";
  const fps = metadata.fps > 0 ? Math.min(metadata.fps, 60) : 30;
  const warnings: string[] = [];

  if (metadata.isHDR) {
    warnings.push(
      "HDR input detected; SDR conversion is not enabled in this initial plan.",
    );
  }

  if (metadata.width < TARGET_WIDTH || metadata.height < TARGET_HEIGHT) {
    warnings.push(
      "Source is smaller than the target canvas; upscaling may reduce perceived sharpness.",
    );
  }

  if (metadata.videoCodec === codec.replace("lib", "") &&
      metadata.width === TARGET_WIDTH &&
      metadata.height === TARGET_HEIGHT) {
    warnings.push(
      "Source already matches the target geometry; re-encoding is still required when applying the selected quality profile.",
    );
  }

  return {
    target: request.target,
    quality: request.quality,
    input: {
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      videoCodec: metadata.videoCodec,
      bitrate: metadata.bitrate,
      pixelFormat: metadata.pixelFormat,
      isHDR: metadata.isHDR,
      duration: metadata.duration,
    },
    output: {
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT,
      fps,
      codec,
      pixelFormat: "yuv420p",
      videoBitrateKbps: selectBitrate(
        TARGET_WIDTH,
        TARGET_HEIGHT,
        fps,
        request.quality,
      ),
      audioBitrateKbps: request.quality === "size" ? 128 : 192,
      container: "mp4",
    },
    actions: {
      scale: metadata.width !== TARGET_WIDTH || metadata.height !== TARGET_HEIGHT,
      crop: metadata.width / metadata.height > TARGET_WIDTH / TARGET_HEIGHT,
      reencodeVideo: true,
      reencodeAudio:
        metadata.audioCodec !== "aac" ||
        metadata.audioBitrate !== (request.quality === "size" ? 128000 : 192000),
    },
    warnings,
  };
}

import type { VideoMetadata } from "./types.js";

export type SocialTarget = "tiktok" | "instagram_reels";
export type QualityMode = "quality" | "balanced" | "size";
export type VideoCodec = "libx264" | "libx265";
export type FramingMode = "crop" | "fit";

export interface OptimizationRequest {
  target: SocialTarget;
  quality: QualityMode;
  codec?: VideoCodec;
  framing?: FramingMode;
}

export interface OptimizationPlan {
  target: SocialTarget;
  quality: QualityMode;
  framing: FramingMode;
  input: Pick<
    VideoMetadata,
    | "width"
    | "height"
    | "fps"
    | "videoCodec"
    | "bitrate"
    | "pixelFormat"
    | "isHDR"
    | "duration"
  >;
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
    pad: boolean;
    reencodeVideo: boolean;
    reencodeAudio: boolean;
  };
  filter: string;
  warnings: string[];
}

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;
const TARGET_ASPECT = TARGET_WIDTH / TARGET_HEIGHT;

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

function buildFilter(
  sourceWidth: number,
  sourceHeight: number,
  framing: FramingMode,
): { filter: string; crop: boolean; pad: boolean; scale: boolean } {
  const sourceAspect = sourceWidth / sourceHeight;
  const epsilon = 0.002;

  if (Math.abs(sourceAspect - TARGET_ASPECT) <= epsilon) {
    return {
      filter: `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:flags=lanczos`,
      crop: false,
      pad: false,
      scale: true,
    };
  }

  if (framing === "crop") {
    return {
      filter:
        `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${TARGET_WIDTH}:${TARGET_HEIGHT},setsar=1`,
      crop: true,
      pad: false,
      scale: true,
    };
  }

  return {
    filter:
      `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
    crop: false,
    pad: true,
    scale: true,
  };
}

export function createOptimizationPlan(
  metadata: VideoMetadata,
  request: OptimizationRequest,
): OptimizationPlan {
  const codec = request.codec ?? "libx264";
  const framing = request.framing ?? "crop";
  const fps = metadata.fps > 0 ? Math.min(metadata.fps, 60) : 30;
  const warnings: string[] = [];

  const geometry = buildFilter(metadata.width, metadata.height, framing);

  if (metadata.isHDR) {
    warnings.push(
      "HDR input detected. The current plan preserves the source transfer characteristics only partially; HDR-to-SDR tone mapping is not enabled yet.",
    );
  }

  if (metadata.width < TARGET_WIDTH || metadata.height < TARGET_HEIGHT) {
    warnings.push(
      "Source is smaller than the target canvas; upscaling may reduce perceived sharpness.",
    );
  }

  if (framing === "crop" && geometry.crop) {
    warnings.push(
      "Crop mode is enabled. Parts of the original frame outside the 9:16 area will be removed.",
    );
  }

  if (framing === "fit" && geometry.pad) {
    warnings.push(
      "Fit mode is enabled. The full frame is preserved with padding where the source aspect ratio differs from 9:16.",
    );
  }

  return {
    target: request.target,
    quality: request.quality,
    framing,
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
      scale: geometry.scale,
      crop: geometry.crop,
      pad: geometry.pad,
      reencodeVideo: true,
      reencodeAudio:
        metadata.audioCodec !== "aac" ||
        metadata.audioBitrate !== (request.quality === "size" ? 128000 : 192000),
    },
    filter: geometry.filter,
    warnings,
  };
}

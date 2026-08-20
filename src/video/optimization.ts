import type { VideoMetadata } from "./types.js";

export type SocialTarget = "tiktok" | "instagram_reels";
export type QualityMode = "quality" | "balanced" | "size";
export type VideoCodec = "libx264" | "libx265";
export type FramingMode = "crop" | "fit";

export interface OptimizationRequest {
  target: SocialTarget;
  quality: QualityMode;
  codec?: VideoCodec;
  /** @deprecated TikTok4K preserves source geometry; framing is no longer used for crop/pad. */
  framing?: FramingMode;
}

export interface OptimizationPlan {
  target: SocialTarget;
  quality: QualityMode;
  framing: FramingMode;
  input: Pick<VideoMetadata, "width" | "height" | "fps" | "videoCodec" | "bitrate" | "pixelFormat" | "isHDR" | "duration" | "rotation">;
  output: {
    width: number;
    height: number;
    fps: number;
    codec: VideoCodec;
    pixelFormat: "yuv420p";
    crf: number;
    minVideoBitrateKbps: number;
    videoBitrateKbps: number;
    maxVideoBitrateKbps: number;
    bufferSizeKbps: number;
    audioBitrateKbps: number;
    container: "mp4";
  };
  actions: { scale: boolean; crop: boolean; pad: boolean; reencodeVideo: boolean; reencodeAudio: boolean };
  filter: string | null;
  warnings: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function selectEncoding(fps: number, quality: QualityMode, codec: VideoCodec) {
  const frameFactor = clamp(fps / 30, 1, 1.5);

  const crfBase = quality === "quality" ? 12 : quality === "size" ? 24 : 20;
  const crf = codec === "libx265" ? crfBase + 4 : crfBase;

  const minBase = quality === "quality" ? 8000 : quality === "size" ? 2000 : 4500;
  const targetBase = quality === "quality" ? 10000 : quality === "size" ? 3000 : 6000;
  const maxBase = quality === "quality" ? 14000 : quality === "size" ? 5000 : 9000;

  const minVideoBitrateKbps = Math.round(minBase * frameFactor);
  const videoBitrateKbps = clamp(Math.round(targetBase * frameFactor), 2000, 14000);
  const maxVideoBitrateKbps = clamp(Math.round(maxBase * frameFactor), 4000, 16000);
  const bufferSizeKbps = Math.round(maxVideoBitrateKbps * 1.2);

  return {
    crf,
    minVideoBitrateKbps,
    videoBitrateKbps,
    maxVideoBitrateKbps,
    bufferSizeKbps,
  };
}

function getDisplayDimensions(metadata: Pick<VideoMetadata, "width" | "height" | "rotation">) {
  const normalizedRotation = ((metadata.rotation % 360) + 360) % 360;
  const quarterTurn = normalizedRotation === 90 || normalizedRotation === 270;

  return quarterTurn
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

export function validateOptimizationInput(metadata: VideoMetadata): void {
  const display = getDisplayDimensions(metadata);
  const shortSide = Math.min(display.width, display.height);

  if (metadata.fps <= 0) {
    throw new Error("Unable to determine the video's frame rate.");
  }

  if (metadata.fps < 55) {
    throw new Error(`This video is ${metadata.fps.toFixed(2)} FPS. TikTok4K accepts videos from 55 FPS (60 FPS class) and above.`);
  }

  if (shortSide < 1080) {
    throw new Error(`This video is ${display.width}×${display.height}. TikTok4K requires at least 1080p resolution.`);
  }
}

export function createOptimizationPlan(metadata: VideoMetadata, request: OptimizationRequest): OptimizationPlan {
  validateOptimizationInput(metadata);

  const codec = request.codec ?? "libx264";
  const framing = request.framing ?? "fit";
  const fps = metadata.fps;
  const warnings: string[] = [];
  const display = getDisplayDimensions(metadata);
  const encoding = selectEncoding(fps, request.quality, codec);

  // Source geometry is intentionally preserved. FFmpeg's default autorotation
  // turns metadata rotation into the displayed orientation before filtering.
  // No crop, pad, or forced 9:16 canvas is used.
  const filter: string | null = null;

  if (metadata.isHDR) {
    warnings.push("HDR input detected. HDR encoding policy requires a dedicated benchmark before changing bit depth or tone mapping.");
  }

  if (metadata.rotation !== 0) {
    warnings.push(`Source rotation ${metadata.rotation}° will be preserved as displayed orientation; no crop or padding is applied.`);
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
      rotation: metadata.rotation,
    },
    output: {
      width: display.width,
      height: display.height,
      fps,
      codec,
      pixelFormat: "yuv420p",
      crf: encoding.crf,
      minVideoBitrateKbps: encoding.minVideoBitrateKbps,
      videoBitrateKbps: encoding.videoBitrateKbps,
      maxVideoBitrateKbps: encoding.maxVideoBitrateKbps,
      bufferSizeKbps: encoding.bufferSizeKbps,
      audioBitrateKbps: request.quality === "size" ? 128 : 192,
      container: "mp4",
    },
    actions: {
      scale: false,
      crop: false,
      pad: false,
      reencodeVideo: true,
      reencodeAudio: request.quality !== "quality",
    },
    filter,
    warnings,
  };
}

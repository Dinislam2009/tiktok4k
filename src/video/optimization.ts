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
  input: Pick<VideoMetadata, "width" | "height" | "fps" | "videoCodec" | "bitrate" | "pixelFormat" | "isHDR" | "duration">;
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
  filter: string;
  warnings: string[];
}

const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1920;
const TARGET_ASPECT = TARGET_WIDTH / TARGET_HEIGHT;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function selectEncoding(fps: number, quality: QualityMode, codec: VideoCodec) {
  const frameFactor = clamp(fps / 30, 1, 2);

  // Quality mode uses CRF as the primary quality control. A VBV ceiling keeps
  // complex scenes from producing unnecessarily large spikes while allowing
  // the encoder to spend bits where they actually improve the image.
  const crfBase = quality === "quality" ? 16 : quality === "size" ? 24 : 20;
  const crf = codec === "libx265" ? crfBase + 5 : crfBase;
  const maxBitrate = quality === "quality" ? 16000 : quality === "size" ? 6000 : 9000;
  const maxVideoBitrateKbps = Math.round(maxBitrate * frameFactor);
  const videoBitrateKbps = Math.round((quality === "quality" ? 12000 : quality === "size" ? 3000 : 6000) * frameFactor);

  return {
    crf,
    // Kept for plan compatibility. CRF mode intentionally does not force a
    // minimum bitrate because a simple scene may need far fewer bits without
    // losing quality.
    minVideoBitrateKbps: 0,
    videoBitrateKbps,
    maxVideoBitrateKbps,
    bufferSizeKbps: maxVideoBitrateKbps * 2,
  };
}

function buildFilter(sourceWidth: number, sourceHeight: number, framing: FramingMode) {
  const sourceAspect = sourceWidth / sourceHeight;
  if (Math.abs(sourceAspect - TARGET_ASPECT) <= 0.002) {
    return {
      filter: `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:flags=lanczos,setsar=1`,
      crop: false,
      pad: false,
      scale: true,
    };
  }

  if (framing === "crop") {
    return {
      filter: `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos,crop=${TARGET_WIDTH}:${TARGET_HEIGHT},setsar=1`,
      crop: true,
      pad: false,
      scale: true,
    };
  }

  return {
    filter: `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`,
    crop: false,
    pad: true,
    scale: true,
  };
}

export function createOptimizationPlan(metadata: VideoMetadata, request: OptimizationRequest): OptimizationPlan {
  const codec = request.codec ?? "libx264";
  const framing = request.framing ?? "crop";
  const fps = metadata.fps > 0 ? Math.min(metadata.fps, 60) : 30;
  const warnings: string[] = [];
  const geometry = buildFilter(metadata.width, metadata.height, framing);
  const encoding = selectEncoding(fps, request.quality, codec);

  if (metadata.isHDR) warnings.push("HDR input detected. HDR-to-SDR tone mapping is not enabled yet.");
  if (metadata.width < TARGET_WIDTH || metadata.height < TARGET_HEIGHT) warnings.push("Source is smaller than the target canvas; upscaling may reduce perceived sharpness.");
  if (framing === "crop" && geometry.crop) warnings.push("Crop mode is enabled. Parts of the original frame outside the 9:16 area will be removed.");
  if (framing === "fit" && geometry.pad) warnings.push("Fit mode is enabled. The full frame is preserved with padding where the source aspect ratio differs from 9:16.");

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
      crf: encoding.crf,
      minVideoBitrateKbps: encoding.minVideoBitrateKbps,
      videoBitrateKbps: encoding.videoBitrateKbps,
      maxVideoBitrateKbps: encoding.maxVideoBitrateKbps,
      bufferSizeKbps: encoding.bufferSizeKbps,
      audioBitrateKbps: request.quality === "size" ? 128 : 192,
      container: "mp4",
    },
    actions: {
      scale: geometry.scale,
      crop: geometry.crop,
      pad: geometry.pad,
      reencodeVideo: true,
      reencodeAudio: true,
    },
    filter: geometry.filter,
    warnings,
  };
}

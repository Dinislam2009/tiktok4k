import { stat } from "node:fs/promises";
import { estimateAudioBitrate, runFFprobe } from "./ffprobe.js";
import type { VideoMetadata } from "./types.js";

function parseFrameRate(value?: string): number {
  if (!value || value === "0/0") return 0;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

function parseNumber(value?: string): number | null {
  if (value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function detectRotation(stream: { tags?: Record<string, string>; side_data_list?: Array<{ rotation?: number }> }): number {
  const sideDataRotation = stream.side_data_list?.find((item) => typeof item.rotation === "number")?.rotation;
  if (typeof sideDataRotation === "number") return sideDataRotation;

  const tagRotation = stream.tags?.rotate;
  if (tagRotation !== undefined) {
    const rotation = Number(tagRotation);
    if (Number.isFinite(rotation)) return rotation;
  }
  return 0;
}

function detectHDR(colorTransfer: string | null, colorPrimaries: string | null): boolean {
  return colorTransfer === "smpte2084" || colorTransfer === "arib-std-b67" || colorPrimaries === "bt2020";
}

export async function analyzeVideo(filePath: string): Promise<VideoMetadata> {
  const fileStats = await stat(filePath);
  if (!fileStats.isFile()) throw new Error("The selected path is not a file.");

  const result = await runFFprobe(filePath);
  const videoStream = result.streams.find((stream) => stream.codec_type === "video");
  const audioStream = result.streams.find((stream) => stream.codec_type === "audio");

  if (!videoStream) throw new Error("No video stream was found.");

  const duration = Number(result.format.duration ?? 0);
  const width = videoStream.width ?? 0;
  const height = videoStream.height ?? 0;
  if (width <= 0 || height <= 0) throw new Error("Invalid video resolution.");

  const fps = parseFrameRate(videoStream.avg_frame_rate ?? videoStream.r_frame_rate);
  const videoBitrate = parseNumber(videoStream.bit_rate) ?? parseNumber(result.format.bit_rate) ?? 0;
  const colorSpace = videoStream.color_space ?? null;
  const colorTransfer = videoStream.color_transfer ?? null;
  const colorPrimaries = videoStream.color_primaries ?? null;

  let audioBitrate = parseNumber(audioStream?.bit_rate);

  // AAC in MP4 can expose an unreliable stream-level bit_rate. When it is
  // missing or suspiciously low, estimate the real average bitrate from packets.
  if (audioStream && (audioBitrate === null || audioBitrate < 64000)) {
    const estimated = await estimateAudioBitrate(filePath);
    if (estimated !== null) audioBitrate = estimated;
  }

  return {
    filePath,
    fileSize: fileStats.size,
    container: result.format.format_name ?? "unknown",
    duration: Number.isFinite(duration) ? duration : 0,
    width,
    height,
    fps,
    bitrate: videoBitrate,
    videoCodec: videoStream.codec_name ?? "unknown",
    videoProfile: videoStream.profile ?? null,
    videoLevel: typeof videoStream.level === "number" ? videoStream.level : null,
    pixelFormat: videoStream.pix_fmt ?? null,
    colorSpace,
    colorTransfer,
    colorPrimaries,
    isHDR: detectHDR(colorTransfer, colorPrimaries),
    audioCodec: audioStream?.codec_name ?? null,
    audioBitrate,
    audioSampleRate: parseNumber(audioStream?.sample_rate),
    audioChannels: typeof audioStream?.channels === "number" ? audioStream.channels : null,
    rotation: detectRotation(videoStream),
  };
}

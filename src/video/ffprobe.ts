import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

interface FFProbeStream {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  level?: number;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  bit_rate?: string;
  pix_fmt?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  sample_rate?: string;
  channels?: number;
  tags?: Record<string, string>;
  side_data_list?: Array<{ rotation?: number }>;
}

interface FFProbeFormat {
  format_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
}

interface FFProbeOutput {
  streams?: FFProbeStream[];
  format?: FFProbeFormat;
}

interface FFProbePacket {
  stream_index?: number;
  size?: string;
  duration_time?: string;
}

interface FFProbePacketOutput {
  packets?: FFProbePacket[];
}

function getFFprobePath(): string {
  const executableName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const executablePath = path.resolve(process.cwd(), "binaries", "ffmpeg", executableName);

  if (!existsSync(executablePath)) {
    throw new Error(`FFprobe not found: ${executablePath}`);
  }

  return executablePath;
}

function runProcess(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(getFFprobePath(), args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    process.stdout.setEncoding("utf8");
    process.stderr.setEncoding("utf8");
    process.stdout.on("data", (data: string) => { stdout += data; });
    process.stderr.on("data", (data: string) => { stderr += data; });

    process.on("error", (error) => reject(new Error(`Failed to start FFprobe: ${error.message}`)));
    process.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`FFprobe exited with code ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export function runFFprobe(filePath: string): Promise<FFProbeOutput> {
  return runProcess([
    "-v", "error",
    "-show_streams",
    "-show_format",
    "-of", "json",
    filePath,
  ]).then((stdout) => {
    try {
      const result = JSON.parse(stdout) as FFProbeOutput;
      return { streams: result.streams ?? [], format: result.format ?? {} };
    } catch {
      throw new Error("FFprobe returned invalid JSON.");
    }
  });
}

/**
 * Estimates average bitrate from packet sizes. This is used when a container's
 * stream-level AAC bit_rate metadata is missing or clearly unreliable.
 */
export async function estimateAudioBitrate(filePath: string): Promise<number | null> {
  const stdout = await runProcess([
    "-v", "error",
    "-select_streams", "a:0",
    "-show_packets",
    "-show_entries", "packet=size,duration_time",
    "-of", "json",
    filePath,
  ]);

  let result: FFProbePacketOutput;
  try {
    result = JSON.parse(stdout) as FFProbePacketOutput;
  } catch {
    return null;
  }

  let totalBytes = 0;
  let totalDuration = 0;

  for (const packet of result.packets ?? []) {
    const size = Number(packet.size);
    const duration = Number(packet.duration_time);
    if (Number.isFinite(size) && size > 0) totalBytes += size;
    if (Number.isFinite(duration) && duration > 0) totalDuration += duration;
  }

  if (totalBytes <= 0 || totalDuration <= 0) return null;
  return (totalBytes * 8) / totalDuration;
}

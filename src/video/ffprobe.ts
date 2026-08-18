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
  size?: string;
}

interface FFProbePacketOutput {
  packets?: FFProbePacket[];
  format?: { duration?: string };
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
 * Estimates average audio bitrate from the total size of audio packets divided
 * by the full container duration. Packet duration fields are intentionally not
 * used because AAC-in-MP4 duration_time values can be missing or expressed in
 * a way that makes a packet-duration sum inaccurate.
 */
export async function estimateAudioBitrate(filePath: string): Promise<number | null> {
  const stdout = await runProcess([
    "-v", "error",
    "-select_streams", "a:0",
    "-show_packets",
    "-show_format",
    "-show_entries", "packet=size:format=duration",
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
  for (const packet of result.packets ?? []) {
    const size = Number(packet.size);
    if (Number.isFinite(size) && size > 0) totalBytes += size;
  }

  const duration = Number(result.format?.duration);
  if (totalBytes <= 0 || !Number.isFinite(duration) || duration <= 0) return null;

  return (totalBytes * 8) / duration;
}

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

function getFFprobePath(): string {
  const executableName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const executablePath = path.resolve(process.cwd(), "binaries", "ffmpeg", executableName);

  if (!existsSync(executablePath)) {
    throw new Error(`FFprobe not found: ${executablePath}`);
  }

  return executablePath;
}

export function runFFprobe(filePath: string): Promise<FFProbeOutput> {
  return new Promise((resolve, reject) => {
    const process = spawn(getFFprobePath(), [
      "-v", "error",
      "-show_streams",
      "-show_format",
      "-of", "json",
      filePath,
    ], { windowsHide: true });

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

      try {
        const result = JSON.parse(stdout) as FFProbeOutput;
        resolve({ streams: result.streams ?? [], format: result.format ?? {} });
      } catch {
        reject(new Error("FFprobe returned invalid JSON."));
      }
    });
  });
}

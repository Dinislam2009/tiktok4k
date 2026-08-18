import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { analyzeVideo } from "./analyzer";
import type { VideoMetadata } from "./types";

export interface RenderOptions {
  inputPath: string;
  outputPath: string;
  videoCodec?: "h264" | "h265";
  crf?: number;
  preset?: string;
  audioBitrate?: number;
  width?: number;
  height?: number;
  fps?: number;
}

export interface RenderProgress {
  percent: number;
  frame: number;
  fps: number;
  bitrate: string;
  outTimeSeconds: number;
  speed: string;
}

export interface RenderResult {
  outputPath: string;
  duration: number;
}

function getBinary(name: "ffmpeg.exe" | "ffprobe.exe"): string {
  const executable = path.resolve(process.cwd(), "binaries", "ffmpeg", name);

  if (!existsSync(executable)) {
    throw new Error(`FFmpeg binary not found: ${executable}`);
  }

  return executable;
}

function parseTime(value: string | undefined): number {
  if (!value) return 0;

  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    return 0;
  }

  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function quoteFilterValue(value: string): string {
  return value.replace(/[:\\]/g, "\\$&");
}

export class FFmpegRenderer {
  private process: ChildProcessWithoutNullStreams | null = null;

  async render(
    options: RenderOptions,
    onProgress?: (progress: RenderProgress) => void,
  ): Promise<RenderResult> {
    const metadata: VideoMetadata = await analyzeVideo(options.inputPath);

    if (metadata.duration <= 0) {
      throw new Error("Cannot render a video with unknown or zero duration.");
    }

    if (existsSync(options.outputPath)) {
      throw new Error(`Output file already exists: ${options.outputPath}`);
    }

    const codec = options.videoCodec === "h265" ? "libx265" : "libx264";
    const crf = options.crf ?? (codec === "libx265" ? 26 : 20);
    const preset = options.preset ?? "medium";
    const audioBitrate = options.audioBitrate ?? 192;

    const videoFilters: string[] = [];

    if (options.width && options.height) {
      videoFilters.push(
        `scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease`,
        `pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2`,
      );
    }

    const args = [
      "-hide_banner",
      "-y",
      "-i",
      options.inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      codec,
      "-preset",
      preset,
      "-crf",
      String(crf),
    ];

    if (options.fps) {
      args.push("-r", String(options.fps));
    }

    if (videoFilters.length > 0) {
      args.push("-vf", videoFilters.map(quoteFilterValue).join(","));
    }

    args.push(
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      `${audioBitrate}k`,
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      "-nostats",
      options.outputPath,
    );

    const ffmpegPath = getBinary("ffmpeg.exe");

    this.process = spawn(ffmpegPath, args, {
      windowsHide: true,
    });

    return await new Promise<RenderResult>((resolve, reject) => {
      let stderr = "";
      let progressBuffer = "";
      let lastProgress: RenderProgress | null = null;

      this.process!.stdout.setEncoding("utf8");
      this.process!.stderr.setEncoding("utf8");

      this.process!.stdout.on("data", (chunk: string) => {
        progressBuffer += chunk;

        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = lines.pop() ?? "";

        const values = new Map<string, string>();

        for (const line of lines) {
          const separator = line.indexOf("=");
          if (separator <= 0) continue;

          values.set(
            line.slice(0, separator),
            line.slice(separator + 1),
          );
        }

        const outTimeSeconds = parseTime(values.get("out_time"));
        const percent = Math.min(
          100,
          Math.max(0, (outTimeSeconds / metadata.duration) * 100),
        );

        lastProgress = {
          percent,
          frame: Number(values.get("frame") ?? 0),
          fps: Number(values.get("fps") ?? 0),
          bitrate: values.get("bitrate") ?? "N/A",
          outTimeSeconds,
          speed: values.get("speed") ?? "N/A",
        };

        onProgress?.(lastProgress);
      });

      this.process!.stderr.on("data", (chunk: string) => {
        stderr += chunk;

        if (stderr.length > 20000) {
          stderr = stderr.slice(-20000);
        }
      });

      this.process!.on("error", (error) => {
        this.process = null;
        reject(new Error(`Failed to start FFmpeg: ${error.message}`));
      });

      this.process!.on("close", (code) => {
        this.process = null;

        if (code !== 0) {
          reject(
            new Error(
              `FFmpeg exited with code ${code}.\n${stderr.trim()}`,
            ),
          );
          return;
        }

        onProgress?.({
          percent: 100,
          frame: lastProgress?.frame ?? 0,
          fps: lastProgress?.fps ?? 0,
          bitrate: lastProgress?.bitrate ?? "N/A",
          outTimeSeconds: metadata.duration,
          speed: lastProgress?.speed ?? "N/A",
        });

        resolve({
          outputPath: options.outputPath,
          duration: metadata.duration,
        });
      });
    });
  }

  cancel(): void {
    if (!this.process) return;

    this.process.kill();
    this.process = null;
  }
}

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { analyzeVideo } from "./analyzer.js";
import { createOptimizationPlan, type OptimizationRequest } from "./optimization.js";
import type { VideoMetadata } from "./types.js";

export interface RenderOptions extends OptimizationRequest {
  inputPath: string;
  outputPath: string;
  crf?: number;
  preset?: string;
}

export interface RenderProgress { percent: number; frame: number; fps: number; bitrate: string; outTimeSeconds: number; speed: string; }
export interface RenderResult { outputPath: string; duration: number; }

function getBinary(): string {
  const isDev = process.env.VITE_DEV_SERVER_URL !== undefined || !app.isPackaged;

  const executable = isDev
    ? path.resolve(process.cwd(), "binaries", "ffmpeg", "ffmpeg.exe")
    : path.resolve(process.resourcesPath, "binaries", "ffmpeg", "ffmpeg.exe");

  if (!existsSync(executable)) {
    throw new Error(`FFmpeg binary not found: ${executable}`);
  }
  return executable;
}

function parseTime(value?: string): number {
  if (!value) return 0;
  const parts = value.split(":").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) return 0;
  return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
}

export class FFmpegRenderer {
  private process: ChildProcessWithoutNullStreams | null = null;
  private currentOutputPath: string | null = null;

  private run(args: string[], metadata: VideoMetadata, onProgress?: (progress: RenderProgress) => void): Promise<void> {
    this.process = spawn(getBinary(), args, { windowsHide: true });

    return new Promise<void>((resolve, reject) => {
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
          if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
        }
        const outTimeSeconds = parseTime(values.get("out_time"));
        lastProgress = {
          percent: Math.min(100, Math.max(0, (outTimeSeconds / metadata.duration) * 100)),
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
        if (stderr.length > 20000) stderr = stderr.slice(-20000);
      });

      this.process!.on("error", (error) => {
        this.process = null;
        this.cleanupPartialFile();
        reject(new Error(`Failed to start FFmpeg: ${error.message}`));
      });

      this.process!.on("close", (code) => {
        this.process = null;
        if (code !== 0) {
          this.cleanupPartialFile();
          reject(new Error(`FFmpeg exited with code ${code}.\n${stderr.trim()}`));
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
        this.currentOutputPath = null;
        resolve();
      });
    });
  }

  async render(options: RenderOptions, onProgress?: (progress: RenderProgress) => void): Promise<RenderResult> {
    const metadata: VideoMetadata = await analyzeVideo(options.inputPath);
    if (metadata.duration <= 0) throw new Error("Cannot render a video with unknown or zero duration.");
    if (existsSync(options.outputPath)) throw new Error(`Output file already exists: ${options.outputPath}`);

    this.currentOutputPath = options.outputPath;

    const plan = createOptimizationPlan(metadata, options);
    const encoder = plan.output.codec === "libx265" ? "libx265" : "libx264";
    const preset = options.preset ?? (options.quality === "quality" ? "veryslow" : "medium");
    const crf = options.crf ?? plan.output.crf;

    const commonArgs = [
      "-hide_banner", "-y", "-i", options.inputPath,
      "-map", "0:v:0", "-map", "0:a:0?",
      "-map_metadata", "0",
      "-vf", plan.filter,
      "-c:v", encoder,
      "-preset", preset,
      "-r", String(plan.output.fps),
      "-pix_fmt", plan.output.pixelFormat,
    ];

    const audioArgs = options.quality === "quality"
      ? [
          "-c:a", "copy",
          "-movflags", "+faststart",
        ]
      : [
          "-c:a", "aac",
          "-b:a", `${plan.output.audioBitrateKbps}k`,
          "-movflags", "+faststart",
        ];

    if (options.quality === "quality" && encoder === "libx264") {
      await this.run([
        ...commonArgs,
        ...audioArgs,
        "-profile:v", "high",
        "-level:v", "4.1",
        "-crf", String(crf),
        "-maxrate", `${plan.output.maxVideoBitrateKbps}k`,
        "-bufsize", `${plan.output.bufferSizeKbps}k`,
        "-progress", "pipe:1",
        "-nostats",
        options.outputPath,
      ], metadata, onProgress);
    } else {
      const rateControl = [
        "-crf", String(crf),
        "-b:v", `${plan.output.videoBitrateKbps}k`,
        "-maxrate", `${plan.output.maxVideoBitrateKbps}k`,
        "-bufsize", `${plan.output.bufferSizeKbps}k`,
      ];

      await this.run([
        ...commonArgs,
        ...audioArgs,
        ...rateControl,
        "-progress", "pipe:1",
        "-nostats",
        options.outputPath,
      ], metadata, onProgress);
    }

    return { outputPath: options.outputPath, duration: metadata.duration };
  }

  private cleanupPartialFile(): void {
    if (this.currentOutputPath && existsSync(this.currentOutputPath)) {
      try {
        unlinkSync(this.currentOutputPath);
      } catch {
        // Уақытша файлды өшіру кезіндегі қатені елемеу
      }
      this.currentOutputPath = null;
    }
  }

  cancel(): void {
    if (!this.process) return;
    this.process.kill();
    this.process = null;
    this.cleanupPartialFile();
  }
}
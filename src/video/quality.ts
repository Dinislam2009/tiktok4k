import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { analyzeVideo } from "./analyzer.js";

export interface QualityMetricsResult {
  ssim: number;
  psnr: number;
  vmaf: number;
}

type ProcessWithResourcesPath = NodeJS.Process & { resourcesPath?: string };

function getFFmpegBinary(): string {
  const resourcesPath = (process as ProcessWithResourcesPath).resourcesPath;
  const isPackaged = process.env.VITE_DEV_SERVER_URL === undefined && Boolean(resourcesPath);
  const executableName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";

  const executable = isPackaged
    ? path.resolve(resourcesPath as string, "binaries", "ffmpeg", executableName)
    : path.resolve(process.cwd(), "binaries", "ffmpeg", executableName);

  if (!existsSync(executable)) throw new Error(`FFmpeg binary not found: ${executable}`);
  return executable;
}

function getDisplayDimensions(width: number, height: number, rotation: number) {
  const normalizedRotation = ((rotation % 360) + 360) % 360;
  const quarterTurn = normalizedRotation === 90 || normalizedRotation === 270;
  return quarterTurn ? { width: height, height: width } : { width, height };
}

function parseMetric(stderr: string, type: "SSIM" | "PSNR" | "VMAF"): number | null {
  const patterns = type === "SSIM"
    ? [/SSIM\s+Y:[^\n]*?All:\s*([0-9.]+)/i, /All:\s*([0-9.]+)/i]
    : type === "PSNR"
      ? [/PSNR\s+y:[^\n]*?average:\s*([0-9.]+)/i, /average:\s*([0-9.]+)/i]
      : [/VMAF\s+score:\s*([0-9.]+)/i, /VMAF[^\n]*?score[:=]\s*([0-9.]+)/i, /mean[:=]\s*([0-9.]+)/i];

  for (const pattern of patterns) {
    const match = stderr.match(pattern);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export async function calculateMetrics(sourcePath: string, outputPath: string): Promise<QualityMetricsResult> {
  const ffmpegPath = getFFmpegBinary();
  const source = await analyzeVideo(sourcePath);
  const display = getDisplayDimensions(source.width, source.height, source.rotation);
  const fps = source.fps;

  const filter = [
    `[0:v]scale=${display.width}:${display.height}:force_original_aspect_ratio=disable:flags=lanczos,setsar=1,fps=${fps},settb=1/${fps},setpts=PTS-STARTPTS[ref]`,
    `[1:v]scale=${display.width}:${display.height}:force_original_aspect_ratio=disable:flags=lanczos,setsar=1,fps=${fps},settb=1/${fps},setpts=PTS-STARTPTS[enc]`,
    `[ref]split=3[r1][r2][r3]`,
    `[enc]split=3[e1][e2][e3]`,
    `[r1][e1]ssim[ssim_out]`,
    `[r2][e2]psnr[psnr_out]`,
    `[r3][e3]libvmaf[vmaf_out]`,
  ].join(";");

  return await new Promise<QualityMetricsResult>((resolve, reject) => {
    const proc = spawn(
      ffmpegPath,
      [
        "-hide_banner", "-nostdin",
        "-i", sourcePath,
        "-i", outputPath,
        "-filter_complex", filter,
        "-map", "[ssim_out]",
        "-map", "[psnr_out]",
        "-map", "[vmaf_out]",
        "-an", "-f", "null", process.platform === "win32" ? "NUL" : "/dev/null",
      ],
      { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
    );

    let stderr = "";
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      if (stderr.length > 300_000) stderr = stderr.slice(-300_000);
    });

    const timeout = setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error("Quality evaluation timed out after 4 minutes."));
    }, 240_000);

    proc.on("error", (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to start quality evaluation: ${error.message}`));
    });

    proc.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`FFmpeg quality evaluation failed with exit code ${code}.\n${stderr.trim()}`));
        return;
      }

      const ssim = parseMetric(stderr, "SSIM");
      const psnr = parseMetric(stderr, "PSNR");
      const vmaf = parseMetric(stderr, "VMAF");
      if (ssim === null || psnr === null || vmaf === null) {
        reject(new Error(`FFmpeg completed but did not expose all quality metrics. SSIM=${ssim ?? "null"}, PSNR=${psnr ?? "null"}, VMAF=${vmaf ?? "null"}.`));
        return;
      }

      resolve({
        ssim: Number(ssim.toFixed(6)),
        psnr: Number(psnr.toFixed(3)),
        vmaf: Number(vmaf.toFixed(2)),
      });
    });
  });
}

import path from "node:path";
import { FFmpegRenderer } from "./video/ffmpeg.js";
import type { FramingMode, QualityMode, SocialTarget } from "./video/optimization.js";

const inputPath = process.argv[2];
const outputPath = process.argv[3];
const framing = (process.argv[4] ?? "crop") as FramingMode;
const quality = (process.argv[5] ?? "balanced") as QualityMode;
const target = (process.argv[6] ?? "tiktok") as SocialTarget;
const preset = process.argv[7] ?? "veryslow";

if (!inputPath || !outputPath) {
  console.error(
    "Usage: npm run render -- <input-video> <output-video> [crop|fit] [quality|balanced|size] [tiktok|instagram_reels] [preset]",
  );
  process.exit(1);
}

const resolvedInputPath = path.resolve(inputPath);
const resolvedOutputPath = path.resolve(outputPath);

if (!["crop", "fit"].includes(framing)) {
  console.error("Framing must be crop or fit.");
  process.exit(1);
}

if (!["quality", "balanced", "size"].includes(quality)) {
  console.error("Quality must be quality, balanced, or size.");
  process.exit(1);
}

if (!["tiktok", "instagram_reels"].includes(target)) {
  console.error("Target must be tiktok or instagram_reels.");
  process.exit(1);
}

async function main() {
  const renderer = new FFmpegRenderer();

  try {
    const result = await renderer.render(
      {
        inputPath: resolvedInputPath,
        outputPath: resolvedOutputPath,
        target,
        quality,
        framing,
        codec: "libx264",
        preset,
      },
      (progress) => {
        process.stdout.write(
          `\r${progress.percent.toFixed(1)}% | ${progress.fps.toFixed(1)} fps | ${progress.speed}`,
        );
      },
    );

    process.stdout.write("\n");
    console.log(`Target: ${target}`);
    console.log(`Framing: ${framing}`);
    console.log(`Quality: ${quality}`);
    console.log(`Preset: ${preset}`);
    console.log(`Rendered: ${result.outputPath}`);
  } catch (error) {
    process.stdout.write("\n");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();

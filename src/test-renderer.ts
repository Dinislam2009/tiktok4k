import path from "node:path";
import { FFmpegRenderer } from "./video/ffmpeg";

const inputPath = process.argv[2];
const outputPath = process.argv[3];

if (!inputPath || !outputPath) {
  console.error("Usage: npm run render -- <input-video> <output-video>");
  process.exit(1);
}

async function main() {
  const renderer = new FFmpegRenderer();

  try {
    const result = await renderer.render(
      {
        inputPath: path.resolve(inputPath),
        outputPath: path.resolve(outputPath),
        videoCodec: "h264",
        crf: 20,
        preset: "medium",
        audioBitrate: 192,
      },
      (progress) => {
        process.stdout.write(
          `\r${progress.percent.toFixed(1)}% | ${progress.fps.toFixed(1)} fps | ${progress.speed}`,
        );
      },
    );

    process.stdout.write("\n");
    console.log(`Rendered: ${result.outputPath}`);
  } catch (error) {
    process.stdout.write("\n");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();

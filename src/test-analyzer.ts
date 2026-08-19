import { analyzeVideo } from "./video/analyzer.js";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: npm run analyze -- <video-file>");
  process.exit(1);
}

try {
  const metadata = await analyzeVideo(filePath);
  console.log(JSON.stringify(metadata, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

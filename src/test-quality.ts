import path from "node:path";
import { validateOutput } from "./video/quality-validator.js";

const sourcePath = process.argv[2];
const outputPath = process.argv[3];

if (!sourcePath || !outputPath) {
  console.error("Usage: npm run quality -- <source-video> <output-video>");
  process.exit(1);
}

try {
  const result = await validateOutput(
    path.resolve(sourcePath),
    path.resolve(outputPath),
  );

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 2);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

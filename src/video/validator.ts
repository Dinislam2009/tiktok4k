import { stat } from "node:fs/promises";
import { analyzeVideo } from "./analyzer.js";
import type { VideoMetadata } from "./types.js";
import type { OptimizationPlan } from "./optimization.js";

export interface ValidationCheck {
  name: string;
  passed: boolean;
  actual: string;
  expected: string;
  severity: "error" | "warning" | "info";
}

export interface ValidationResult {
  valid: boolean;
  checks: ValidationCheck[];
  metadata: VideoMetadata;
}

export async function validateOutput(
  outputPath: string,
  plan: OptimizationPlan,
): Promise<ValidationResult> {
  const checks: ValidationCheck[] = [];
  const file = await stat(outputPath);

  if (!file.isFile() || file.size === 0) {
    throw new Error("Output file is missing or empty.");
  }

  const metadata = await analyzeVideo(outputPath);

  const check = (
    name: string,
    passed: boolean,
    actual: string,
    expected: string,
    severity: ValidationCheck["severity"] = "error",
  ) => {
    checks.push({ name, passed, actual, expected, severity });
  };

  check(
    "container",
    metadata.container.split(",").includes(plan.output.container),
    metadata.container,
    plan.output.container,
  );

  check(
    "width",
    metadata.width === plan.output.width,
    String(metadata.width),
    String(plan.output.width),
  );

  check(
    "height",
    metadata.height === plan.output.height,
    String(metadata.height),
    String(plan.output.height),
  );

  const fpsTolerance = 0.01;
  check(
    "fps",
    Math.abs(metadata.fps - plan.output.fps) <= fpsTolerance,
    metadata.fps.toFixed(3),
    plan.output.fps.toFixed(3),
    "warning",
  );

  const expectedCodec = plan.output.codec === "libx265" ? "hevc" : "h264";
  check(
    "video codec",
    metadata.videoCodec === expectedCodec,
    metadata.videoCodec,
    expectedCodec,
  );

  check(
    "pixel format",
    metadata.pixelFormat === plan.output.pixelFormat,
    metadata.pixelFormat ?? "unknown",
    plan.output.pixelFormat,
  );

  check(
    "audio codec",
    metadata.audioCodec === "aac" || metadata.audioCodec === null,
    metadata.audioCodec ?? "none",
    "aac or none",
    "warning",
  );

  if (metadata.duration > 0) {
    check(
      "duration",
      Math.abs(metadata.duration - plan.inputDuration) <= Math.max(0.25, plan.inputDuration * 0.02),
      `${metadata.duration.toFixed(3)}s`,
      `within 2% of ${plan.inputDuration.toFixed(3)}s`,
      "warning",
    );
  }

  const hardErrors = checks.filter(
    (item) => !item.passed && item.severity === "error",
  );

  return {
    valid: hardErrors.length === 0,
    checks,
    metadata,
  };
}

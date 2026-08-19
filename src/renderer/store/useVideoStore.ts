import { create } from "zustand";

export interface RenderProgress {
  percent: number;
  frame: number;
  fps: number;
  bitrate: string;
  outTimeSeconds: number;
  speed: string;
}

export interface QualityMetrics {
  ssim: number;
  psnr: number;
  vmaf: number;
}

interface VideoStore {
  filePath: string | null;
  metadata: Record<string, unknown> | null;
  isAnalyzing: boolean;
  isRendering: boolean;
  renderedPath: string | null;
  progress: RenderProgress | null;
  metrics: QualityMetrics | null;
  isEvaluatingQuality: boolean;
  target: "tiktok" | "instagram_reels";
  quality: "quality" | "balanced" | "size";
  framing: "crop" | "fit";

  setFilePath: (path: string | null) => void;
  setTarget: (target: "tiktok" | "instagram_reels") => void;
  setQuality: (quality: "quality" | "balanced" | "size") => void;
  setFraming: (framing: "crop" | "fit") => void;

  analyze: (path: string) => Promise<void>;
  startRender: (outputPath: string) => Promise<void>;
  cancelRender: () => Promise<void>;
  evaluateQuality: () => Promise<void>;
  reset: () => void;
}

export const useVideoStore = create<VideoStore>((set, get) => ({
  filePath: null,
  metadata: null,
  isAnalyzing: false,
  isRendering: false,
  renderedPath: null,
  progress: null,
  metrics: null,
  isEvaluatingQuality: false,
  target: "tiktok",
  quality: "quality",
  framing: "crop",

  setFilePath: (filePath) => set({ filePath }),
  setTarget: (target) => set({ target }),
  setQuality: (quality) => set({ quality }),
  setFraming: (framing) => set({ framing }),

  analyze: async (filePath: string) => {
    set({ isAnalyzing: true, filePath, metadata: null, renderedPath: null, metrics: null });
    try {
      const data = await window.electronAPI.analyzeVideo(filePath);
      set({ metadata: data as Record<string, unknown>, isAnalyzing: false });
    } catch (err) {
      console.error("Analysis failed:", err);
      set({ isAnalyzing: false });
    }
  },

  startRender: async (outputPath: string) => {
    const { filePath, target, quality, framing } = get();
    if (!filePath) return;

    // LocalStorage-тен userId мен deviceId алу
    const authStorage = JSON.parse(localStorage.getItem("auth-storage") || "{}");
    const userId = authStorage?.state?.user?.id;
    const deviceId = localStorage.getItem("app_device_id");

    if (!userId) {
      alert("Видеоны оңтайландыру үшін алдымен Telegram арқылы кіріңіз!");
      return;
    }

    // Серверден лимитті тексеру
    try {
      const res = await fetch("http://localhost:3000/api/usage/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, deviceId }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        alert(errorData.message || "Лимит асып кетті!");
        return;
      }
    } catch (err) {
      console.error("Usage validation failed:", err);
    }

    set({ isRendering: true, progress: null, renderedPath: null, metrics: null });

    const unsubscribe = window.electronAPI.onProgress((progressData) => {
      set({ progress: progressData as unknown as RenderProgress });
    });

    try {
      const result = (await window.electronAPI.renderVideo({
        inputPath: filePath,
        outputPath,
        target,
        quality,
        framing,
      })) as { outputPath: string };

      set({ renderedPath: result.outputPath });
    } catch (err) {
      console.error("Render failed:", err);
    } finally {
      unsubscribe();
      set({ isRendering: false });
    }
  },

  evaluateQuality: async () => {
    const { filePath, renderedPath } = get();
    if (!filePath || !renderedPath) return;

    set({ isEvaluatingQuality: true });
    try {
      const res = await window.electronAPI.evaluateQuality(filePath, renderedPath);
      set({ metrics: res, isEvaluatingQuality: false });
    } catch (err) {
      console.error("Quality evaluation failed:", err);
      set({ isEvaluatingQuality: false });
    }
  },

  cancelRender: async () => {
    await window.electronAPI.cancelRender();
    set({ isRendering: false, progress: null, renderedPath: null, metrics: null });
  },

  reset: () =>
    set({
      filePath: null,
      metadata: null,
      isAnalyzing: false,
      isRendering: false,
      renderedPath: null,
      progress: null,
      metrics: null,
      isEvaluatingQuality: false,
    }),
}));
export interface ElectronAPI {
  selectFile: () => Promise<string | null>;
  analyzeVideo: (filePath: string) => Promise<unknown>;
  renderVideo: (options: Record<string, unknown>) => Promise<unknown>;
  cancelRender: () => Promise<boolean>;
  evaluateQuality: (sourcePath: string, outputPath: string) => Promise<{ ssim: number; psnr: number; vmaf: number }>;
  showInFolder: (filePath: string) => Promise<void>;
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
  closeWindow: () => Promise<void>;
  onProgress: (callback: (progress: Record<string, unknown>) => void) => () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
export interface VideoMetadata {
  filePath: string;
  fileSize: number;
  container: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  videoCodec: string;
  videoProfile: string | null;
  videoLevel: number | null;
  pixelFormat: string | null;
  colorSpace: string | null;
  colorTransfer: string | null;
  colorPrimaries: string | null;
  isHDR: boolean;
  audioCodec: string | null;
  audioBitrate: number | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
  rotation: number;
}

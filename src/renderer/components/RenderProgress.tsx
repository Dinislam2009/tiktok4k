import React from "react";
import { useVideoStore } from "../store/useVideoStore";
import { Square, Loader2 } from "lucide-react";

export const RenderProgressView: React.FC = () => {
  const { progress, cancelRender } = useVideoStore();

  const percent = Math.round(progress?.percent || 0);

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 space-y-6 text-center">
      <div className="flex justify-center">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
      </div>

      <div>
        <h3 className="text-xl font-bold text-white mb-1">Видео өңделуде...</h3>
        <p className="text-sm text-neutral-400">Артқа шегінбей күте тұрыңыз</p>
      </div>

      <div className="space-y-2">
        <div className="w-full bg-neutral-800 rounded-full h-3 overflow-hidden">
          <div
            className="bg-blue-600 h-full transition-all duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-neutral-400 font-mono">
          <span>{percent}%</span>
          <span>{progress?.speed || "0x"}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 p-4 bg-neutral-950/50 rounded-xl text-xs font-mono text-neutral-300">
        <div>
          <span className="block text-neutral-500">FPS</span>
          {progress?.fps || 0}
        </div>
        <div>
          <span className="block text-neutral-500">BITRATE</span>
          {progress?.bitrate || "0 kb/s"}
        </div>
        <div>
          <span className="block text-neutral-500">FRAME</span>
          {progress?.frame || 0}
        </div>
      </div>

      <button
        onClick={cancelRender}
        className="py-2.5 px-6 bg-red-600/20 hover:bg-red-600/30 text-red-400 font-medium rounded-xl transition inline-flex items-center gap-2 text-sm"
      >
        <Square className="w-4 h-4 fill-current" />
        Тоқтату
      </button>
    </div>
  );
};
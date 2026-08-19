import React from "react";
import { useVideoStore } from "../store/useVideoStore";
import { CheckCircle2, FolderOpen, RotateCcw, Activity, Loader2, Sparkles } from "lucide-react";

export const RenderSuccess: React.FC = () => {
  const { renderedPath, reset, evaluateQuality, isEvaluatingQuality, metrics } = useVideoStore();

  const handleOpenFolder = () => {
    if (renderedPath) {
      window.electronAPI.showInFolder(renderedPath);
    }
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-8 text-center space-y-6">
      <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
        <CheckCircle2 className="w-10 h-10" />
      </div>

      <div>
        <h3 className="text-xl font-bold text-white mb-1">Оңтайландыру аяқталды!</h3>
        <p className="text-xs text-neutral-400 font-mono truncate max-w-md mx-auto">
          {renderedPath}
        </p>
      </div>

      {/* Сапа карточкасы */}
      {metrics ? (
        <div className="bg-neutral-950/60 border border-neutral-800 rounded-xl p-4 text-left space-y-3">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
            <span className="text-xs font-semibold text-neutral-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-blue-400" /> САПА КӨРСЕТКІШТЕРІ
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
              Өте жоғары сапа
            </span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-neutral-900/80 p-2.5 rounded-lg border border-neutral-800">
              <span className="block text-[10px] text-neutral-500 font-mono mb-0.5">VMAF</span>
              <span className="text-base font-bold text-blue-400 font-mono">
                {metrics.vmaf.toFixed(1)}
              </span>
            </div>
            <div className="bg-neutral-900/80 p-2.5 rounded-lg border border-neutral-800">
              <span className="block text-[10px] text-neutral-500 font-mono mb-0.5">SSIM</span>
              <span className="text-base font-bold text-emerald-400 font-mono">
                {metrics.ssim.toFixed(4)}
              </span>
            </div>
            <div className="bg-neutral-900/80 p-2.5 rounded-lg border border-neutral-800">
              <span className="block text-[10px] text-neutral-500 font-mono mb-0.5">PSNR</span>
              <span className="text-base font-bold text-purple-400 font-mono">
                {metrics.psnr.toFixed(1)} dB
              </span>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={evaluateQuality}
          disabled={isEvaluatingQuality}
          className="w-full py-2.5 bg-neutral-800/80 hover:bg-neutral-800 text-neutral-300 font-medium rounded-xl text-xs flex items-center justify-center gap-2 border border-neutral-700/50 transition disabled:opacity-50"
        >
          {isEvaluatingQuality ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
              Сапа бағалануда...
            </>
          ) : (
            <>
              <Activity className="w-4 h-4 text-blue-400" />
              Сапа көрсеткіштерін тексеру (VMAF / SSIM)
            </>
          )}
        </button>
      )}

      <div className="flex gap-3 justify-center pt-2">
        <button
          onClick={handleOpenFolder}
          className="py-3 px-5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl flex items-center gap-2 text-sm transition shadow-lg shadow-blue-600/20"
        >
          <FolderOpen className="w-4 h-4" />
          Папкада ашу
        </button>

        <button
          onClick={reset}
          className="py-3 px-5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium rounded-xl flex items-center gap-2 text-sm transition"
        >
          <RotateCcw className="w-4 h-4" />
          Басқа видео өңдеу
        </button>
      </div>
    </div>
  );
};
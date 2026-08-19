import React from "react";
import { useVideoStore } from "../store/useVideoStore";
import { Settings2, Play } from "lucide-react";

export const Settings: React.FC = () => {
  const { target, quality, framing, setTarget, setQuality, setFraming, startRender, filePath } =
    useVideoStore();

  const handleRender = async () => {
    if (!filePath) return;
    const outputPath = filePath.replace(/(\.[\w]+)$/, "-optimized.mp4");
    await startRender(outputPath);
  };

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 space-y-6">
      <div className="flex items-center gap-2 border-b border-neutral-800 pb-4">
        <Settings2 className="w-5 h-5 text-blue-400" />
        <h2 className="text-lg font-semibold text-white">Оңтайландыру параметрлері</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-2">ПЛАТФОРМА</label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: "tiktok", label: "TikTok" },
              { id: "instagram_reels", label: "Instagram Reels" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setTarget(item.id as any)}
                className={`py-2.5 px-4 rounded-xl text-sm font-medium transition ${
                  target === item.id
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-2">САПА РЕЖИМІ</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: "quality", label: "Maximum" },
              { id: "balanced", label: "Balanced" },
              { id: "size", label: "Fast / Size" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setQuality(item.id as any)}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition ${
                  quality === item.id
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-neutral-400 mb-2">КАДРЛАУ (9:16)</label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { id: "crop", label: "Crop (Кесу)" },
              { id: "fit", label: "Fit (Полямен)" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setFraming(item.id as any)}
                className={`py-2 px-3 rounded-lg text-xs font-medium transition ${
                  framing === item.id
                    ? "bg-blue-600 text-white"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        onClick={handleRender}
        className="w-full py-3.5 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-blue-600/20"
      >
        <Play className="w-4 h-4 fill-current" />
        Оңтайландыруды бастау
      </button>
    </div>
  );
};
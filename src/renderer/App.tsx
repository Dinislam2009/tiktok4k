import React, { useEffect } from "react";
import { useVideoStore } from "./store/useVideoStore";
import { useAuthStore } from "./store/useAuthStore";
import { Titlebar } from "./components/Titlebar";
import { Dropzone } from "./components/Dropzone";
import { Settings } from "./components/Settings";
import { RenderProgressView } from "./components/RenderProgress";
import { RenderSuccess } from "./components/RenderSuccess";

export const App: React.FC = () => {
  const { filePath, metadata, isAnalyzing, isRendering, renderedPath } = useVideoStore();
  const init = useAuthStore((state) => state.init);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans select-none">
      <Titlebar />

      <div className="flex-1 p-8 max-w-2xl mx-auto w-full flex flex-col justify-center">
        {renderedPath ? (
          <RenderSuccess />
        ) : isRendering ? (
          <RenderProgressView />
        ) : !filePath ? (
          <Dropzone />
        ) : isAnalyzing ? (
          <div className="text-center py-12 text-neutral-400">Анализ жасалуда...</div>
        ) : (
          <div className="space-y-6">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 text-xs font-mono flex justify-between text-neutral-300">
              <span>{metadata?.width as number}x{metadata?.height as number}</span>
              <span>{metadata?.fps as number} FPS</span>
              <span>{((metadata?.bitrate as number) / 1000000).toFixed(1)} Mbps</span>
              <span>{metadata?.videoCodec as string}</span>
            </div>
            <Settings />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;

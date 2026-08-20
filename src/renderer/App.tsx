import React, { useEffect } from "react";[cite: 6]
import { useVideoStore } from "./store/useVideoStore";[cite: 6]
import { useAuthStore } from "./store/useAuthStore";
import { Titlebar } from "./components/Titlebar";[cite: 6]
import { Dropzone } from "./components/Dropzone";[cite: 6]
import { Settings } from "./components/Settings";[cite: 6]
import { RenderProgressView } from "./components/RenderProgress";[cite: 6]
import { RenderSuccess } from "./components/RenderSuccess";[cite: 6]

export const App: React.FC = () => {[cite: 6]
  const { filePath, metadata, isAnalyzing, isRendering, renderedPath } = useVideoStore();[cite: 6]
  const init = useAuthStore((state) => state.init);

  useEffect(() => {
    init(); // Қолданба жүктелгенде авто-авторизацияны іске қосу
  }, [init]);

  return ([cite: 6]
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans select-none">[cite: 6]
      <Titlebar />[cite: 6]

      <div className="flex-1 p-8 max-w-2xl mx-auto w-full flex flex-col justify-center">[cite: 6]
        {renderedPath ? ([cite: 6]
          <RenderSuccess />[cite: 6]
        ) : isRendering ? ([cite: 6]
          <RenderProgressView />[cite: 6]
        ) : !filePath ? ([cite: 6]
          <Dropzone />[cite: 6]
        ) : isAnalyzing ? ([cite: 6]
          <div className="text-center py-12 text-neutral-400">Анализ жасалуда...</div>[cite: 6]
        ) : ([cite: 6]
          <div className="space-y-6">[cite: 6]
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 text-xs font-mono flex justify-between text-neutral-300">[cite: 6]
              <span>{metadata?.width as number}x{metadata?.height as number}</span>[cite: 6]
              <span>{metadata?.fps as number} FPS</span>[cite: 6]
              <span>{((metadata?.bitrate as number) / 1000000).toFixed(1)} Mbps</span>[cite: 6]
              <span>{metadata?.videoCodec as string}</span>[cite: 6]
            </div>[cite: 6]
            <Settings />[cite: 6]
          </div>[cite: 6]
        )}
      </div>[cite: 6]
    </div>[cite: 6]
  );[cite: 6]
};[cite: 6]

export default App;[cite: 6]
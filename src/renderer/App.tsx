import React, { useEffect, useRef, useState } from "react";
import { useVideoStore } from "./store/useVideoStore";
import { Titlebar } from "./components/Titlebar";
import { Dropzone } from "./components/Dropzone";
import { Settings } from "./components/Settings";
import { RenderProgressView } from "./components/RenderProgress";
import { RenderSuccess } from "./components/RenderSuccess";

export const App: React.FC = () => {
  const { filePath, metadata, isAnalyzing, isRendering, renderedPath } = useVideoStore();
  const [user, setUser] = useState<any>(null);
  const telegramContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1. Егер бұл Telegram Mini App ішінде ашылса (авто-логин)
    const tg = (window as any).Telegram?.WebApp;
    if (tg && tg.initDataUnsafe?.user) {
      tg.expand();
      setUser(tg.initDataUnsafe.user);
      return;
    }

    // 2. Егер жай браузерде ашылса, Telegram Widget скриптін жүктеу
    if (telegramContainerRef.current) {
      telegramContainerRef.current.innerHTML = "";
      const script = document.createElement("script");
      script.src = "https://telegram.org/js/telegram-widget.js?22";
      script.setAttribute("data-telegram-login", "tiktokvideo4kbot"); // @ белгісісіз бот аты
      script.setAttribute("data-size", "large");
      script.setAttribute("data-auth-url", "https://tiktok4k.onrender.com/api/auth/telegram-callback");
      script.setAttribute("data-request-access", "write");
      script.async = true;

      telegramContainerRef.current.appendChild(script);
    }
  }, []);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans select-none">
      <Titlebar />

      <div className="flex-1 p-8 max-w-2xl mx-auto w-full flex flex-col justify-center">
        {/* Авторизация блогы */}
        {!user && (
          <div className="mb-6 p-4 bg-neutral-900 border border-neutral-800 rounded-2xl flex flex-col items-center justify-center space-y-3">
            <p className="text-xs text-neutral-400">Бағдарламаны пайдалану үшін Telegram арқылы кіріңіз:</p>
            <div ref={telegramContainerRef} />
          </div>
        )}

        {user && (
          <div className="mb-4 text-center text-xs text-emerald-400 font-medium">
            Қош келдіңіз, {user.first_name || user.username}!
          </div>
        )}

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
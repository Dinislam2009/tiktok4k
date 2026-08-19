import React from "react";
import { Minus, Square, X, RefreshCw, LogIn, User as UserIcon, Crown } from "lucide-react";
import { useVideoStore } from "../store/useVideoStore";
import { useAuthStore } from "../store/useAuthStore";

export const Titlebar: React.FC = () => {
  const { filePath, isRendering, reset } = useVideoStore();
  const { user, plan, dailyLimit, isAuthenticating, startAuth } = useAuthStore();

  return (
    <div className="h-10 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-4 drag select-none">
      <span className="text-xs font-semibold text-neutral-400 tracking-wider flex items-center gap-2">
        SOCIAL VIDEO OPTIMIZER
      </span>

      <div className="flex items-center gap-3 no-drag">
        {user ? (
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded flex items-center gap-1 ${
                plan === "pro_monthly"
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  : "bg-neutral-800 text-neutral-400 border border-neutral-700"
              }`}
            >
              {plan === "pro_monthly" && <Crown className="w-3 h-3 text-amber-400" />}
              {plan === "pro_monthly" ? "PRO" : `FREE (${dailyLimit}/күн)`}
            </span>

            <div className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-full border border-emerald-500/20 font-medium">
              <UserIcon className="w-3.5 h-3.5" />
              <span>@{user.username || user.telegramId}</span>
            </div>
          </div>
        ) : (
          <button
            onClick={startAuth}
            disabled={isAuthenticating}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition bg-blue-500/10 hover:bg-blue-500/20 px-2.5 py-1 rounded-full border border-blue-500/20 disabled:opacity-50"
          >
            <LogIn className="w-3.5 h-3.5" />
            {isAuthenticating ? "Күтілуде..." : "Telegram арқылы кіру"}
          </button>
        )}

        {filePath && !isRendering && (
          <button
            onClick={reset}
            className="text-xs text-neutral-400 hover:text-white flex items-center gap-1 transition ml-2"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Тазалау
          </button>
        )}

        <div className="flex items-center gap-1 ml-2 pl-2 border-l border-neutral-800">
          <button
            onClick={() => window.electronAPI.minimizeWindow()}
            className="p-1.5 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => window.electronAPI.maximizeWindow()}
            className="p-1.5 hover:bg-neutral-800 rounded text-neutral-400 hover:text-white transition"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={() => window.electronAPI.closeWindow()}
            className="p-1.5 hover:bg-red-600 rounded text-neutral-400 hover:text-white transition"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
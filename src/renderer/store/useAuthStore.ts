import { create } from "zustand";[cite: 5]

const API_URL = import.meta.env.VITE_API_URL || "https://tiktok4k.onrender.com";[cite: 5]

interface User {[cite: 5]
  id: string;[cite: 5]
  telegramId: string;[cite: 5]
  username: string | null;[cite: 5]
}

interface AuthStore {[cite: 5]
  user: User | null;[cite: 5]
  plan: string;[cite: 5]
  dailyLimit: string | number;[cite: 5]
  isAuthenticating: boolean;[cite: 5]
  botUrl: string | null;[cite: 5]
  init: () => Promise<void>;
  startAuth: () => Promise<void>;[cite: 5]
  registerCurrentDevice: (userId: string) => Promise<void>;[cite: 5]
  logout: () => void;[cite: 5]
}

function getOrCreateDeviceId(): string {[cite: 5]
  let deviceId = localStorage.getItem("app_device_id");[cite: 5]
  if (!deviceId) {[cite: 5]
    deviceId = crypto.randomUUID();[cite: 5]
    localStorage.setItem("app_device_id", deviceId);[cite: 5]
  }[cite: 5]
  return deviceId;[cite: 5]
}

function loadPersistedUser(): User | null {[cite: 5]
  try {[cite: 5]
    const raw = localStorage.getItem("auth-storage");[cite: 5]
    if (!raw) return null;[cite: 5]
    const parsed = JSON.parse(raw) as { state?: { user?: User | null } };[cite: 5]
    const user = parsed.state?.user;[cite: 5]
    if (!user?.id || !user.telegramId) return null;[cite: 5]
    return user;[cite: 5]
  } catch {[cite: 5]
    localStorage.removeItem("auth-storage");[cite: 5]
    return null;[cite: 5]
  }[cite: 5]
}

function persistAuth(user: User): void {[cite: 5]
  localStorage.setItem("auth-storage", JSON.stringify({ state: { user } }));[cite: 5]
}

function clearPersistedAuth(): void {[cite: 5]
  localStorage.removeItem("auth-storage");[cite: 5]
}

const persistedUser = loadPersistedUser();[cite: 5]

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: persistedUser,[cite: 5]
  plan: "free",[cite: 5]
  dailyLimit: 3,[cite: 5]
  isAuthenticating: false,[cite: 5]
  botUrl: null,[cite: 5]

  init: async () => {
    // 1. Егер Telegram Mini App арқылы ашылса, автоматты түрде Telegram ID арқылы тану
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
      const tgUser = tg.initDataUnsafe.user;
      const user: User = {
        id: String(tgUser.id),
        telegramId: String(tgUser.id),
        username: tgUser.username || null,
      };
      
      persistAuth(user);
      set({ user, isAuthenticating: false });

      try {
        await get().registerCurrentDevice(user.id);
      } catch (err) {
        console.error("Auto Telegram Auth registration error:", err);
      }
      return;
    }

    // 2. Егер бұрын кірген қолданушы сақтаулы тұрса, оның лимиті мен статусын жаңарту
    const currentUser = get().user;
    if (currentUser?.id) {
      try {
        await get().registerCurrentDevice(currentUser.id);
      } catch (err) {
        console.error("Saved user re-validation failed:", err);
      }
    }
  },

  registerCurrentDevice: async (userId: string) => {[cite: 5]
    try {[cite: 5]
      const deviceId = getOrCreateDeviceId();[cite: 5]
      const deviceRes = await fetch(`${API_URL}/api/devices/register`, {[cite: 5]
        method: "POST",[cite: 5]
        headers: { "Content-Type": "application/json" },[cite: 5]
        body: JSON.stringify({ userId, deviceId, name: "Telegram WebApp", platform: "Web" }),[cite: 5]
      });[cite: 5]

      const deviceData = await deviceRes.json().catch(() => ({}));[cite: 5]
      if (!deviceRes.ok) {[cite: 5]
        throw new Error(deviceData.message || deviceData.error || "Device registration failed");[cite: 5]
      }[cite: 5]

      const res = await fetch(`${API_URL}/api/user/status/${userId}`);[cite: 5]
      const data = await res.json().catch(() => ({}));[cite: 5]
      if (!res.ok) {[cite: 5]
        throw new Error(data.message || data.error || "Failed to load user status");[cite: 5]
      }[cite: 5]

      set({ plan: data.plan ?? "free", dailyLimit: data.dailyLimit ?? 3 });[cite: 5]
    } catch (err) {[cite: 5]
      console.error("Device registration error:", err);[cite: 5]
      throw err;[cite: 5]
    }[cite: 5]
  },[cite: 5]

  startAuth: async () => {[cite: 5]
    // Егер Telegram WebApp ішінде ашылса, сілтемеге ауыспай-ақ бірден init()-ті іске қосу
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
      await get().init();
      return;
    }

    set({ isAuthenticating: true, botUrl: null });[cite: 5]

    try {[cite: 5]
      const res = await fetch(`${API_URL}/api/auth/request`, { method: "POST" });[cite: 5]
      const data = await res.json().catch(() => ({}));[cite: 5]

      if (!res.ok || typeof data.sessionId !== "string" || typeof data.botUrl !== "string") {[cite: 5]
        throw new Error(data.message || data.error || "Auth session could not be created");[cite: 5]
      }[cite: 5]

      set({ botUrl: data.botUrl });[cite: 5]

      if (tg?.openTelegramLink) {
        tg.openTelegramLink(data.botUrl);
      } else if (window.electronAPI?.openExternal) {[cite: 5]
        await window.electronAPI.openExternal(data.botUrl);[cite: 5]
      } else {[cite: 5]
        window.open(data.botUrl, "_blank");[cite: 5]
      }[cite: 5]

      const startedAt = Date.now();[cite: 5]
      const interval = window.setInterval(async () => {[cite: 5]
        if (Date.now() - startedAt >= 5 * 60 * 1000) {[cite: 5]
          window.clearInterval(interval);[cite: 5]
          set({ isAuthenticating: false, botUrl: null });[cite: 5]
          return;[cite: 5]
        }[cite: 5]

        try {[cite: 5]
          const checkRes = await fetch(`${API_URL}/api/auth/session/${data.sessionId}`);[cite: 5]

          if (checkRes.status === 410) {[cite: 5]
            window.clearInterval(interval);[cite: 5]
            set({ isAuthenticating: false, botUrl: null });[cite: 5]
            return;[cite: 5]
          }[cite: 5]

          const checkData = await checkRes.json().catch(() => ({}));[cite: 5]

          if ((checkData.status === "APPROVED" || checkData.status === "authenticated") && checkData.user?.id) {[cite: 5]
            window.clearInterval(interval);[cite: 5]
            const user = checkData.user as User;[cite: 5]
            persistAuth(user);[cite: 5]
            set({ user, isAuthenticating: false, botUrl: null });[cite: 5]

            try {[cite: 5]
              await get().registerCurrentDevice(user.id);[cite: 5]
            } catch (error) {[cite: 5]
              console.error("Post-auth device setup failed:", error);[cite: 5]
            }[cite: 5]
          }[cite: 5]
        } catch (error) {[cite: 5]
          console.error("Session check error:", error);[cite: 5]
        }[cite: 5]
      }, 2000);[cite: 5]
    } catch (err) {[cite: 5]
      console.error("Auth request error:", err);[cite: 5]
      set({ isAuthenticating: false, botUrl: null });[cite: 5]
    }[cite: 5]
  },[cite: 5]

  logout: () => {[cite: 5]
    clearPersistedAuth();[cite: 5]
    set({ user: null, plan: "free", dailyLimit: 3, isAuthenticating: false, botUrl: null });[cite: 5]
  },[cite: 5]
}));
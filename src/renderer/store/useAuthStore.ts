import { create } from "zustand";

const API_URL = import.meta.env.VITE_API_URL || "https://tiktok4k.onrender.com";

interface User {
  id: string;
  telegramId: string;
  username: string | null;
}

interface AuthStore {
  user: User | null;
  plan: string;
  dailyLimit: string | number;
  isAuthenticating: boolean;
  botUrl: string | null;
  init: () => Promise<void>;
  startAuth: () => Promise<void>;
  registerCurrentDevice: (userId: string) => Promise<void>;
  logout: () => void;
}

function getOrCreateDeviceId(): string {
  let deviceId = localStorage.getItem("app_device_id");
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("app_device_id", deviceId);
  }
  return deviceId;
}

function loadPersistedUser(): User | null {
  try {
    const raw = localStorage.getItem("auth-storage");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { user?: User | null } };
    const user = parsed.state?.user;
    if (!user?.id || !user.telegramId) return null;
    return user;
  } catch {
    localStorage.removeItem("auth-storage");
    return null;
  }
}

function persistAuth(user: User): void {
  localStorage.setItem("auth-storage", JSON.stringify({ state: { user } }));
}

function clearPersistedAuth(): void {
  localStorage.removeItem("auth-storage");
}

const persistedUser = loadPersistedUser();

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: persistedUser,
  plan: "free",
  dailyLimit: 3,
  isAuthenticating: false,
  botUrl: null,

  init: async () => {
    const tg = (window as any).Telegram?.WebApp;
    
    // 1. Telegram Mini App ашылғанда БЭКЕНДТЕН нақты User ID алу
    if (tg?.initDataUnsafe?.user) {
      const tgUser = tg.initDataUnsafe.user;

      try {
        const res = await fetch(`${API_URL}/api/auth/telegram-webapp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telegramId: String(tgUser.id),
            username: tgUser.username || null,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data.user) {
          const user: User = data.user; // Мұнда базадағы нақты Prisma UUID бар
          persistAuth(user);
          set({ user, isAuthenticating: false });

          try {
            await get().registerCurrentDevice(user.id);
          } catch (err) {
            console.error("Auto device registration error:", err);
          }
          return;
        }
      } catch (err) {
        console.error("Auto Telegram Auth error:", err);
      }
    }

    // 2. Бұрын сақталған сессияны тексеру
    const currentUser = get().user;
    if (currentUser?.id) {
      try {
        await get().registerCurrentDevice(currentUser.id);
      } catch (err) {
        console.error("Saved user re-validation failed:", err);
      }
    }
  },

  registerCurrentDevice: async (userId: string) => {
    try {
      const deviceId = getOrCreateDeviceId();
      const deviceRes = await fetch(`${API_URL}/api/devices/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, deviceId, name: "Telegram WebApp", platform: "Web" }),
      });

      const deviceData = await deviceRes.json().catch(() => ({}));
      if (!deviceRes.ok) {
        throw new Error(deviceData.message || deviceData.error || "Device registration failed");
      }

      const res = await fetch(`${API_URL}/api/user/status/${userId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to load user status");
      }

      set({ plan: data.plan ?? "free", dailyLimit: data.dailyLimit ?? 3 });
    } catch (err) {
      console.error("Device registration error:", err);
      throw err;
    }
  },

  startAuth: async () => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.initDataUnsafe?.user) {
      await get().init();
      return;
    }

    set({ isAuthenticating: true, botUrl: null });

    try {
      const res = await fetch(`${API_URL}/api/auth/request`, { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || typeof data.sessionId !== "string" || typeof data.botUrl !== "string") {
        throw new Error(data.message || data.error || "Auth session could not be created");
      }

      set({ botUrl: data.botUrl });

      if (tg?.openTelegramLink) {
        tg.openTelegramLink(data.botUrl);
      } else if (window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(data.botUrl);
      } else {
        window.open(data.botUrl, "_blank");
      }

      const startedAt = Date.now();
      const interval = window.setInterval(async () => {
        if (Date.now() - startedAt >= 5 * 60 * 1000) {
          window.clearInterval(interval);
          set({ isAuthenticating: false, botUrl: null });
          return;
        }

        try {
          const checkRes = await fetch(`${API_URL}/api/auth/session/${data.sessionId}`);

          if (checkRes.status === 410) {
            window.clearInterval(interval);
            set({ isAuthenticating: false, botUrl: null });
            return;
          }

          const checkData = await checkRes.json().catch(() => ({}));

          if ((checkData.status === "APPROVED" || checkData.status === "authenticated") && checkData.user?.id) {
            window.clearInterval(interval);
            const user = checkData.user as User;
            persistAuth(user);
            set({ user, isAuthenticating: false, botUrl: null });

            try {
              await get().registerCurrentDevice(user.id);
            } catch (error) {
              console.error("Post-auth device setup failed:", error);
            }
          }
        } catch (error) {
          console.error("Session check error:", error);
        }
      }, 2000);
    } catch (err) {
      console.error("Auth request error:", err);
      set({ isAuthenticating: false, botUrl: null });
    }
  },

  logout: () => {
    clearPersistedAuth();
    set({ user: null, plan: "free", dailyLimit: 3, isAuthenticating: false, botUrl: null });
  },
}));
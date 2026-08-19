import { create } from "zustand";

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

function persistAuth(user: User): void {
  localStorage.setItem("auth-storage", JSON.stringify({ state: { user } }));
}

function clearPersistedAuth(): void {
  localStorage.removeItem("auth-storage");
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  plan: "free",
  dailyLimit: 3,
  isAuthenticating: false,
  botUrl: null,

  registerCurrentDevice: async (userId: string) => {
    try {
      const deviceId = getOrCreateDeviceId();
      const deviceRes = await fetch("http://localhost:3000/api/devices/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          deviceId,
          name: "Windows Desktop",
          platform: "Windows",
        }),
      });

      const deviceData = await deviceRes.json().catch(() => ({}));
      if (!deviceRes.ok) {
        throw new Error(deviceData.message || deviceData.error || "Device registration failed");
      }

      const res = await fetch(`http://localhost:3000/api/user/status/${userId}`);
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
    set({ isAuthenticating: true, botUrl: null });

    try {
      const res = await fetch("http://localhost:3000/api/auth/request", { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || typeof data.sessionId !== "string" || typeof data.botUrl !== "string") {
        throw new Error(data.message || data.error || "Auth session could not be created");
      }

      set({ botUrl: data.botUrl });

      if (window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(data.botUrl);
      }

      const startedAt = Date.now();
      const interval = window.setInterval(async () => {
        if (Date.now() - startedAt >= 5 * 60 * 1000) {
          window.clearInterval(interval);
          set({ isAuthenticating: false, botUrl: null });
          return;
        }

        try {
          const checkRes = await fetch(
            `http://localhost:3000/api/auth/session/${data.sessionId}`,
          );

          if (checkRes.status === 410) {
            window.clearInterval(interval);
            set({ isAuthenticating: false, botUrl: null });
            return;
          }

          const checkData = await checkRes.json().catch(() => ({}));

          if (checkData.status === "APPROVED" && checkData.user?.id) {
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
import { create } from "zustand";

const API_BASE_URL = "https://tiktok4k.onrender.com";

interface User {
  id: string;
  telegramId: string;
  username: string | null;
}

interface AuthStore {
  user: User | null;
  token: string | null;
  plan: string;
  dailyLimit: string | number;
  isAuthenticating: boolean;
  botUrl: string | null;
  startAuth: () => Promise<void>;
  registerCurrentDevice: (token: string) => Promise<void>;
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

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  token: localStorage.getItem("app_jwt_token") || null,
  plan: "free",
  dailyLimit: 3,
  isAuthenticating: false,
  botUrl: null,

  registerCurrentDevice: async (token: string) => {
    try {
      const deviceId = getOrCreateDeviceId();
      await fetch(`${API_BASE_URL}/api/devices/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          deviceId,
          name: "Windows Desktop",
          platform: "Windows",
        }),
      });

      const res = await fetch(`${API_BASE_URL}/api/user/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      set({ plan: data.plan, dailyLimit: data.dailyLimit });
    } catch (err) {
      console.error("Device registration error:", err);
    }
  },

  startAuth: async () => {
    set({ isAuthenticating: true, botUrl: null });
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/request`, {
        method: "POST",
      });
      const data = await res.json();
      set({ botUrl: data.botUrl });

      if (data.botUrl && window.electronAPI?.openExternal) {
        await window.electronAPI.openExternal(data.botUrl);
      }

      const interval = setInterval(async () => {
        try {
          const checkRes = await fetch(
            `${API_BASE_URL}/api/auth/session/${data.sessionId}`
          );
          const checkData = await checkRes.json();

          if (checkData.status === "APPROVED" && checkData.token) {
            clearInterval(interval);
            localStorage.setItem("app_jwt_token", checkData.token);
            set({
              user: checkData.user,
              token: checkData.token,
              isAuthenticating: false,
              botUrl: null,
            });
            await get().registerCurrentDevice(checkData.token);
          }
        } catch (e) {
          console.error("Session check error:", e);
        }
      }, 2000);
    } catch (err) {
      console.error("Auth request error:", err);
      set({ isAuthenticating: false });
    }
  },

  logout: () => {
    localStorage.removeItem("app_jwt_token");
    set({ user: null, token: null, plan: "free", dailyLimit: 3 });
  },
}));
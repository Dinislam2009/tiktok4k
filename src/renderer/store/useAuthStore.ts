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

// Компьютердің бірегей Device ID-ін генерациялау / сақтау
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
  plan: "free",
  dailyLimit: 3,
  isAuthenticating: false,
  botUrl: null,

  registerCurrentDevice: async (userId: string) => {
    try {
      const deviceId = getOrCreateDeviceId();
      await fetch("http://localhost:3000/api/devices/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          deviceId,
          name: "Windows Desktop",
          platform: "Windows",
        }),
      });

      const res = await fetch(`http://localhost:3000/api/user/status/${userId}`);
      const data = await res.json();
      set({ plan: data.plan, dailyLimit: data.dailyLimit });
    } catch (err) {
      console.error("Device registration error:", err);
    }
  },

  startAuth: async () => {
    set({ isAuthenticating: true, botUrl: null });
    try {
      const res = await fetch("http://localhost:3000/api/auth/request", {
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
            `http://localhost:3000/api/auth/session/${data.sessionId}`
          );
          const checkData = await checkRes.json();

          if (checkData.status === "APPROVED") {
            clearInterval(interval);
            set({ user: checkData.user, isAuthenticating: false, botUrl: null });
            await get().registerCurrentDevice(checkData.user.id);
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

  logout: () => set({ user: null, plan: "free", dailyLimit: 3 }),
}));
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  selectFile: () => ipcRenderer.invoke("dialog:openFile"),
  analyzeVideo: (filePath: string) => ipcRenderer.invoke("video:analyze", filePath),
  renderVideo: (options: Record<string, unknown>) => ipcRenderer.invoke("video:render", options),
  cancelRender: () => ipcRenderer.invoke("video:cancel"),
  onProgress: (callback: (progress: Record<string, unknown>) => void) => {
    const listener = (_: unknown, value: Record<string, unknown>) => callback(value);
    ipcRenderer.on("video:progress", listener);
    return () => ipcRenderer.removeListener("video:progress", listener);
  },
});
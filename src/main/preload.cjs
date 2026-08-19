const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFile: () => ipcRenderer.invoke("dialog:openFile"),
  analyzeVideo: (filePath) => ipcRenderer.invoke("video:analyze", filePath),
  renderVideo: (options) => ipcRenderer.invoke("video:render", options),
  cancelRender: () => ipcRenderer.invoke("video:cancel"),
  evaluateQuality: (sourcePath, outputPath) => ipcRenderer.invoke("video:evaluateQuality", sourcePath, outputPath),
  showInFolder: (filePath) => ipcRenderer.invoke("shell:showInFolder", filePath),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  maximizeWindow: () => ipcRenderer.invoke("window:maximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  onProgress: (callback) => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on("video:progress", listener);
    return () => ipcRenderer.removeListener("video:progress", listener);
  },
});
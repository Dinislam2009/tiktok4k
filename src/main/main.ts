import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { analyzeVideo } from "../video/analyzer.js";
import { FFmpegRenderer } from "../video/ffmpeg.js";
import { calculateMetrics } from "../video/quality.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
const renderer = new FFmpegRenderer();

// Файл бұрыннан бар болса, бірегей атау генерациялау (авто-инкремент)
function getUniqueOutputPath(targetPath: string): string {
  if (!fs.existsSync(targetPath)) return targetPath;

  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const name = path.basename(targetPath, ext);

  let counter = 1;
  let newPath = path.join(dir, `${name} (${counter})${ext}`);

  while (fs.existsSync(newPath)) {
    counter++;
    newPath = path.join(dir, `${name} (${counter})${ext}`);
  }

  return newPath;
}

function createWindow() {
  const preloadPath = path.join(__dirname, "preload.cjs");

  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("dialog:openFile", async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ["openFile"],
      filters: [{ name: "Videos", extensions: ["mp4", "mov", "mkv", "avi"] }],
    });
    return canceled ? null : filePaths[0];
  });

  ipcMain.handle("video:analyze", async (_, filePath: string) => {
    return await analyzeVideo(filePath);
  });

  ipcMain.handle("video:render", async (_, options) => {
    // Бірегей файл жолын қамтамасыз ету
    const safeOutputPath = getUniqueOutputPath(options.outputPath);

    return await renderer.render(
      { ...options, outputPath: safeOutputPath },
      (progress) => {
        mainWindow?.webContents.send("video:progress", progress);
      }
    );
  });

  ipcMain.handle("video:cancel", async () => {
    renderer.cancel();
    return true;
  });

  ipcMain.handle("video:evaluateQuality", async (_, sourcePath: string, outputPath: string) => {
    return await calculateMetrics(sourcePath, outputPath);
  });

  ipcMain.handle("shell:showInFolder", async (_, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:maximize", () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });
  ipcMain.handle("window:close", () => mainWindow?.close());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
ipcMain.handle("shell:openExternal", async (_, url: string) => {
  await shell.openExternal(url);
});
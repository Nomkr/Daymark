import { app, BrowserWindow, nativeImage, session, dialog, ipcMain, shell } from "electron";
import { stat, readFile, writeFile } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "../server.js";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const singleInstance = app.requestSingleInstanceLock();
let window;
let server;

async function isDirectory(folderPath) {
  if (typeof folderPath !== "string" || !path.isAbsolute(folderPath)) return false;
  try { return (await stat(folderPath)).isDirectory(); } catch { return false; }
}

async function isEditor(file) {
  if (typeof file !== "string" || !path.isAbsolute(file) ||
      !["code.exe", "code - insiders.exe"].includes(path.basename(file).toLowerCase())) return false;
  try { return (await stat(file)).isFile(); } catch { return false; }
}

async function findEditor() {
  const settings = path.join(app.getPath("userData"), "editor.json");
  try {
    const saved = JSON.parse(await readFile(settings, "utf8"));
    if (await isEditor(saved.path)) return saved.path;
  } catch { /* No valid machine-local editor preference. */ }
  const roots = [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"),
    process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean);
  for (const root of roots) {
    for (const [directory, executable] of [["Microsoft VS Code", "Code.exe"],
      ["Microsoft VS Code Insiders", "Code - Insiders.exe"]]) {
      const candidate = path.join(root, directory, executable);
      if (await isEditor(candidate)) return candidate;
    }
  }
  for (const command of ["code", "code-insiders"]) {
    const entries = await new Promise(resolve => execFile(
      path.join(process.env.SystemRoot || "C:\\Windows", "System32", "where.exe"),
      [command], { windowsHide: true, timeout: 3000 },
      (error, stdout) => resolve(error ? [] : stdout.trim().split(/\r?\n/))));
    for (const entry of entries) {
      const candidate = path.join(path.dirname(entry), "..",
        command === "code" ? "Code.exe" : "Code - Insiders.exe");
      if (await isEditor(candidate)) return candidate;
    }
  }
  const result = await dialog.showOpenDialog(window, {
    title: "未找到 VS Code，请选择 Code.exe（取消可跳过）",
    properties: ["openFile"], filters: [{ name: "VS Code", extensions: ["exe"] }],
  });
  if (result.canceled) return "";
  const selected = result.filePaths[0];
  if (!await isEditor(selected)) throw new Error("请选择 Code.exe 或 Code - Insiders.exe");
  await writeFile(settings, JSON.stringify({ path: selected }), "utf8");
  return selected;
}

async function launchVscode(folderPath) {
  const executable = await findEditor();
  if (!executable) return;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ["--new-window", folderPath], {
      detached: true, windowsHide: true, stdio: "ignore", shell: false, env,
    });
    child.once("error", () => reject(new Error("VS Code 启动失败，请检查安装路径和访问权限")));
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

if (!singleInstance) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });

  app
    .whenReady()
    .then(async () => {
      const instance = await startServer({
        port: 0,
        dataDir: path.join(app.getPath("userData"), "data"),
        production: true,
      });
      server = instance.server;
      session.defaultSession.setPermissionRequestHandler(
        (_webContents, _permission, callback) => callback(false),
      );
      function handle(channel, action) {
        ipcMain.handle(channel, async (event, ...args) => {
          if (event.sender !== window?.webContents ||
              event.senderFrame !== window.webContents.mainFrame ||
              new URL(event.senderFrame.url).origin !== new URL(instance.url).origin)
            throw new Error("不允许的桌面请求");
          return action(...args);
        });
      }
      handle("daymark:choose-folder", async () => {
        const result = await dialog.showOpenDialog(window, {
          title: "选择项目文件夹", properties: ["openDirectory"],
        });
        return result.canceled ? "" : result.filePaths[0] || "";
      });
      handle("daymark:open-folder", async (folderPath) => {
        if (!await isDirectory(folderPath)) return "文件夹不存在，请在项目设置中重新选择";
        const error = await shell.openPath(folderPath);
        return error ? "无法打开文件夹，请检查路径和访问权限" : "";
      });
      handle("daymark:open-vscode", async (folderPath) => {
        if (!await isDirectory(folderPath)) return "文件夹不存在，请在项目设置中重新选择";
        try { await launchVscode(folderPath); return ""; }
        catch (error) { return error.message; }
      });

      window = new BrowserWindow({
        title: "Daymark",
        width: 1440,
        height: 900,
        minWidth: 800,
        minHeight: 620,
        show: false,
        icon: nativeImage.createFromPath(
          path.join(appDir, "..", "assets", "daymark.png"),
        ),
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          preload: path.join(appDir, "preload.cjs"),
        },
      });
      window.removeMenu();
      window.once("ready-to-show", () => window.show());
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith(instance.url)) event.preventDefault();
      });
      await window.loadURL(instance.url);

      app.on("window-all-closed", () => app.quit());
      app.on("before-quit", () => server?.close());
    })
    .catch((error) => {
      console.error("Daymark 启动失败:", error);
      app.quit();
    });
}

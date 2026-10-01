const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("daymarkDesktop", {
  chooseFolder: () => ipcRenderer.invoke("daymark:choose-folder"),
  openFolder: (folderPath) => ipcRenderer.invoke("daymark:open-folder", folderPath),
  openVscode: (folderPath) => ipcRenderer.invoke("daymark:open-vscode", folderPath),
});

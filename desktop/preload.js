const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tunnelDeskDesktop", {
  setTheme(theme) {
    if (theme === "dark" || theme === "light") ipcRenderer.send("tunneldesk:set-theme", theme);
  },
  startSftpDrag(files, requestId) {
    ipcRenderer.send("tunneldesk:sftp-start-drag", {
      files:Array.isArray(files) ? files : [],
      requestId:String(requestId || "")
    });
  },
  onSftpDragResult(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, result) => callback(result && typeof result === "object" ? result : {ok:false, message:"无法启动系统拖拽"});
    ipcRenderer.on("tunneldesk:sftp-drag-result", handler);
    return () => ipcRenderer.removeListener("tunneldesk:sftp-drag-result", handler);
  },
  onSftpDragError(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, message) => callback(String(message || "无法启动系统拖拽"));
    ipcRenderer.on("tunneldesk:sftp-drag-error", handler);
    return () => ipcRenderer.removeListener("tunneldesk:sftp-drag-error", handler);
  }
});

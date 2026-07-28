const { contextBridge, ipcRenderer } = require("electron");

const capabilities = Object.freeze(ipcRenderer.sendSync("tunneldesk:capabilities") || {
  platform:process.platform,
  sftpExternalDrag:false
});

contextBridge.exposeInMainWorld("tunnelDeskDesktop", {
  capabilities,
  setTheme(theme) {
    if (theme === "dark" || theme === "light") ipcRenderer.send("tunneldesk:set-theme", theme);
  },
  startSftpDrag(payload, requestId) {
    ipcRenderer.send("tunneldesk:sftp-start-drag", {
      ...(Array.isArray(payload)
        ? {files:payload}
        : {
            connectionId:Number(payload?.connectionId || 0),
            entries:Array.isArray(payload?.entries) ? payload.entries : []
          }),
      requestId:String(requestId || "")
    });
  },
  activateSftpDrag(requestId) {
    ipcRenderer.send("tunneldesk:sftp-drag-activate", {
      requestId:String(requestId || "")
    });
  },
  setSftpDragTarget(requestId, target, options={}) {
    ipcRenderer.send("tunneldesk:sftp-drag-target", {
      requestId:String(requestId || ""),
      target:target && typeof target === "object" ? target : null,
      final:Boolean(options?.final)
    });
  },
  cancelSftpDrag(requestId) {
    ipcRenderer.send("tunneldesk:sftp-drag-cancel", {
      requestId:String(requestId || "")
    });
  },
  onSftpDragEvent(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, result) => callback(result && typeof result === "object" ? result : {});
    ipcRenderer.on("tunneldesk:sftp-drag-event", handler);
    return () => ipcRenderer.removeListener("tunneldesk:sftp-drag-event", handler);
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

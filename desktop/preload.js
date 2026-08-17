const { contextBridge, ipcRenderer } = require("electron");

const capabilities = Object.freeze(ipcRenderer.sendSync("terma:capabilities") || {
  platform:process.platform,
  sftpExternalDrag:false
});

contextBridge.exposeInMainWorld("termaDesktop", {
  capabilities,
  setTheme(theme) {
    if (theme === "dark" || theme === "light") ipcRenderer.send("terma:set-theme", theme);
  },
  setInterfaceLanguage(language) {
    if (language === "zh-CN" || language === "en-US") ipcRenderer.send("terma:set-interface-language", language);
  },
  readClipboardText() {
    return ipcRenderer.invoke("terma:clipboard-read");
  },
  writeClipboardText(text) {
    return ipcRenderer.invoke("terma:clipboard-write", String(text ?? ""));
  },
  readClipboardImage() {
    return ipcRenderer.invoke("terma:clipboard-read-image");
  },
  readClipboardSnapshot(options={}) {
    return ipcRenderer.invoke("terma:clipboard-read-snapshot", {include_image:options?.includeImage === true});
  },
  writeClipboardImage(data) {
    return ipcRenderer.invoke("terma:clipboard-write-image", data);
  },
  openVncWindow(profileId, options={}) {
    return ipcRenderer.invoke("terma:vnc-open-window", {
      profileId:Number(profileId || 0),
      key:String(options?.key || "")
    });
  },
  closeVncWindowForProfile(profileId) {
    return ipcRenderer.invoke("terma:vnc-close-profile-window", {
      profileId:Number(profileId || 0)
    });
  },
  closeVncWindow() {
    return ipcRenderer.invoke("terma:vnc-window-close");
  },
  startSftpDrag(payload, requestId) {
    ipcRenderer.send("terma:sftp-start-drag", {
      ...(Array.isArray(payload)
        ? {files:payload}
        : {
            connectionId:Number(payload?.connectionId || 0),
            entries:Array.isArray(payload?.entries) ? payload.entries : [],
            sourceTabKey:String(payload?.sourceTabKey || "")
          }),
      requestId:String(requestId || "")
    });
  },
  activateSftpDrag(requestId) {
    ipcRenderer.send("terma:sftp-drag-activate", {
      requestId:String(requestId || "")
    });
  },
  setSftpDragTarget(requestId, target, options={}) {
    ipcRenderer.send("terma:sftp-drag-target", {
      requestId:String(requestId || ""),
      target:target && typeof target === "object" ? target : null,
      final:Boolean(options?.final)
    });
  },
  cancelSftpDrag(requestId) {
    ipcRenderer.send("terma:sftp-drag-cancel", {
      requestId:String(requestId || "")
    });
  },
  onSftpDragEvent(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, result) => callback(result && typeof result === "object" ? result : {});
    ipcRenderer.on("terma:sftp-drag-event", handler);
    return () => ipcRenderer.removeListener("terma:sftp-drag-event", handler);
  },
  onSftpDragResult(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, result) => callback(result && typeof result === "object" ? result : {ok:false, message:""});
    ipcRenderer.on("terma:sftp-drag-result", handler);
    return () => ipcRenderer.removeListener("terma:sftp-drag-result", handler);
  },
  onSftpDragError(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, message) => callback(String(message || ""));
    ipcRenderer.on("terma:sftp-drag-error", handler);
    return () => ipcRenderer.removeListener("terma:sftp-drag-error", handler);
  },
  onNotification(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, payload) => callback(payload && typeof payload === "object" ? payload : {});
    ipcRenderer.on("terma:notification-event", handler);
    return () => ipcRenderer.removeListener("terma:notification-event", handler);
  },
  onNotificationAction(callback) {
    if (typeof callback !== "function") return () => {};
    const handler = (_event, action) => callback(action && typeof action === "object" ? action : null);
    ipcRenderer.on("terma:notification-action", handler);
    return () => ipcRenderer.removeListener("terma:notification-action", handler);
  }
});

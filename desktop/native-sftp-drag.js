"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const READY_TIMEOUT_MS = 20_000;
const LINUX_DROP_SETTLE_MS = 150;
const LINUX_CONTENT_COMPLETE_CLOSE_MS = 5_000;
const LINUX_HELPER_TERMINATE_MS = 1_000;
const LINUX_HELPER_FORCE_KILL_MS = 2_000;
const LINUX_CANCEL_CLOSE_GRACE_SECONDS = 10;
const LINUX_CANCEL_HELPER_TERMINATE_MS = 12_000;

function normalizeDesktopLanguage(value) {
  return String(value || "") === "en-US" ? "en-US" : "zh-CN";
}

function desktopUiText(language, chinese, english) {
  return normalizeDesktopLanguage(language) === "en-US" ? english : chinese;
}

function languageGetter(options = {}, environment = process.env) {
  return typeof options.getLanguage === "function"
    ? options.getLanguage
    : () => options.language || environment.TERMA_INTERFACE_LANGUAGE || process.env.TERMA_INTERFACE_LANGUAGE || "zh-CN";
}

function unavailableProbe(platform, reason, getLanguage = () => process.env.TERMA_INTERFACE_LANGUAGE, reasonCode = "") {
  const resolveReason = () => {
    const value = typeof reason === "function" ? reason() : reason;
    return String(value || desktopUiText(getLanguage(), "原生拖出模块不可用", "The native drag-out module is unavailable"));
  };
  return {
    available: false,
    supported: false,
    platform,
    reasonCode:String(reasonCode || ""),
    oneGesture: false,
    delayedContent: false,
    get reason() { return resolveReason(); }
  };
}

function safeProbe(module, platform, getLanguage) {
  try {
    const result = module?.probe?.();
    if (result?.available && result?.supported !== false) return result;
    return unavailableProbe(platform, result?.reason, getLanguage);
  } catch (error) {
    return unavailableProbe(platform, error?.message || error, getLanguage);
  }
}

function linuxHelperCandidates(app) {
  const suffix = process.platform === "win32" ? ".exe" : "";
  const executables = [
    `terma-linux-sftp-dragfs${suffix}`,
    `tunneldesk-linux-sftp-dragfs${suffix}`
  ];
  const resourcesPath = process.resourcesPath || "";
  const directories = [
    resourcesPath && path.join(resourcesPath, "native"),
    path.join(__dirname, "..", "native", "linux-sftp-drag", "prebuilds", `linux-${process.arch}`),
    path.join(__dirname, "..", "native", "linux-sftp-drag", "build"),
    path.join(__dirname, "..", "build", "native", "linux-sftp-drag"),
    path.join(__dirname, "..", "build", "linux-sftp-drag"),
    app?.getAppPath?.() && path.join(app.getAppPath(), "native", "linux-sftp-drag", "build")
  ].filter(Boolean);
  return [...new Set(executables.flatMap(executable =>
    directories.map(directory => path.resolve(directory, executable))
  ))];
}

function findLinuxHelper(app) {
  return linuxHelperCandidates(app).find(candidate => {
    try {
      return fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) || "";
}

function parseJsonLine(line) {
  try {
    return JSON.parse(String(line || "").trim());
  } catch {
    return null;
  }
}

function probeLinuxHelper(helper, getLanguage) {
  const text = (chinese, english) => desktopUiText(getLanguage(), chinese, english);
  if (!helper) return unavailableProbe(
    "linux",
    () => text("Linux SFTP 拖出辅助程序尚未安装", "The Linux SFTP drag-out helper is not installed"),
    getLanguage,
    "linux_helper_missing"
  );
  try {
    const result = spawnSync(helper, ["--probe"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
      windowsHide: true
    });
    const parsed = String(result.stdout || "")
      .split(/\r?\n/)
      .map(parseJsonLine)
      .find(Boolean);
    if (result.status === 0 && parsed?.available !== false && parsed?.supported !== false) {
      return {
        ...parsed,
        available: true,
        supported: true,
        platform: "linux",
        oneGesture: true,
        delayedContent: true,
        mode: "fuse-virtual-files"
      };
    }
    const detail = parsed?.reason || String(result.stderr || "").trim();
    return unavailableProbe(
      "linux",
      detail || (() => text(`辅助程序退出码 ${result.status}`, `Helper exited with code ${result.status}`)),
      getLanguage
    );
  } catch (error) {
    return unavailableProbe("linux", error?.message || error, getLanguage);
  }
}

function dragIcon(nativeImage, iconPath) {
  try {
    return nativeImage.createFromPath(iconPath).resize({width: 16, height: 16, quality: "best"});
  } catch {
    return undefined;
  }
}

function nativeWindowHandle(browserWindow) {
  const handle = browserWindow?.getNativeWindowHandle?.();
  if (!Buffer.isBuffer(handle) || handle.length < 4) return 0n;
  return handle.length >= 8
    ? handle.readBigUInt64LE(0)
    : BigInt(handle.readUInt32LE(0));
}

function normalizedUnixTimeMilliseconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const milliseconds = numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.round(milliseconds)));
}

function createWindowsAdapter(options) {
  const getLanguage = languageGetter(options, options.environment || process.env);
  const text = (chinese, english) => desktopUiText(getLanguage(), chinese, english);
  let module = null;
  try {
    module = require("../native/win-sftp-drag");
  } catch (error) {
    return {
      probe: unavailableProbe("win32", error?.message || error, getLanguage),
      start() {
        throw error;
      },
      activate() { return false; },
      cancel() {},
      setInternalTarget() {},
      completeWrite() {},
      dispose() {}
    };
  }
  const probe = typeof module.activateDrag === "function" && typeof module.setInternalTarget === "function"
    ? safeProbe(module, "win32", getLanguage)
    : unavailableProbe(
      "win32",
      () => text("Windows SFTP 拖出模块版本过旧，请重新编译原生模块", "The Windows SFTP drag-out module is outdated. Rebuild the native module"),
      getLanguage
    );
  const active = new Set();
  return {
    probe,
    start(spec, onEvent) {
      let nativeRequestId = "";
      const topLevel = Array.isArray(spec.ticket?.top_level) ? spec.ticket.top_level : [];
      const immediateItems = topLevel.length && topLevel.every(item =>
        item?.type !== "directory" && item?.metadata_known === true
      ) ? topLevel.map(item => ({
        id:String(item.id ?? ""),
        relativePath:String(item.name || "download"),
        isDirectory:false,
        size:Math.max(0, Number(item.size || 0)),
        mtimeMs:normalizedUnixTimeMilliseconds(item.modified_at)
      })) : null;
      const nativeSpec = {
        token: spec.token,
        manifestUrl: spec.manifestUrl,
        contentBaseUrl: spec.contentBaseUrl,
        timeoutMs:120_000,
        waitForActivation:true,
        armTimeoutMs:10_000,
        sourceWindowHandle:nativeWindowHandle(spec.browserWindow)
      };
      if (immediateItems) nativeSpec.items = immediateItems;
      const result = module.startDrag(nativeSpec, null, event => {
        onEvent(event);
        if (["completed", "cancelled", "error"].includes(event?.type)) active.delete(nativeRequestId || event?.requestId);
      });
      nativeRequestId = result?.requestId || spec.requestId;
      if (nativeRequestId) active.add(nativeRequestId);
      return {nativeId:nativeRequestId};
    },
    activate(nativeId) {
      try { return module.activateDrag(nativeId); } catch { return false; }
    },
    setInternalTarget(nativeId, target) {
      try { return module.setInternalTarget?.(nativeId, Boolean(target)) || false; } catch { return false; }
    },
    cancel(nativeId) {
      try { return module.cancelDrag(nativeId); } catch { return false; }
    },
    completeWrite() {},
    dispose() {
      for (const requestId of active) {
        try { module.cancelDrag(requestId); } catch {}
      }
      active.clear();
    }
  };
}

function createMacAdapter(options) {
  const getLanguage = languageGetter(options, options.environment || process.env);
  let module = null;
  try {
    module = require("../native/macos-sftp-drag");
  } catch (error) {
    return {
      probe: unavailableProbe("darwin", error?.message || error, getLanguage),
      start() {
        throw error;
      },
      cancel() {},
      setInternalTarget() {},
      completeWrite() {},
      dispose() {}
    };
  }
  const probe = safeProbe(module, "darwin", getLanguage);
  return {
    probe,
    start(spec, onEvent) {
      const result = module.startDrag({
        viewHandle: spec.browserWindow.getNativeWindowHandle(),
        token: spec.token,
        sessionId: spec.requestId,
        items: (spec.ticket?.top_level || []).map(item => ({
          id: String(item.id ?? ""),
          name: String(item.name || "download"),
          isDirectory: item.type === "directory",
          size: Number(item.size || 0)
        })),
        dragImagePath: options.iconPath,
        armTimeoutMs: 10_000,
        cssScale: Number(spec.zoomFactor || 1)
      }, onEvent);
      return {nativeId: result?.sessionId || spec.requestId};
    },
    activate() { return true; },
    setInternalTarget(nativeId, target) {
      return module.setInternalTarget(nativeId, target ? JSON.stringify(target) : null);
    },
    cancel(nativeId) {
      try { return module.cancelDrag(nativeId); } catch { return false; }
    },
    completeWrite(requestId, error) {
      return module.completeWrite(requestId, error || null);
    },
    dispose() {
      try { module.dispose(); } catch {}
    }
  };
}

function createLinuxAdapter(options) {
  const getLanguage = languageGetter(options, options.environment || process.env);
  const text = (chinese, english) => desktopUiText(getLanguage(), chinese, english);
  const helper = findLinuxHelper(options.app);
  const probe = probeLinuxHelper(helper, getLanguage);
  const children = new Map();
  const completedCloseMs = Math.max(
    20,
    Number(options.linuxContentCompleteCloseMs || LINUX_CONTENT_COMPLETE_CLOSE_MS)
  );
  const helperTerminateMs = Math.max(
    20,
    Number(options.linuxHelperTerminateMs || LINUX_HELPER_TERMINATE_MS)
  );
  const helperForceKillMs = Math.max(
    20,
    Number(options.linuxHelperForceKillMs || LINUX_HELPER_FORCE_KILL_MS)
  );
  const cancelCloseGraceSeconds = Math.max(
    1,
    Number(options.linuxCancelCloseGraceSeconds || LINUX_CANCEL_CLOSE_GRACE_SECONDS)
  );
  const cancelHelperTerminateMs = Math.max(
    20,
    Number(options.linuxCancelHelperTerminateMs || LINUX_CANCEL_HELPER_TERMINATE_MS)
  );

  return {
    probe,
    start(spec, onEvent) {
      if (!probe.available) throw new Error(probe.reason || text("Linux SFTP 拖出辅助程序不可用", "The Linux SFTP drag-out helper is unavailable"));
      const child = spawn(helper, [
        "--ticket-url-fd", "3",
        "--close-grace-seconds", String(cancelCloseGraceSeconds)
      ], {
        stdio: ["pipe", "pipe", "pipe", "pipe"],
        windowsHide: true
      });
      const state = {
        child,
        cancelled:false,
        ready:false,
        activated:false,
        dragStarted:false,
        dragReleased:false,
        consuming:false,
        contentComplete:false,
        readError:"",
        internalTarget:false,
        files:[],
        terminal:false,
        onEvent,
        finalizeTimer:null,
        completedCloseTimer:null,
        helperTerminateTimer:null,
        helperForceKillTimer:null,
        helperExited:false,
        cleanupTerminationRequested:false,
        startDrag:null,
        finishInternalDrop:null,
        scheduleCompletedClose:null,
        scheduleHelperTermination:null
      };
      children.set(spec.requestId, state);
      child.stdio[3].end(`${spec.manifestUrl}\n`, "utf8");

      let settled = false;
      let stdout = "";
      let stderr = "";
      const fail = (message) => {
        if (settled) return;
        settled = true;
        clearHelperTerminationTimers();
        state.terminal = true;
        clearTimeout(timeout);
        children.delete(spec.requestId);
        state.cleanupTerminationRequested = true;
        try { child.kill("SIGTERM"); } catch {}
        state.scheduleHelperTermination?.("failure");
        onEvent({
          type:"error",
          requestId:spec.requestId,
          message:String(message || text("Linux 原生拖出启动失败", "Linux native drag-out failed to start"))
        });
      };
      const timeout = setTimeout(() => fail(text("Linux 原生拖出辅助程序启动超时", "Linux native drag-out helper startup timed out")), READY_TIMEOUT_MS);

      const cursorEvent = type => {
        const event = {type, requestId:spec.requestId};
        try {
          const point = options.screen?.getCursorScreenPoint?.();
          if (Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
            event.screenX = Number(point.x);
            event.screenY = Number(point.y);
          }
        } catch {}
        return event;
      };

      const clearHelperTerminationTimers = () => {
        if (state.completedCloseTimer) clearTimeout(state.completedCloseTimer);
        if (state.helperTerminateTimer) clearTimeout(state.helperTerminateTimer);
        if (state.helperForceKillTimer) clearTimeout(state.helperForceKillTimer);
        state.completedCloseTimer = null;
        state.helperTerminateTimer = null;
        state.helperForceKillTimer = null;
      };

      const scheduleHelperTermination = (reason, delayMs=helperTerminateMs) => {
        if (state.helperExited || state.helperTerminateTimer || state.helperForceKillTimer) return;
        state.helperTerminateTimer = setTimeout(() => {
          state.helperTerminateTimer = null;
          if (state.helperExited) return;
          if (options.debug) {
            onEvent({type:"cleanupTerminate", requestId:spec.requestId, message:String(reason || "")});
          }
          state.cleanupTerminationRequested = true;
          try { child.kill("SIGTERM"); } catch {}
          state.helperForceKillTimer = setTimeout(() => {
            state.helperForceKillTimer = null;
            if (state.helperExited) return;
            if (options.debug) {
              onEvent({type:"cleanupForceKill", requestId:spec.requestId, message:String(reason || "")});
            }
            try { child.kill("SIGKILL"); } catch {}
          }, helperForceKillMs);
        }, Math.max(20, Number(delayMs || helperTerminateMs)));
      };
      state.scheduleHelperTermination = scheduleHelperTermination;

      const finishAfterHelperClose = () => {
        if (state.terminal) return;
        clearHelperTerminationTimers();
        state.terminal = true;
        if (state.cancelled) {
          onEvent({type:"cancelled", requestId:spec.requestId});
          return;
        }
        if (state.readError) {
          onEvent({type:"error", requestId:spec.requestId, message:state.readError});
          return;
        }
        if (!state.contentComplete) {
          onEvent({type:"cancelled", requestId:spec.requestId});
          return;
        }
        onEvent({type:"completed", requestId:spec.requestId, dropEffect:"copy"});
      };

      const scheduleCompletedClose = () => {
        if (
          state.completedCloseTimer
          || state.terminal
          || state.cancelled
          || state.internalTarget
          || !state.dragReleased
          || !state.contentComplete
        ) return;
        if (options.debug) {
          onEvent({
            type:"cleanupScheduled",
            requestId:spec.requestId,
            delayMs:completedCloseMs
          });
        }
        state.completedCloseTimer = setTimeout(() => {
          state.completedCloseTimer = null;
          if (
            state.terminal
            || state.cancelled
            || state.internalTarget
            || !state.dragReleased
            || !state.contentComplete
          ) return;
          // Every requested byte has already been returned through FUSE.
          // File managers can retain bookkeeping handles long after copying,
          // so close the virtual mount deterministically after a short grace.
          try {
            const accepted = child.stdin.write(`${JSON.stringify({command:"shutdown"})}\n`);
            if (options.debug) {
              onEvent({
                type:"cleanupRequested",
                requestId:spec.requestId,
                accepted,
                writable:Boolean(child.stdin.writable),
                destroyed:Boolean(child.stdin.destroyed)
              });
            }
          } catch (error) {
            if (options.debug) {
              onEvent({
                type:"cleanupRequestError",
                requestId:spec.requestId,
                message:error?.message || String(error)
              });
            }
          }
          scheduleHelperTermination("content-complete");
        }, completedCloseMs);
      };
      state.scheduleCompletedClose = scheduleCompletedClose;

      const finishInternalDrop = () => {
        if (state.terminal || !state.internalTarget || !state.dragReleased) return false;
        clearHelperTerminationTimers();
        state.terminal = true;
        onEvent({type:"completed", requestId:spec.requestId, dropEffect:"copy"});
        try { child.stdin.write(`${JSON.stringify({command:"cancel"})}\n`); } catch {}
        scheduleHelperTermination("internal-drop");
        return true;
      };
      state.finishInternalDrop = finishInternalDrop;

      state.startDrag = () => {
        if (!state.ready || !state.activated || state.dragStarted || state.cancelled || state.terminal) return false;
        state.dragStarted = true;
        onEvent({type: "started", requestId: spec.requestId});
        try {
          spec.webContents.startDrag({
            file: state.files[0],
            files: state.files,
            icon: dragIcon(options.nativeImage, options.iconPath)
          });
          onEvent(cursorEvent("motion"));
          // Renderer-to-main target updates are queued while Electron's
          // synchronous startDrag call owns the main thread. Give those IPC
          // messages one short turn to arrive before deciding whether this
          // was an internal cross-host drop or an external FUSE delivery.
          state.finalizeTimer = setTimeout(() => {
            state.finalizeTimer = null;
            if (state.terminal) return;
            if (state.cancelled) {
              state.terminal = true;
              onEvent({type:"cancelled", requestId:spec.requestId});
              try { child.stdin.write(`${JSON.stringify({command:"cancel"})}\n`); } catch {}
              return;
            }
            state.dragReleased = true;
            onEvent(cursorEvent("released"));
            if (finishInternalDrop()) return;
            try { child.stdin.write(`${JSON.stringify({command:"release"})}\n`); } catch {}
            scheduleCompletedClose();
          }, LINUX_DROP_SETTLE_MS);
          return true;
        } catch (error) {
          state.terminal = true;
          onEvent({type: "error", requestId: spec.requestId, message: error?.message || String(error)});
          try { child.stdin.write(`${JSON.stringify({command: "cancel"})}\n`); } catch {}
          scheduleHelperTermination("start-drag-error");
          return false;
        }
      };

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", chunk => {
        stderr = `${stderr}${chunk}`.slice(-4096);
      });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => {
        stdout += chunk;
        let newline;
        while ((newline = stdout.indexOf("\n")) >= 0) {
          const line = stdout.slice(0, newline);
          stdout = stdout.slice(newline + 1);
          const message = parseJsonLine(line);
          if (!message) continue;
          if (
            options.debug
            && ["released", "closing", "closed"].includes(message.event)
          ) {
            onEvent({
              type:`helper-${message.event}`,
              requestId:spec.requestId,
              message:String(message.message || "")
            });
          }
          if (message.event === "consuming") {
            state.consuming = true;
            onEvent({type:"consuming", requestId:spec.requestId});
            continue;
          }
          if (message.event === "content-complete") {
            state.contentComplete = true;
            onEvent({type:"contentComplete", requestId:spec.requestId});
            scheduleCompletedClose();
            continue;
          }
          if (message.event === "read-error") {
            state.readError = String(message.message || text("Linux SFTP 拖出内容读取失败", "Linux SFTP drag content read failed"));
            onEvent({
              type:"contentError",
              requestId:spec.requestId,
              message:state.readError
            });
            try { child.stdin.write(`${JSON.stringify({command:"shutdown"})}\n`); } catch {}
            scheduleHelperTermination("read-error");
            continue;
          }
          if (message.event === "closing") {
            if (!state.contentComplete && !state.internalTarget && !state.readError) state.cancelled = true;
            scheduleHelperTermination(
              message.message || "helper-closing",
              state.cancelled ? cancelHelperTerminateMs : helperTerminateMs
            );
            continue;
          }
          if (message.event === "lease-warning" || message.event === "control-error") {
            console.warn(`Linux native SFTP drag ${message.event}:`, message.message || message);
            continue;
          }
          if (message.event === "closed") {
            if (settled && state.dragReleased) finishAfterHelperClose();
            continue;
          }
          if (message.event !== "ready" || settled) continue;
          if (state.cancelled) {
            settled = true;
            state.terminal = true;
            clearTimeout(timeout);
            onEvent({type: "cancelled", requestId: spec.requestId});
            try { child.kill(); } catch {}
            return;
          }
          const files = Array.isArray(message.paths)
            ? message.paths.map(item => path.resolve(String(item || ""))).filter(Boolean)
            : [];
          if (!files.length) return fail(text("Linux 原生拖出辅助程序没有返回可拖出的文件", "The Linux native drag-out helper returned no files to drag"));
          settled = true;
          state.ready = true;
          state.files = files;
          // If activation arrived before the FUSE mount was ready, wait for
          // the renderer's post-ready acknowledgement. This guarantees that
          // pointerup can distinguish a native drag from a pending gesture.
          state.activated = false;
          clearTimeout(timeout);
          onEvent({type: "ready", requestId: spec.requestId});
        }
      });
      child.once("error", error => {
        if (!state.cancelled) fail(error?.message || error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timeout);
        if (state.finalizeTimer) clearTimeout(state.finalizeTimer);
        state.helperExited = true;
        clearHelperTerminationTimers();
        children.delete(spec.requestId);
        if (!settled && state.cancelled) {
          settled = true;
          if (!state.terminal) {
            state.terminal = true;
            onEvent({type: "cancelled", requestId: spec.requestId});
          }
          return;
        }
        if (settled && !state.terminal) {
          if (state.cancelled || state.readError) finishAfterHelperClose();
          else if (
            state.dragReleased
            && state.contentComplete
            && !state.readError
            && (code === 0 || state.cleanupTerminationRequested)
          ) finishAfterHelperClose();
          else {
            state.terminal = true;
            onEvent({
              type: "error",
              requestId: spec.requestId,
              message: stderr.trim()
                || text(
                  `Linux 原生 SFTP 拖出辅助程序在完成前退出（${signal || code}）`,
                  `Linux native SFTP drag helper exited before completion (${signal || code})`
                )
            });
          }
          return;
        }
        if (!settled) fail(stderr.trim() || text(
          `Linux 原生拖出辅助程序已退出（${signal || code}）`,
          `The Linux native drag-out helper exited (${signal || code})`
        ));
      });
      return {nativeId: spec.requestId};
    },
    activate(nativeId) {
      const state = children.get(nativeId);
      if (!state || state.cancelled || state.terminal) return false;
      state.activated = true;
      state.startDrag?.();
      return true;
    },
    setInternalTarget(nativeId, target) {
      const state = children.get(nativeId);
      if (!state || state.cancelled || state.terminal) return false;
      state.internalTarget = Boolean(target);
      if (state.internalTarget) state.finishInternalDrop?.();
      return true;
    },
    cancel(nativeId) {
      const state = children.get(nativeId);
      if (!state) return false;
      state.cancelled = true;
      for (const timer of [
        state.completedCloseTimer,
        state.helperTerminateTimer,
        state.helperForceKillTimer
      ]) {
        if (timer) clearTimeout(timer);
      }
      state.completedCloseTimer = null;
      state.helperTerminateTimer = null;
      state.helperForceKillTimer = null;
      try {
        state.child.stdin.write(`${JSON.stringify({command: "cancel"})}\n`);
      } catch {}
      // The FUSE helper first returns ECANCELED to the target and waits for
      // its open handles to drain. A one-second SIGTERM races that graceful
      // path and turns cancellation back into ENOTCONN/HTTP read errors.
      state.scheduleHelperTermination?.("cancel-timeout", cancelHelperTerminateMs);
      if (!state.dragStarted) {
        state.terminal = true;
        state.onEvent({type: "cancelled", requestId: nativeId});
        try { state.child.kill("SIGTERM"); } catch {}
      }
      return true;
    },
    completeWrite() {},
    dispose() {
      for (const state of children.values()) {
        for (const timer of [
          state.completedCloseTimer,
          state.helperTerminateTimer,
          state.helperForceKillTimer
        ]) {
          if (timer) clearTimeout(timer);
        }
        state.completedCloseTimer = null;
        state.helperTerminateTimer = null;
        state.helperForceKillTimer = null;
        try { state.child.stdin.write(`${JSON.stringify({command: "shutdown"})}\n`); } catch {}
        state.cleanupTerminationRequested = true;
        try { state.child.kill("SIGTERM"); } catch {}
        state.scheduleHelperTermination?.("dispose");
      }
      children.clear();
    }
  };
}

function createNativeSftpDrag(options = {}) {
  const platform = options.platform || process.platform;
  const getLanguage = languageGetter(options, options.environment || process.env);
  const text = (chinese, english) => desktopUiText(getLanguage(), chinese, english);
  const adapter = platform === "win32"
    ? createWindowsAdapter(options)
    : platform === "darwin"
      ? createMacAdapter(options)
      : platform === "linux"
        ? createLinuxAdapter(options)
        : {
            probe: unavailableProbe(
              platform,
              () => text("当前平台不支持原生 SFTP 拖出", "Native SFTP drag-out is not supported on this platform"),
              getLanguage
            ),
            start() {
              throw new Error(text("当前平台不支持原生 SFTP 拖出", "Native SFTP drag-out is not supported on this platform"));
            },
            activate() { return false; },
            cancel() {},
            setInternalTarget() {},
            completeWrite() {},
            dispose() {}
          };
  return {
    ...adapter,
    capabilities() {
      return {
        platform,
        sftpExternalDrag: adapter.probe.available ? "streaming" : "staged",
        sftpNativeDragStart: adapter.probe.available ? "pointerdown" : "leave-window",
        sftpNativeDragProtocol: adapter.probe.protocol || adapter.probe.mode || "",
        sftpNativeDragReasonCode: adapter.probe.available ? "" : adapter.probe.reasonCode || "",
        sftpNativeDragReason: adapter.probe.available ? "" : adapter.probe.reason || text("原生拖出模块不可用", "The native drag-out module is unavailable")
      };
    }
  };
}

module.exports = {
  __linuxHelperCandidates: linuxHelperCandidates,
  __findLinuxHelper: findLinuxHelper,
  __nativeWindowHandle: nativeWindowHandle,
  __parseJsonLine: parseJsonLine,
  createNativeSftpDrag
};

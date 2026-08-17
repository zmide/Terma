"use strict";

const path = require("node:path");

function withX11WindowGuardFallback(target) {
  if (!target) return target;
  if (typeof target.getClipboardSequenceNumber !== "function") {
    Object.defineProperty(target, "getClipboardSequenceNumber", {
      value() {
        return 0;
      },
    });
  }
  if (typeof target.startX11WindowGuard !== "function") {
    Object.defineProperty(target, "startX11WindowGuard", {
      value() {
        return false;
      },
    });
  }
  if (typeof target.stopX11WindowGuard !== "function") {
    Object.defineProperty(target, "stopX11WindowGuard", {
      value() {
        return false;
      },
    });
  }
  if (typeof target.getX11WindowGuardDiagnostics !== "function") {
    Object.defineProperty(target, "getX11WindowGuardDiagnostics", {
      value() {
        return {running:false, hookInstalled:false, hookError:0, processId:0};
      },
    });
  }
  return target;
}

function loadBinding() {
  if (process.platform !== "win32") {
    return null;
  }

  const candidates = [
    path.join(__dirname, "prebuilds", `${process.platform}-${process.arch}`, "win_sftp_drag.node"),
    path.join(__dirname, "build", "Release", "win_sftp_drag.node"),
  ];

  let lastError = null;
  let compatibleFallback = null;
  for (const candidate of candidates) {
    try {
      const loaded = require(candidate);
      if (
        typeof loaded.startX11WindowGuard === "function" &&
        typeof loaded.stopX11WindowGuard === "function"
      ) {
        return loaded;
      }
      compatibleFallback ||= loaded;
    } catch (error) {
      if (error && error.code !== "MODULE_NOT_FOUND") {
        lastError = error;
      }
    }
  }

  if (compatibleFallback) {
    return compatibleFallback;
  }
  if (lastError) {
    throw lastError;
  }
  return null;
}

let binding = null;
try {
  binding = withX11WindowGuardFallback(loadBinding());
} catch (error) {
  binding = withX11WindowGuardFallback({
    probe() {
      return {
        available: false,
        supported: false,
        platform: "win32",
        apiVersion: 1,
        delayed: true,
        reason: error instanceof Error ? error.message : String(error),
      };
    },
    startDrag() {
      throw error;
    },
    activateDrag() {
      return false;
    },
    setInternalTarget() {
      return false;
    },
    cancelDrag() {
      return false;
    },
  });
}

module.exports = binding || withX11WindowGuardFallback({
  probe() {
    return {
      available: false,
      supported: false,
      platform: process.platform,
      apiVersion: 1,
      delayed: true,
      reason: "Windows native drag module is unavailable on this platform",
    };
  },
  getClipboardSequenceNumber() {
    return 0;
  },
  startDrag() {
    throw new Error("Windows native drag module is unavailable on this platform");
  },
  activateDrag() {
    return false;
  },
  setInternalTarget() {
    return false;
  },
  cancelDrag() {
    return false;
  },
});

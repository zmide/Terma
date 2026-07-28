"use strict";

const path = require("node:path");

function loadBinding() {
  if (process.platform !== "win32") {
    return null;
  }

  const candidates = [
    path.join(__dirname, "prebuilds", `${process.platform}-${process.arch}`, "win_sftp_drag.node"),
    path.join(__dirname, "build", "Release", "win_sftp_drag.node"),
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error && error.code !== "MODULE_NOT_FOUND") {
        lastError = error;
      }
    }
  }

  if (lastError) {
    throw lastError;
  }
  return null;
}

let binding = null;
try {
  binding = loadBinding();
} catch (error) {
  binding = {
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
  };
}

module.exports = binding || {
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
};

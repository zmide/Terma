"use strict";

const path = require("node:path");

function unavailable(reason) {
  return {
    probe() {
      return {
        available: false,
        supported: false,
        platform: process.platform,
        apiVersion: 1,
        delayed: true,
        mode: "file-promise",
        reason
      };
    },
    startDrag() {
      throw new Error(reason);
    },
    completeWrite() {
      return false;
    },
    cancelDrag() {
      return false;
    },
    setInternalTarget() {
      return false;
    },
    dispose() {}
  };
}

if (process.platform !== "darwin") {
  module.exports = unavailable(
    "Terma macOS SFTP 拖出模块只能在 macOS 上加载"
  );
} else {
  const candidates = [
    path.join(
      __dirname,
      "build",
      "Release",
      "terma_macos_sftp_drag.node"
    ),
    path.join(
      __dirname,
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "terma_macos_sftp_drag.node"
    ),
    path.join(
      __dirname,
      "build",
      "Release",
      "tunneldesk_macos_sftp_drag.node"
    ),
    path.join(
      __dirname,
      "prebuilds",
      `${process.platform}-${process.arch}`,
      "tunneldesk_macos_sftp_drag.node"
    )
  ];
  let binding = null;
  let lastError = null;
  for (const candidate of candidates) {
    try {
      binding = require(candidate);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  module.exports =
    binding ||
    unavailable(
      lastError instanceof Error
        ? lastError.message
        : "macOS SFTP 原生拖出模块尚未编译"
    );
}

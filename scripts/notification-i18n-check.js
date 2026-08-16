const assert = require("node:assert/strict");

const {
  localizeNotificationEvent,
  localizeNotificationText,
  normalizeNotificationLanguage
} = require("../dist/notifications");

assert.equal(normalizeNotificationLanguage("en-US"), "en-US");
assert.equal(normalizeNotificationLanguage("invalid"), "zh-CN");

const batch = localizeNotificationEvent({
  title:"批量命令部分失败",
  message:"批量执行-8月14日 21:15:24，成功 2 个，失败 1 个",
  action:{title:"批量执行-8月14日 21:15:24"}
}, "en-US");
assert.equal(batch.title, "Some batch commands failed");
assert.equal(batch.message, "Batch execution - 8/14 21:15:24: 2 succeeded, 1 failed");
assert.equal(batch.action.title, "Batch execution - 8/14 21:15:24");

assert.equal(
  localizeNotificationText("Game · package.zip\n已保存到 C:\\Users\\tester\\Downloads\\package.zip", "en-US"),
  "Game · package.zip\nSaved to C:\\Users\\tester\\Downloads\\package.zip"
);
assert.equal(
  localizeNotificationText("Game · 下载 switchcodex.service\n已保存到 D:\\Downloads\\switchcodex.service", "en-US"),
  "Game · Download switchcodex.service\nSaved to D:\\Downloads\\switchcodex.service"
);
assert.equal(localizeNotificationText("Source → Target · 4 项", "en-US"), "Source → Target · 4 items");
assert.equal(
  localizeNotificationText("当前版本 1.4.6，最新版本 1.4.7（Release）。", "en-US"),
  "Current version: 1.4.6; latest version: 1.4.7 (Release)."
);
assert.equal(
  localizeNotificationText("Game / local\n远端返回的原始错误", "en-US"),
  "Game / local\n远端返回的原始错误",
  "remote error text must remain unchanged"
);
assert.equal(localizeNotificationText("SFTP 上传已完成", "zh-CN"), "SFTP 上传已完成");

console.log("Notification internationalization checks passed.");

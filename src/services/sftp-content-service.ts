const { RUNTIME_SETTINGS_FILE } = require("../config");
const { readRuntimeSettings } = require("../runtime-settings");
const { encodeRemoteText } = require("../sftp");

function prepareSftpWriteContent(content, encoding = "utf8") {
  const maximumMb = readRuntimeSettings(RUNTIME_SETTINGS_FILE).sftp_max_open_file_size_mb;
  const maximumBytes = maximumMb * 1024 * 1024;
  const encoded = encodeRemoteText(content, encoding);
  if (encoded.length > maximumBytes) throw new Error(`在线编辑内容不能超过 ${maximumMb} MB`);
  return {content:encoded, maximum_bytes:maximumBytes};
}

module.exports = { prepareSftpWriteContent };

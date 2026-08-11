function decodeRemotePosixCommand(command) {
  const source = String(command || "");
  const match = /\bterma_payload=([A-Za-z0-9+/=]+);/.exec(source);
  return match ? Buffer.from(match[1], "base64").toString("utf8") : source;
}

module.exports = { decodeRemotePosixCommand };

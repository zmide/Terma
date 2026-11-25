function decodeRemotePosixCommand(command) {
  const source = String(command || "");
  const match = /\bterma_payload=([A-Za-z0-9+/=]+);/.exec(source);
  return match ? Buffer.from(match[1], "base64").toString("utf8") : source;
}

function receiveRemotePosixCommand(command, input, receive) {
  if (command !== "/bin/sh -s") return receive(decodeRemotePosixCommand(command));
  const chunks = [];
  input.on("data", chunk => chunks.push(chunk));
  input.once("end", () => receive(Buffer.concat(chunks).toString("utf8").trimEnd()));
}

module.exports = { decodeRemotePosixCommand, receiveRemotePosixCommand };

"use strict";
// Executed by the same desktop runtime after the Windows UAC prompt.
const net = require("node:net");
const {startLocalProcess} = require("./local-terminal-process");
const [pipe, token, profile] = process.argv.slice(2);
if (!/^\\\\\.\\pipe\\terma-local-[a-f0-9]{32}$/.test(pipe || "") || !/^[a-f0-9]{64}$/.test(token || "")
    || !["cmd","powershell"].includes(profile)) process.exit(2);
const socket = net.connect(pipe);
socket.setEncoding("utf8");
let child, pending = "";
const send = value => socket.write(JSON.stringify(value) + "\n");
socket.on("connect", () => {
  send({type:"auth", token});
  child = startLocalProcess(profile, {cols:100, rows:24}, value => {
    send(value); if (value.type === "exit" || value.type === "error") socket.end();
  });
  send({type:"ready", pty:child.pty});
});
socket.on("data", chunk => {
  pending += chunk.toString("utf8");
  if (pending.length > 262144) return socket.destroy();
  let end;
  while ((end = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1);
    try {
      const value = JSON.parse(line);
      if (value.type === "write" && typeof value.data === "string" && value.data.length <= 65536) child?.write(value.data);
      if (value.type === "resize" && Number.isInteger(value.cols) && Number.isInteger(value.rows)
        && value.cols >= 2 && value.cols <= 500 && value.rows >= 1 && value.rows <= 300) child?.resize(value.cols,value.rows);
      if (value.type === "close") socket.end();
    } catch {socket.destroy();}
  }
});
socket.on("error", () => socket.destroy());
socket.on("close", () => {try {child?.close();} finally {process.exit(0);}});

"use strict";
const crypto = require("node:crypto");
const net = require("node:net");
const path = require("node:path");
const {spawn} = require("node:child_process");
const {shellProfile, startLocalProcess, detectedShellProfiles} = require("./local-terminal-process");

const validId = value => typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
const size = value => ({cols:Math.max(2, Math.min(500, Math.floor(Number(value?.cols) || 100))),
  rows:Math.max(1, Math.min(300, Math.floor(Number(value?.rows) || 24)))});
const psQuote = value => "'" + String(value).replace(/'/g, "''") + "'";

function createLocalTerminals({ipcMain, allowed, launch = startLocalProcess, spawnProcess = spawn}) {
  const records = new Map();
  const watchedSenders = new WeakSet();
  function assertSender(event) {if (!allowed(event)) throw new Error("LOCAL_TERMINAL_SOURCE_DENIED");}
  ipcMain.handle("terma:local-terminal-profiles", event => {
    assertSender(event);
    return detectedShellProfiles().map(({id, label}) => ({id, label}));
  });
  function own(event, id) {
    assertSender(event);
    const record = records.get(id);
    if (!record || record.sender !== event.sender) throw new Error("LOCAL_TERMINAL_NOT_FOUND");
    return record;
  }
  function close(id) {
    const record = records.get(id); if (!record) return;
    records.delete(id); clearTimeout(record.timer);
    try {record.child?.close();} catch { /* An exited PTY can already be gone; ownership is released above. */ }
    record.socket?.destroy(); if (record.server?.listening) record.server.close();
  }
  function elevated(record, profile, dimensions) {
    const pipe = `\\\\.\\pipe\\terma-local-${crypto.randomBytes(16).toString("hex")}`;
    const token = crypto.randomBytes(32).toString("hex");
    record.server = net.createServer(socket => {
      if (!records.has(record.id)) return socket.destroy();
      let pending = "", authenticated = false;
      socket.setEncoding("utf8");
      socket.setTimeout(5000, () => {if (!authenticated) socket.destroy();});
      socket.on("error", () => socket.destroy());
      socket.on("data", chunk => {
        pending += chunk.toString("utf8");
        if (pending.length > 262144) return socket.destroy();
        let end;
        while ((end = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, end); pending = pending.slice(end + 1);
          let value; try {value = JSON.parse(line);} catch {return socket.destroy();}
          if (!authenticated) {
            if (value.type !== "auth" || value.token !== token || record.socket) return socket.destroy();
            authenticated = true; socket.setTimeout(0); record.socket = socket; clearTimeout(record.timer);
            record.server.close();
            record.child = {write:data => socket.write(JSON.stringify({type:"write",data})+"\n"),
              resize:(cols,rows) => socket.write(JSON.stringify({type:"resize",cols,rows})+"\n"),
              close:() => socket.end(JSON.stringify({type:"close"})+"\n")};
          } else if (["data","ready","exit","error"].includes(value.type)) {
            if (value.type === "ready") record.child.resize(dimensions.cols, dimensions.rows);
            record.emit(value);
          }
        }
      });
      socket.on("close", () => {if (authenticated && records.has(record.id)) {record.emit({type:"exit"}); close(record.id);}});
    });
    record.server.on("error", () => {record.emit({type:"error",code:"LOCAL_TERMINAL_FAILED"}); close(record.id);});
    record.server.listen(pipe, () => {
      if (!records.has(record.id)) {record.server.close(); return;}
      const helper = path.join(__dirname,"local-terminal-elevated.js");
      // Fixed executable and validated profile; no renderer-supplied command or path reaches RunAs.
      const args = [helper, pipe, token, profile].map(value => '"' + value.replace(/"/g, '\\"') + '"').join(" ");
      const script = `$env:ELECTRON_RUN_AS_NODE='1';try {Start-Process -FilePath ${psQuote(process.execPath)} -ArgumentList ${psQuote(args)} -Verb RunAs -WindowStyle Hidden -ErrorAction Stop | Out-Null} catch {exit 1}`;
      const launcher = spawnProcess(shellProfile("powershell").file, ["-NoLogo","-NoProfile","-NonInteractive","-EncodedCommand",Buffer.from(script,"utf16le").toString("base64")],
        {windowsHide:true,stdio:"ignore"});
      launcher.on("error", () => {record.emit({type:"error",code:"LOCAL_TERMINAL_FAILED"}); close(record.id);});
      launcher.on("exit", code => {if (code && records.has(record.id)) {record.emit({type:"error",code:"LOCAL_TERMINAL_CANCELLED"}); close(record.id);}});
    });
    record.timer = setTimeout(() => {record.emit({type:"error",code:"LOCAL_TERMINAL_TIMEOUT"}); close(record.id);}, 60000);
  }
  ipcMain.handle("terma:local-terminal-start", (event, value = {}) => {
    assertSender(event);
    if (!validId(value.id) || records.has(value.id) || records.size >= 12 || typeof value.elevated !== "boolean") throw new Error("LOCAL_TERMINAL_INVALID");
    shellProfile(value.profile);
    if (value.elevated && process.platform !== "win32") throw new Error("LOCAL_TERMINAL_INVALID");
    const record = {id:value.id, sender:event.sender};
    record.emit = payload => {
      if (!records.has(record.id) || record.sender.isDestroyed()) return;
      if (payload.type === "data") {
        if (typeof payload.data !== "string") return;
        for (let offset = 0; offset < payload.data.length; offset += 65536)
          record.sender.send("terma:local-terminal-event", {id:record.id,type:"data",data:payload.data.slice(offset,offset+65536)});
      } else record.sender.send("terma:local-terminal-event", {id:record.id,type:payload.type,pty:payload.pty === true});
      if (payload.type === "exit" || payload.type === "error") close(record.id);
    };
    records.set(record.id, record);
    if (!watchedSenders.has(event.sender)) {
      watchedSenders.add(event.sender);
      event.sender.once("destroyed", () => {for (const item of records.values()) if (item.sender === event.sender) close(item.id);});
      event.sender.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace) for (const item of records.values()) if (item.sender === event.sender) close(item.id);
      });
    }
    try {
      if (value.elevated) elevated(record, value.profile, size(value));
      else {
        record.child = launch(value.profile, size(value), record.emit);
        if (!records.has(record.id)) {record.child.close(); return {id:record.id};}
        record.emit({type:"ready",pty:record.child.pty});
      }
    } catch {close(record.id); throw new Error("LOCAL_TERMINAL_FAILED");}
    return {id:record.id};
  });
  ipcMain.handle("terma:local-terminal-write", (event, value = {}) => {
    const record = own(event, value.id);
    if (typeof value.data !== "string" || value.data.length > 65536) throw new Error("LOCAL_TERMINAL_INVALID");
    record.child?.write(value.data); return {ok:true};
  });
  ipcMain.handle("terma:local-terminal-resize", (event, value = {}) => {
    const record = own(event, value.id), next = size(value);
    record.child?.resize(next.cols,next.rows); return {ok:true};
  });
  ipcMain.handle("terma:local-terminal-close", (event, value = {}) => {own(event,value.id); close(value.id); return {ok:true};});
  return {dispose() {for (const id of records.keys()) close(id);}, count:() => records.size};
}
module.exports = {createLocalTerminals, validId, size};

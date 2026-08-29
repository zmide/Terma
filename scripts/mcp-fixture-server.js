"use strict";

process.stdin.setEncoding("utf8");
let buffer = "";

function send(id, result) {
  process.stdout.write(`${JSON.stringify({jsonrpc:"2.0", id, result})}\n`);
}

process.stdin.on("data", chunk => {
  buffer += chunk;
  const lines = buffer.split(/\r?\n/);
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (!Number.isFinite(Number(message.id))) continue;
    if (message.method === "initialize") send(message.id, {protocolVersion:"2025-06-18", capabilities:{tools:{}}, serverInfo:{name:"terma-fixture", version:"1"}});
    else if (message.method === "tools/list") send(message.id, {tools:[{name:"echo", description:"Echo fixture input", inputSchema:{type:"object", properties:{text:{type:"string"}}}}]});
    else if (message.method === "tools/call") send(message.id, {content:[{type:"text", text:String(message.params?.arguments?.text || "")}], isError:false});
    else send(message.id, {});
  }
});

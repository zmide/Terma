const path = require("node:path");

const { secureHeaders } = require("./security");

function readBody(req, maxBytes = 100 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req): Promise<any> {
  const body = await readBody(req, 2 * 1024 * 1024);
  return body.length ? JSON.parse(body.toString("utf8")) : {};
}

function safeUploadName(value) {
  return path.basename(String(value || "upload.bin")).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "upload.bin";
}

function send(res, status, data, headers = {}) {
  const binary = Buffer.isBuffer(data) || data instanceof Uint8Array;
  const body = Buffer.isBuffer(data)
    ? data
    : data instanceof Uint8Array
      ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
      : Buffer.from(typeof data === "string" ? data : JSON.stringify(data), "utf8");
  res.writeHead(status, {
    "Content-Length":body.length,
    "Content-Type":binary ? "application/octet-stream" : (typeof data === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8"),
    ...secureHeaders(headers)
  });
  res.end(body);
}

function sendJson(res, data, status = 200) {
  send(res, status, data, {"Content-Type":"application/json; charset=utf-8"});
}

module.exports = {
  readBody,
  readJson,
  safeUploadName,
  send,
  sendJson
};

const {
  getNativeSftpDragTicket,
  openNativeSftpDragTicketFile
} = require("../sftp-session");
const {
  beginNativeSftpDragJob,
  trackNativeSftpDragStream,
  waitForSftpTransferStart
} = require("../sftp-jobs");
const { secureHeaders } = require("../security");
const { send, sendJson } = require("../http-response");

function nativeDragByteRange(value, size) {
  const header = String(value || "").trim();
  if (!header) return {start:0, end:Math.max(-1, size - 1), partial:false};
  const match = /^bytes=(\d+)-(\d*)$/i.exec(header);
  if (!match) return null;
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) return null;
  return {start, end:Math.min(size - 1, requestedEnd), partial:true};
}

async function streamNativeSftpDragContent(req, res, token, index) {
  const ticket = await getNativeSftpDragTicket(token);
  const entry = ticket.entries[Number(index)];
  if (!entry || entry.type !== "file") return sendJson(res, {error:"拖出文件不存在"}, 404);
  const range = nativeDragByteRange(req.headers.range, Number(entry.size || 0));
  if (!range) return send(res, 416, "", {
    "Content-Range":`bytes */${Math.max(0, Number(entry.size || 0))}`,
    "Accept-Ranges":"bytes",
    "Cache-Control":"no-store"
  });
  const task = beginNativeSftpDragJob(token, ticket);
  if (task.status === "discarded") return sendJson(res, {error:"拖出已转为跨主机复制"}, 410);
  try {
    await waitForSftpTransferStart(task.id);
  } catch (error) {
    return sendJson(res, {error:error?.message || "拖出下载已取消"}, 409);
  }
  const opened = await openNativeSftpDragTicketFile(token, index, range);
  trackNativeSftpDragStream(token, index, opened);
  const headers: any = {
    "Content-Type":"application/octet-stream",
    "Content-Length":opened.length,
    "Content-Disposition":`attachment; filename="${encodeURIComponent(entry.name || "download")}"`,
    "Accept-Ranges":"bytes",
    "Cache-Control":"no-store"
  };
  if (range.partial) headers["Content-Range"] = `bytes ${opened.start}-${opened.end}/${opened.total}`;
  res.writeHead(range.partial ? 206 : 200, secureHeaders(headers));
  let completed = false;
  const close = () => {
    if (completed) return;
    completed = true;
    try { opened.stream.destroy(); } catch {}
  };
  req.once("aborted", close);
  res.once("close", close);
  opened.stream.once("error", error => {
    if (!res.headersSent) return sendJson(res, {error:error?.message || "远端文件读取失败"}, 500);
    try { res.destroy(error); } catch {}
  });
  opened.stream.pipe(res);
}

module.exports = {
  nativeDragByteRange,
  streamNativeSftpDragContent
};

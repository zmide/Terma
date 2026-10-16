import fs from "node:fs";
import path from "node:path";
import { IncomingMessage, ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { listServerFiles, mutateServerFiles, readServerText, writeServerText, serverFilePath, serverFileTree, serverFileName, resolveServerDirectory, validateServerReceiveTarget } from "../services/server-files-service";
import { publicError } from "../public-error";
const security = require("../security");
const local = require("../local-files");
const sftp = require("../sftp-session");
const jobs = require("../sftp-jobs");

interface Dependencies {
  readJson(request: IncomingMessage): Promise<any>;
  sendJson(response: ServerResponse, data: unknown, status?: number): void;
  authorizeConnectionId(request: IncomingMessage, value: string): number;
}

export async function handleServerFilesRoutes(req: IncomingMessage, res: ServerResponse, pathname: string, dependencies: Dependencies): Promise<boolean> {
  if (pathname !== "/api/server-files" && !pathname.startsWith("/api/server-files/")) return false;
  // Direct local browsers retain the standard app's local access policy.
  // Network/proxy requests and fnOS still require an actual login session.
  const directLocal = process.env.TERMA_DISTRIBUTION !== "fnos" && security.isDirectLoopbackRequest(req) && !security.authRequired(req);
  if (!directLocal && !security.hasAuthenticatedWebSession(req) && !security.isDesktopRequest(req)) throw publicError("SERVER_FILES_LOGIN_REQUIRED", "请先登录 Terma，再访问设备目录", {}, 403);
  const url = new URL(req.url || pathname,"http://terma.invalid");
  const action = pathname.slice("/api/server-files".length).replace(/^\//,"");
  const value = url.searchParams.get("path") || "";
  if (req.method === "GET" && action === "resolve") {
    dependencies.sendJson(res,{path:resolveServerDirectory(value)}); return true;
  }
  if (req.method === "GET" && !action) {
    dependencies.sendJson(res,listServerFiles(value,Object.fromEntries(url.searchParams))); return true;
  }
  if (req.method === "GET" && action === "text") {
    dependencies.sendJson(res,{content:readServerText(value)}); return true;
  }
  if (req.method === "GET" && action === "download") {
    const file = serverFilePath(value);
    const descriptor = fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink > 1) {fs.closeSync(descriptor); throw publicError("SERVER_FILES_PATH_DENIED", "此目录未授权，或包含受保护文件",{},403);}
    res.writeHead(200,security.secureHeaders({"Content-Type":"application/octet-stream","Content-Length":stat.size,"Cache-Control":"no-store","Content-Disposition":"attachment; filename*=UTF-8''"+encodeURIComponent(path.basename(file))}));
    try {await pipeline(fs.createReadStream(file,{fd:descriptor,autoClose:true}),res);} catch (error) {if (!res.destroyed) throw error;}
    return true;
  }
  if (req.method === "POST" && action === "upload-content") {
    const directory = serverFilePath(value);
    const name = serverFileName(url.searchParams.get("name"));
    const virtual = value+"/"+name;
    const target = serverFilePath(virtual,{missing:true,mutable:true});
    const temporary = path.join(directory,".terma-upload-"+require("node:crypto").randomUUID());
    let bytes = 0;
    try {
      const output = fs.createWriteStream(temporary,{flags:"wx",mode:0o600});
      req.on("data",(chunk: Buffer) => {bytes += chunk.length; if (bytes > 1024*1024*1024) req.destroy();});
      await pipeline(req,output);
      serverFilePath(virtual,{missing:true,mutable:true});
      // Linking the completed private temporary file avoids overwriting an
      // existing destination, including one created during the upload.
      fs.linkSync(temporary,target);
      dependencies.sendJson(res,{ok:true});
    } finally {try {fs.unlinkSync(temporary);} catch {}}
    return true;
  }
  if (req.method !== "POST") return false;
  const data = await dependencies.readJson(req);
  if (["create","rename","delete"].includes(action)) {dependencies.sendJson(res,mutateServerFiles(action,data)); return true;}
  if (action === "text") {writeServerText(data.path,data.content); dependencies.sendJson(res,{ok:true}); return true;}
  if (action === "upload") {
    const connectionId = dependencies.authorizeConnectionId(req,String(data.connection_id));
    if (!Array.isArray(data.paths) || !data.paths.length || data.paths.length > 100) throw publicError("SERVER_FILES_LIMIT", "一次最多操作 1000 个文件和目录");
    const count = {count:0};
    const paths = data.paths.map((value: string) => {serverFileTree(value,count); return serverFilePath(value);});
    dependencies.sendJson(res,await local.uploadLocalPaths(connectionId,paths,data.target || ".",data.conflict || "error"),202); return true;
  }
  if (["receive-plan","receive"].includes(action)) {
    const connectionId = dependencies.authorizeConnectionId(req,String(data.connection_id));
    const target = serverFilePath(data.target);
    const plan = sftp.planSftpPathDelivery(data.paths || [],target);
    for (const item of plan.items) serverFilePath(String(data.target)+"/"+serverFileName(item.name),{missing:true,mutable:true});
    if (action === "receive-plan") dependencies.sendJson(res,{items:plan.items.map((item: any)=>({name:item.name,exists:item.exists,type:item.exists && fs.lstatSync(item.target).isFile()?"file":"dir"}))});
    // Explicit file replacement is reauthorized immediately before each
    // commit. Directory conflicts retain separately named copies.
    else dependencies.sendJson(res,jobs.startLocalDeliveryJob(connectionId,data.paths || [],target,data.conflict==="overwrite"?"overwrite":"rename",{
      validateTarget:({source,target:destination,overwrite}:any)=>validateServerReceiveTarget(String(data.target),source,destination,overwrite)
    }),202);
    return true;
  }
  return false;
}

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { publicError } from "../public-error";

const config = require("../config");
const local = require("../local-files");
export const SERVER_FILES_TEXT_LIMIT = 1024 * 1024;
const inside = (value: string, parent: string) => {
  const relative=path.relative(parent,value);
  return !relative || (!path.isAbsolute(relative) && relative!==".." && !relative.startsWith(".."+path.sep));
};
const denied = () => publicError("SERVER_FILES_PATH_DENIED", "此目录未授权，或包含受保护文件", {}, 403);

function real(value: string): string { return fs.existsSync(value) ? fs.realpathSync(value) : path.resolve(value); }

let computerRoots: {expires:number; paths:string[]} = {expires:0,paths:[]};

export function serverFileRoots(): {id:string; directory:string; name:string; root_kind:string}[] {
  const workspace = path.join(config.DATA_DIR, "files");
  if (!fs.existsSync(workspace)) fs.mkdirSync(workspace, {recursive:true, mode:0o700});
  if (fs.lstatSync(workspace).isSymbolicLink()) throw denied();
  let supplied: unknown = [];
  if (process.env.TERMA_FILE_ROOTS) {
    try { supplied = JSON.parse(process.env.TERMA_FILE_ROOTS); } catch { throw denied(); }
    if (!Array.isArray(supplied) || supplied.length > 32) throw denied();
  }
  const platform = process.env.TERMA_DISTRIBUTION === "fnos"
    ? [process.env.TRIM_DATA_ACCESSIBLE_PATHS, process.env.TRIM_DATA_SHARE_PATHS].flatMap(value => String(value || "").split(":")) : [];
  const fullDevice=process.env.TERMA_DISTRIBUTION!=="fnos" && !process.env.TERMA_FILE_ROOTS;
  if(fullDevice && computerRoots.expires<Date.now()) computerRoots={expires:Date.now()+30000,paths:local.listLocalComputer({page_size:200}).entries.filter((entry:any)=>entry.ready!==false).map((entry:any)=>entry.path)};
  const system=fullDevice ? computerRoots.paths : [];
  return [...new Set([workspace, ...(supplied as string[]), ...platform, ...system].filter(value => typeof value === "string" && path.isAbsolute(value)))].flatMap(value => {
    try {
      const directory = fs.realpathSync(value);
      if (!fs.statSync(directory).isDirectory()) return [];
      if (directory !== real(workspace) && protectedServerPath(directory)) return [];
      const root_kind=directory===real(workspace)?"workspace":system.includes(value)?"system":"authorized";
      return [{id:crypto.createHash("sha256").update(directory).digest("hex").slice(0,16), directory, name:root_kind==="system"?directory:path.basename(directory) || directory, root_kind}];
    } catch { return []; }
  }).filter((value, index, all) => all.findIndex(item => item.id === value.id) === index);
}

function protectedMutationAncestor(value:string):boolean {
  return [config.DATA_DIR,config.SSH_DIR,config.USER_SSH_DIR,config.BASE_DIR,
    path.join(require("node:os").homedir(),".codex"),path.join(require("node:os").homedir(),".config")]
    .some(directory=>inside(real(directory),value));
}

function protectedServerPath(value: string): boolean {
  const workspace = real(path.join(config.DATA_DIR, "files"));
  if (inside(value, workspace)) return false;
  const home = require("node:os").homedir();
  return [config.DATA_DIR, config.SSH_DIR, config.USER_SSH_DIR, config.BASE_DIR,
    path.join(home,".ssh"), path.join(home,".codex"), path.join(home,".config"),
    ...(["/etc","/proc","/sys","/dev","/var/apps"].filter(() => process.platform !== "win32"))]
    .some(directory => inside(value, real(directory)));
}

export function serverFilePath(value: unknown, options: {missing?:boolean; mutable?:boolean} = {}): string {
  const requested = String(value || "");
  const parts = requested.split("/");
  if (parts.shift() !== "" || !parts.length || parts.some(part => !part || part === "." || part === ".." || part.startsWith(".terma-upload-") || part.startsWith(".terma-edit-") || /[\\\0\x00-\x1f]/.test(part) || (process.platform==="win32" && /[<>:"|?*]/.test(part)))) throw denied();
  const root = serverFileRoots().find(item => item.id === parts[0]);
  if (!root || (options.mutable && parts.length === 1)) throw denied();
  let current = root.directory;
  if (protectedServerPath(current)) throw denied();
  for (const [index, part] of parts.slice(1).entries()) {
    current = path.join(current, part);
    if (protectedServerPath(current)) throw denied();
    if (options.missing && index === parts.length - 2 && !fs.existsSync(current)) {
      // lstat also detects dangling links, which existsSync does not.
      try { fs.lstatSync(current); throw denied(); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
      break;
    }
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink > 1)) throw denied();
    if (!inside(fs.realpathSync(current), root.directory)) throw denied();
  }
  if(options.mutable && protectedMutationAncestor(current)) throw denied();
  return current;
}

export function resolveServerDirectory(value:unknown):string {
  if(typeof value!=="string" || !path.isAbsolute(value) || /[\0\r\n]/.test(value)) throw denied();
  const directory=path.resolve(value);
  const root=serverFileRoots().filter(item=>inside(directory,item.directory)).sort((a,b)=>b.directory.length-a.directory.length)[0];
  if(!root)throw denied();
  const relative=path.relative(root.directory,directory).split(path.sep).filter(Boolean).join("/");
  const virtual="/"+root.id+(relative?"/"+relative:"");
  if(!fs.statSync(serverFilePath(virtual)).isDirectory())throw denied();
  return virtual;
}

export function serverFileName(value: unknown): string {
  const name = String(value || "");
  if (!name || name.length > 255 || name === "." || name === ".." || /[\\/\x00-\x1f]/.test(name) || (process.platform==="win32" && (/[<>:"|?*]/.test(name) || /[. ]$/.test(name) || /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name)))) throw denied();
  return name;
}

export function validateServerReceiveTarget(directory: string, source: string, target: string, overwrite: boolean): void {
  const actualDirectory=serverFilePath(directory);
  if(path.relative(actualDirectory,path.dirname(target)) || path.relative(serverFilePath(directory+"/"+serverFileName(path.basename(target)),{missing:true,mutable:true}),target))throw denied();
  if(overwrite && fs.existsSync(target) && (!fs.lstatSync(target).isFile() || !fs.lstatSync(source).isFile()))throw publicError("SERVER_FILES_OVERWRITE_FILE_ONLY","覆盖仅适用于同名文件；文件夹请选择重命名",{},409);
}

export function serverFileTree(value: string, counter = {count:0}): void {
  const directory = serverFilePath(value);
  if (++counter.count > 1000) throw publicError("SERVER_FILES_LIMIT", "一次最多操作 1000 个文件和目录");
  if (fs.statSync(directory).isDirectory()) for (const name of fs.readdirSync(directory)) serverFileTree(value + "/" + name, counter);
}

export function listServerFiles(value: string, options: any = {}): any {
  if (!value) return {kind:"computer", path:"", platform:process.platform, entries:serverFileRoots().map(root => ({name:root.name, path:"/"+root.id, display_path:root.directory, root_kind:root.root_kind, type:"drive", size:0, mtime:0})), total_pages:1};
  const directory = serverFilePath(value);
  const result = local.listLocalDirectory(directory, {...options, defaultDirectory:directory});
  const entries = result.entries.flatMap((entry: any) => {
    const virtual = value + "/" + entry.name;
    try { serverFilePath(virtual); return [{...entry, path:virtual}]; } catch { return []; }
  });
  return {...result, platform:process.platform, path:value, display_path:serverFileDisplayPath(value), entries,
    parent:value.includes("/",1) ? value.slice(0,value.lastIndexOf("/")) : "", parent_kind:value.includes("/",1) ? "directory" : "computer"};
}

export function serverFileDisplayPath(value: string): string {
  return serverFilePath(value);
}

export function mutateServerFiles(action: string, data: any): any {
  if (action === "create") {
    const directory = serverFilePath(data.directory);
    const name = serverFileName(data.name);
    serverFilePath(data.directory + "/" + name, {missing:true, mutable:true});
    local.createLocalEntry(directory, name, data.type);
    return {ok:true};
  }
  if (action === "rename") {
    const source = serverFilePath(data.path, {mutable:true});
    const name = serverFileName(data.new_name);
    serverFilePath(String(data.path).slice(0,String(data.path).lastIndexOf("/")) + "/" + name, {missing:true, mutable:true});
    local.renameLocalPath(source, name); return {ok:true};
  }
  if (action === "delete") {
    if (!Array.isArray(data.paths) || !data.paths.length || data.paths.length > 100) throw denied();
    const paths = data.paths.map((value: string) => {serverFileTree(value); return serverFilePath(value,{mutable:true});});
    local.deleteLocalPaths(paths); return {ok:true};
  }
  throw denied();
}

export function readServerText(value: string): string {
  const descriptor = fs.openSync(serverFilePath(value), fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink > 1 || stat.size > SERVER_FILES_TEXT_LIMIT) throw publicError("SERVER_FILES_TEXT_LIMIT", "只可编辑不超过 1 MiB 的 UTF-8 文本文件");
    const bytes = fs.readFileSync(descriptor);
    if (bytes.includes(0)) throw publicError("SERVER_FILES_TEXT_LIMIT", "只可编辑不超过 1 MiB 的 UTF-8 文本文件");
    try { return new TextDecoder("utf-8",{fatal:true}).decode(bytes); } catch { throw publicError("SERVER_FILES_TEXT_LIMIT", "只可编辑不超过 1 MiB 的 UTF-8 文本文件"); }
  } finally { fs.closeSync(descriptor); }
}

export function writeServerText(value: string, content: unknown): void {
  const target = serverFilePath(value,{mutable:true});
  if (typeof content !== "string" || Buffer.byteLength(content) > SERVER_FILES_TEXT_LIMIT) throw publicError("SERVER_FILES_TEXT_LIMIT", "只可编辑不超过 1 MiB 的 UTF-8 文本文件");
  let descriptor = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const temporary = path.join(path.dirname(target),".terma-edit-"+crypto.randomUUID());
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || stat.nlink > 1) throw denied();
    fs.writeFileSync(temporary,content,{flag:"wx",mode:stat.mode & 0o777});
    fs.closeSync(descriptor); descriptor = -1;
    serverFilePath(value,{mutable:true});
    fs.renameSync(temporary,target);
  } finally {if(descriptor>=0)fs.closeSync(descriptor);try{fs.unlinkSync(temporary);}catch{}}
}

const crypto = require("node:crypto");
const path = require("node:path");
const { remotePathOperand, shellQuote } = require("./sftp-job-paths");

function buildCrossCopyOverwriteCommand(targetConnection: any, targetDir: string, names: string[]) {
  const temporaryName = `.terma-cross-copy-${crypto.randomUUID()}`;
  const temporaryRoot = `./${temporaryName}`;
  const incomingRoot = `${temporaryRoot}/incoming`;
  const backupRoot = `${temporaryRoot}/backup`;
  const replacements: string[] = [];
  const rollback: string[] = [];
  names.forEach((name, index) => {
    const target = remotePathOperand(targetConnection, `./${name}`);
    const staged = remotePathOperand(targetConnection, `${incomingRoot}/${name}`);
    const backup = shellQuote(`${backupRoot}/${index}`);
    const marker = shellQuote(`${temporaryRoot}/placed-${index}`);
    replacements.push(`(if [ -e ${target} ] || [ -L ${target} ]; then mv -- ${target} ${backup}; fi) && : > ${marker} && mv -- ${staged} ${target}`);
    rollback.unshift(`if [ -e ${marker} ]; then rm -rf -- ${target}; fi; if [ -e ${backup} ] || [ -L ${backup} ]; then mv -- ${backup} ${target}; fi`);
  });
  const rollbackBody = rollback.join("; ");
  return [
    `cd ${remotePathOperand(targetConnection, targetDir)} || exit $?`,
    `td_tmp=${shellQuote(temporaryName)}`,
    `mkdir -- "$td_tmp" || exit $?`,
    "td_committed=0",
    `td_rollback() { td_status=$?; trap - 0 1 2 3 15; if [ "$td_committed" -ne 1 ]; then ${rollbackBody}; fi; rm -rf -- "$td_tmp"; exit "$td_status"; }`,
    "trap td_rollback 0 1 2 3 15",
    `(mkdir -- "$td_tmp/incoming" "$td_tmp/backup" && tar -xf - -C "$td_tmp/incoming" && ${replacements.join(" && ")})`,
    "td_status=$?",
    "if [ \"$td_status\" -ne 0 ]; then exit \"$td_status\"; fi",
    "td_committed=1",
    "rm -rf -- \"$td_tmp\"",
    "td_status=$?",
    "trap - 0 1 2 3 15",
    "exit \"$td_status\""
  ].join("; ");
}

function crossCopyProgressEntries(paths: string[], entries: any[]) {
  const allowed = new Set(paths);
  const byPath = new Map<string, any>();
  for (const source of Array.isArray(entries) ? entries : []) {
    const remotePath = path.posix.normalize(String(source?.path || "").replace(/\\/g, "/"));
    if (!allowed.has(remotePath) || byPath.has(remotePath)) continue;
    byPath.set(remotePath, {
      path:remotePath,
      type:["dir", "directory"].includes(String(source?.type || "")) ? "directory" : "file",
      size:Math.max(0, Number(source?.size || 0)),
      metadataKnown:Boolean(source?.metadataKnown)
    });
  }
  return paths.map(remotePath => byPath.get(remotePath) || {path:remotePath, type:"file", size:0, metadataKnown:false});
}

function buildItemProgressJobCommand(connection: any, action: string, paths: unknown, targetDir: string) {
  const source = [...new Set((Array.isArray(paths) ? paths : []).map(item => String(item || "").replace(/\\/g, "/")).filter(Boolean))];
  if (!source.length) throw new Error(`请选择要${action === "copy" ? "复制" : "移动"}的文件`);
  if (source.length > 200 || source.some(item => item.includes("\0") || item.length > 4096)) throw new Error("远程路径无效或数量过多");
  const marker = `__TERMA_JOB_${crypto.randomBytes(12).toString("hex")}__:`;
  const commandName = action === "copy" ? "cp -a" : "mv";
  const target = remotePathOperand(connection, targetDir);
  const commands = source.map((item, index) => (
    `(${commandName} -- ${remotePathOperand(connection, item)} ${target}) && printf '%s\\n' ${shellQuote(`${marker}${index + 1}`)}`
  ));
  return {command:commands.join(" && "), marker, itemCount:source.length};
}

function normalizeCompressionRequest(paths: unknown, targetDir = ".", archiveName = "", connection: any = null) {
  const source = Array.isArray(paths) ? paths : [paths];
  const normalizedPaths = [...new Set(source.map((item) => path.posix.normalize(String(item || "").replace(/\\/g, "/"))).filter(Boolean))];
  if (!normalizedPaths.length) throw new Error("请选择要压缩的文件或目录");
  if (normalizedPaths.length > 200) throw new Error("一次最多压缩 200 个文件或目录");
  if (normalizedPaths.some((item) => item === "." || item === ".." || item.startsWith("../") || item.includes("\0") || item.length > 4096)) throw new Error("压缩路径无效");
  const parent = path.posix.dirname(normalizedPaths[0]) || ".";
  if (normalizedPaths.some((item) => (path.posix.dirname(item) || ".") !== parent)) throw new Error("多选压缩必须选择同一目录下的项目");
  const target = path.posix.normalize(String(targetDir || parent).replace(/\\/g, "/")) || ".";
  if (target !== parent) throw new Error("压缩目标必须是所选项目所在目录");
  const requestedName = String(archiveName || "").trim().replace(/\\/g, "/");
  if (requestedName.includes("/") || requestedName.includes("\0")) throw new Error("压缩包名称不能包含路径");
  let name = path.posix.basename(requestedName);
  if (!name || name === "." || name === "..") name = normalizedPaths.length === 1 ? `${path.posix.basename(normalizedPaths[0])}.tar.gz` : "archive.tar.gz";
  if (!/\.(?:tar\.gz|tgz)$/i.test(name)) name = `${name}.tar.gz`;
  if (Buffer.byteLength(name, "utf8") > 255) throw new Error("压缩包名称过长");
  const output = path.posix.join(target, name);
  if (normalizedPaths.includes(output)) throw new Error("压缩包不能覆盖被选中的源文件");
  const temporaryOutput = path.posix.join(target, `.terma-${crypto.randomUUID()}.tar.gz.part`);
  const names = normalizedPaths.map((item) => `./${path.posix.basename(item)}`);
  const command = `if [ -e ${remotePathOperand(connection, output)} ]; then echo "目标压缩包已存在" >&2; exit 1; fi; tar -czf ${remotePathOperand(connection, temporaryOutput)} -C ${remotePathOperand(connection, parent)} -- ${names.map((item) => remotePathOperand(connection, item)).join(" ")} && mv -- ${remotePathOperand(connection, temporaryOutput)} ${remotePathOperand(connection, output)} || { status=$?; rm -f -- ${remotePathOperand(connection, temporaryOutput)}; exit $status; }`;
  return { paths:normalizedPaths, target, parent, name, output, temporary_output:temporaryOutput, command };
}

module.exports = {
  buildCrossCopyOverwriteCommand,
  buildItemProgressJobCommand,
  crossCopyProgressEntries,
  normalizeCompressionRequest
};

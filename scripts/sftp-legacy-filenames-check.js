"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable, Writable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { gzipSync, gunzipSync } = require("node:zlib");
const { spawnSync } = require("node:child_process");
const iconv = require("iconv-lite");
const { Server } = require("ssh2");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terma-legacy-filenames-"));
process.env.TERMA_DATA_DIR = path.join(temporaryRoot, "data");
process.env.TERMA_SSH_DIR = path.join(temporaryRoot, "ssh");
const { TarFilenameTranscoder, normalizeDownloadedTarFilenames } = require("../dist/infrastructure/tar-filename-transcoder");
const { bindSftpChannelEncoding } = require("../dist/infrastructure/sftp-channel-encoding");
const { decodeRemotePosixCommand } = require("./remote-posix-test-helper");
let archivePayload;
const archiveJobs = [];

function number(value, length = 4) { const b = Buffer.alloc(length); b.writeUInt32BE(value, length - 4); return b; }
function string(value) { const b = Buffer.isBuffer(value) ? value : Buffer.from(value); return Buffer.concat([number(b.length), b]); }
function rawNames(sftp, id, entries) {
  const body = Buffer.concat([Buffer.from([104]), number(id), number(entries.length),
    ...entries.flatMap(bytes => [string(bytes), string(""), number(0)])]);
  sftp._protocol.channelData(sftp.outgoing.id, Buffer.concat([number(body.length), body]));
}
const nodes = new Map();
const directory = "/root/联调台账";
const content = Buffer.from("legacy filename bytes: 你好\n");
function addNode(text, type, data, target) {
  const bytes = iconv.encode(text, "gb18030");
  nodes.set(bytes.toString("utf8"), {bytes, type, data, target});
}
addNode("/root", "directory");
addNode(directory, "directory");
addNode(`${directory}/子目录`, "directory");
addNode(`${directory}/子目录/中文报表.xls`, "file", content);
addNode(`${directory}/链接`, "symlink", null, iconv.encode("子目录/中文报表.xls", "gb18030"));
const invalidBytes = Buffer.concat([iconv.encode(`${directory}/`, "gb18030"), Buffer.from([0xff]), Buffer.from(".txt")]);
nodes.set(invalidBytes.toString("utf8"), {bytes:invalidBytes, type:"file", data:content});
const { privateKey } = crypto.generateKeyPairSync("rsa", {modulusLength:2048});
const clients = new Set();
const server = new Server({hostKeys:[privateKey.export({type:"pkcs1", format:"pem"})]}, client => {
  clients.add(client);
  client.on("close", () => clients.delete(client));
  client.on("authentication", ctx => ctx.accept());
  client.on("ready", () => client.on("session", accept => {
    const sshSession = accept();
    sshSession.on("exec", (acceptExec, _reject, info) => {
      const stream = acceptExec();
      const command = decodeRemotePosixCommand(info.command);
      const marker = command.match(/(__TERMA_ARCHIVE_[a-f0-9]+__:)/)?.[1];
      if (marker) stream.write(`${marker}/tmp/legacy-check.tar.gz\n`);
      else if (command.includes("wc -c")) stream.write(String(archivePayload.length));
      else if (command.includes("cat --")) stream.write(archivePayload);
      stream.exit(0);stream.end();
    });
    sshSession.on("sftp", acceptSftp => {
      const sftp = acceptSftp();
      const handles = new Map();
      let serial = 0;
      const attrs = node => ({mode:node.type === "directory" ? 0o40755 : node.type === "symlink" ? 0o120777 : 0o100644,
        size:node.data?.length || 0, uid:1000, gid:1000, atime:1700000000, mtime:1700000000});
      const stat = (id, value) => { const node = nodes.get(value); node ? sftp.attrs(id, attrs(node)) : sftp.status(id, 2); };
      sftp.on("LSTAT", stat);
      sftp.on("STAT", stat);
      sftp.on("REALPATH", (id, value) => { const n = nodes.get(value); n ? rawNames(sftp, id, [n.bytes]) : sftp.status(id, 2); });
      sftp.on("READLINK", (id, value) => { const n = nodes.get(value); n?.target ? rawNames(sftp, id, [n.target]) : sftp.status(id, 2); });
      sftp.on("OPENDIR", (id, value) => {
        const node = nodes.get(value);
        if (node?.type !== "directory") return sftp.status(id, 2);
        const handle = Buffer.from(`d${++serial}`); handles.set(handle.toString(), {node}); sftp.handle(id, handle);
      });
      sftp.on("READDIR", (id, handle) => {
        const item = handles.get(handle.toString());
        if (!item || item.read) return sftp.status(id, 1);
        item.read = true;
        const prefix = Buffer.concat([item.node.bytes, Buffer.from("/")]);
        rawNames(sftp, id, [...nodes.values()].filter(n => n.bytes.subarray(0, prefix.length).equals(prefix)
          && !n.bytes.subarray(prefix.length).includes(47)).map(n => n.bytes.subarray(prefix.length)));
      });
      sftp.on("OPEN", (id, value) => {
        const node = nodes.get(value);
        if (!node?.data) return sftp.status(id, 2);
        const handle = Buffer.from(`f${++serial}`); handles.set(handle.toString(), {node}); sftp.handle(id, handle);
      });
      sftp.on("FSTAT", (id, handle) => { const n = handles.get(handle.toString())?.node; n ? sftp.attrs(id, attrs(n)) : sftp.status(id, 2); });
      sftp.on("READ", (id, handle, offset, length) => {
        const node = handles.get(handle.toString())?.node;
        if (!node?.data) return sftp.status(id, 2);
        const body = node.data.subarray(offset, offset + length);
        body.length ? sftp.data(id, body) : sftp.status(id, 1);
      });
      sftp.on("CLOSE", (id, handle) => { handles.delete(handle.toString()); sftp.status(id, 0); });
    });
  }));
});

function tarHeader(name, size, type = "0", link = Buffer.alloc(0)) {
  const h = Buffer.alloc(512);
  Buffer.from(name).copy(h, 0, 0, 100);
  for (const [offset, length, value] of [[100,8,0o644], [108,8,0], [116,8,0], [124,12,size], [136,12,1700000000]]) {
    h.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
  }
  h[156] = type.charCodeAt(0); link.copy(h, 157, 0, 100); h.write("ustar\0", 257); h.write("00", 263);
  h.fill(32, 148, 156); const sum = h.reduce((a,b) => a+b, 0); h.write(`${sum.toString(8).padStart(6,"0")}\0 `,148,8,"ascii");
  return h;
}
function paxRecord(key, bytes) {
  const body = Buffer.concat([Buffer.from(`${key}=`),bytes,Buffer.from("\n")]);
  let n = body.length + 2; while (String(n).length + 1 + body.length !== n) n = String(n).length + 1 + body.length;
  return Buffer.concat([Buffer.from(`${n} `),body]);
}
function tarEntry(name, body, type = "0", link) {
  return Buffer.concat([tarHeader(name,body.length,type,link),body,Buffer.alloc((512-body.length%512)%512)]);
}
async function transform(body, encoding = "gb18030") {
  const chunks = [];
  // Split in the middle of TAR/PAX fields as well as payloads.
  await pipeline(Readable.from((function*(){for(let i=0;i<body.length;i+=73)yield body.subarray(i,i+73);})()),
    new TarFilenameTranscoder(encoding), new Writable({write(b,_e,cb){chunks.push(Buffer.from(b));cb();}}));
  return Buffer.concat(chunks);
}
function readTar(buffer) {
  const result = []; let pending = {}; let globals = {};
  for (let offset=0;offset+512<=buffer.length;){
    const h=buffer.subarray(offset,offset+512); if(!h.some(x=>x))break;
    const size=parseInt(h.subarray(124,136).toString().replace(/\0/g,"").trim(),8)||0;
    const body=buffer.subarray(offset+512,offset+512+size); const type=String.fromCharCode(h[156]);
    if(type==="x"||type==="g"){
      const values={};for(let p=0;p<body.length;){const s=body.indexOf(32,p),n=Number(body.subarray(p,s).toString());const r=body.subarray(s+1,p+n-1);const eq=r.indexOf(61);values[r.subarray(0,eq).toString()]=r.subarray(eq+1).toString("utf8");p+=n;}
      if(type==="g")Object.assign(globals,values);else Object.assign(pending,values);
    }else{result.push({name:pending.path||h.subarray(0,100).toString().replace(/\0.*$/s,""),link:pending.linkpath||"",type,body:Buffer.from(body),charset:pending.hdrcharset||globals.hdrcharset});pending={};}
    offset+=512+Math.ceil(size/512)*512;
  }
  return result;
}

async function main() {
  const longName = `联调台账/${"中文长文件名".repeat(18)}.xls`;
  const pax = paxRecord("path",iconv.encode(longName,"gb18030"));
  const source = Buffer.concat([
    tarEntry("GlobalHead",paxRecord("hdrcharset",Buffer.from("BINARY")),"g"),
    tarEntry(iconv.encode("联调台账/","gb18030"),Buffer.alloc(0),"5"),
    tarEntry("PaxHeaders/long",pax,"x"),tarEntry("placeholder",content),
    tarEntry(iconv.encode("联调台账/链接","gb18030"),Buffer.alloc(0),"2",iconv.encode("中文报表.xls","gb18030")),
    Buffer.alloc(1024)
  ]);
  const converted = await transform(source); const parsed = readTar(converted);
  assert.deepEqual(parsed.map(x=>x.name),["联调台账/",longName,"联调台账/链接"]);
  assert.equal(parsed[1].body.equals(content),true);assert.equal(parsed[2].link,"中文报表.xls");
  assert.equal(parsed.every(x=>x.charset==="ISO-IR 10646 2000 UTF-8"),true);
  assert.deepEqual(readTar(await transform(converted)).map(x=>x.name),parsed.map(x=>x.name),"normalization is idempotent after an interrupted finalization");
  await assert.rejects(transform(source.subarray(0,source.length-1025)),/Incomplete TAR/);
  const damaged=Buffer.from(source);damaged[0]^=1;await assert.rejects(transform(damaged),/checksum/);
  await assert.rejects(transform(Buffer.concat([tarEntry("bad",Buffer.from("99 path=x\n"),"x"),Buffer.alloc(1024)])),/PAX/);
  const large=tarHeader("large",16*1024*1024+1,"x");await assert.rejects(transform(large),/too large/);
  const archive=path.join(temporaryRoot,"archive.tar.gz");fs.writeFileSync(archive,gzipSync(source));
  await normalizeDownloadedTarFilenames(archive,"gb18030");assert.equal(readTar(gunzipSync(fs.readFileSync(archive)))[1].name,longName);
  const tar = spawnSync("tar",["-tf",archive]);
  if (!tar.error || tar.error.code !== "ENOENT") {
    assert.equal(tar.status,0,`an independent TAR reader must accept UTF-8 PAX headers: ${tar.stderr}`);
    // Listing validates long paths and symlinks without needing Windows symlink privileges.
    assert.ok(tar.stdout.length>0);
  }
  const original=fs.readFileSync(archive);const controller=new AbortController();controller.abort();
  await assert.rejects(normalizeDownloadedTarFilenames(archive,"gb18030",controller.signal),{name:"AbortError"});assert.deepEqual(fs.readFileSync(archive),original);
  assert.equal(fs.readdirSync(temporaryRoot).some(n=>n.includes(".utf8-")),false);

  await new Promise((resolve,reject)=>server.listen(0,"127.0.0.1",e=>e?reject(e):resolve()));
  const db=require("../dist/db");
  const connection={id:7123,ssh_host:"127.0.0.1",ssh_port:server.address().port,ssh_user:"fixture",auth_type:"password",ssh_password:"fixture",sftp_filename_encoding:"gb18030"};
  db.getConnection=()=>({...connection});
  await require("./ssh-host-trust-test-helper").trustTestHost(connection);
  const session=require("../dist/sftp-session");
  const listing=await session.readSftpDirectory(connection.id,directory);
  assert.equal(listing.path,directory);assert.ok(listing.entries.some(x=>x.filename==="子目录"));
  const channel=await session.openSftpChannel(connection.id);
  await assert.rejects(new Promise((resolve,reject)=>{try{channel.lstat("bad\0path",e=>e?reject(e):resolve());}catch(e){reject(e);}}),/远程路径无效/);
  assert.equal(await new Promise((resolve,reject)=>channel.readlink(`${directory}/链接`,(e,v)=>e?reject(e):resolve(v))),"子目录/中文报表.xls");
  channel.end();
  const ticket=await session.createNativeSftpDragTicket(connection.id,[directory]);
  assert.ok(ticket.entries.some(x=>x.relative_path==="联调台账/子目录/中文报表.xls"));
  const fileEntry=ticket.entries.find(x=>x.relative_path.endsWith(".xls"));
  const opened=await session.openNativeSftpDragTicketFile(ticket.token,fileEntry.index);const chunks=[];for await(const b of opened.stream)chunks.push(b);assert.deepEqual(Buffer.concat(chunks),content);
  // A second channel must retain the exact bytes of a non-roundtrippable child.
  const invalidEntry=ticket.entries.find(x=>x.relative_path.endsWith(".txt"));
  const rawOpened=await session.openNativeSftpDragTicketFile(ticket.token,invalidEntry.index);const rawChunks=[];for await(const b of rawOpened.stream)rawChunks.push(b);assert.deepEqual(Buffer.concat(rawChunks),content);
  // Do not follow the synthetic symlink in the recursive download fixture.
  nodes.delete(iconv.encode(`${directory}/链接`,"gb18030").toString("utf8"));
  const delivered=await session.deliverSftpPaths(connection.id,[directory],path.join(temporaryRoot,"target"));
  assert.equal(delivered.files.length,1);assert.deepEqual(fs.readFileSync(path.join(delivered.files[0],"子目录","中文报表.xls")),content);
  const jobs=require("../dist/sftp-jobs");
  async function waitForArchive(id) {
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){const job=jobs.listSftpJobs().find(x=>x.id===id);if(job&&["done","failed","cancelled"].includes(job.status))return job;await new Promise(r=>setTimeout(r,20));}
    throw new Error("legacy archive job timed out");
  }
  archivePayload=gzipSync(source);
  for (const deliveryMode of ["browser","desktop"]) {
    const job=jobs.startArchiveDownloadJob(connection.id,[directory],{deliveryMode,autoSaveDirectory:path.join(temporaryRoot,"downloads"),silentNotifications:true});archiveJobs.push(job.id);
    const completed=await waitForArchive(job.id);assert.equal(completed.status,"done",completed.error);
    const file=deliveryMode==="desktop"?completed.saved_path:jobs.getSftpJobFile(job.id).path;
    assert.equal(readTar(gunzipSync(fs.readFileSync(file)))[1].name,longName);
    assert.equal(completed.archive_utf8_filenames,true);assert.equal(completed.remote_archive_path,"");
    assert.equal(completed.delivery_status,deliveryMode==="desktop"?"saved":"pending","browser archives must remain available for browser delivery");
    assert.equal(completed.size,fs.statSync(file).size);
  }
  archivePayload=Buffer.from("damaged gzip data");
  const broken=jobs.startArchiveDownloadJob(connection.id,[directory],{deliveryMode:"browser",silentNotifications:true});archiveJobs.push(broken.id);
  const failed=await waitForArchive(broken.id);assert.equal(failed.status,"failed");assert.equal(failed.error_code,"sftp_archive_filename_conversion_failed");
  for(const id of archiveJobs)jobs.deleteSftpJob(id);
  connection.sftp_filename_encoding="utf8";
  const changedChannel=await session.openSftpChannel(connection.id);
  await assert.rejects(new Promise((resolve,reject)=>changedChannel.lstat(directory,(e,v)=>e?reject(e):resolve(v))),{code:2},"changing the encoding must discard the previous byte-path cache");
  changedChannel.end();connection.sftp_filename_encoding="gb18030";
  const restoredChannel=await session.openSftpChannel(connection.id);
  assert.ok(await new Promise((resolve,reject)=>restoredChannel.lstat(directory,(e,v)=>e?reject(e):resolve(v))));restoredChannel.end();
  session.releaseNativeSftpDragTicket(ticket.token);session.closeAllSftpSessions();db.closeDatabase();
  const originalLstat=function(value,callback){callback(null,value);};const originalReaddir=function(_path,callback){callback(null,[{filename_bytes:Buffer.from("../escape")}]);};
  const unsafe=bindSftpChannelEncoding({lstat:originalLstat,readdir:originalReaddir},{sftp_filename_encoding:"utf8"});
  await assert.rejects(new Promise((resolve,reject)=>unsafe.readdir("/root",(e,v)=>e?reject(e):resolve(v))),/远程文件名无效/);
  console.log("SFTP 旧编码文件名检查通过：真实协议字节、递归拖出、本机接收、混合字节、UTF-8 压缩包与损坏/取消边界");
}

main().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  try{require("../dist/sftp-session").closeAllSftpSessions();}catch{}
  try{require("../dist/db").closeDatabase();}catch{}
  for(const client of clients)client.end();
  await new Promise(resolve=>server.close(resolve));
  fs.rmSync(temporaryRoot,{recursive:true,force:true});
});

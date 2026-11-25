"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { buildRemotePosixCommand } = require("../dist/remote-posix");
const { readSftpJobSource } = require("./backend-source");

const source = [
  "set +e",
  "TERMA_SIZE=10",
  "case \"$TERMA_SIZE\" in \"\"|*[!0-9]*) exit 9;; esac",
  "terma_value='quoted value'",
  "printf 'TERMA_REMOTE_POSIX=%s\\n' \"$terma_value\""
].join("\n");
const command = buildRemotePosixCommand(source);
assert.match(command, /^\/bin\/sh -c '/);
assert.match(command, /terma_script=\$\(terma_decode\) \|\| exit \$\?;/);
assert.match(command, /exec \/bin\/sh -c \"\$terma_script\"'$/);
const body = command.slice("/bin/sh -c '".length, -1);
assert.doesNotMatch(body, /'/, "outer command body must not expose nested single quotes to csh/tcsh");
assert.doesNotMatch(body, /!/, "outer command body must not expose history expansion to csh/tcsh");
assert.doesNotMatch(body, /\btd_/, "new remote wrapper variables must use the Terma prefix");
assert.doesNotMatch(body, /printf %s \"\$terma_script\" \| \/bin\/sh/, "the decoded script must not replace the SSH input stream");
const match = /^terma_payload=([A-Za-z0-9+/=]+);/.exec(body);
assert.ok(match);
assert.equal(Buffer.from(match[1], "base64").toString("utf8"), source);
assert.throws(() => buildRemotePosixCommand(""), /empty or too large/);

if (process.platform !== "win32") {
  const executed = spawnSync("/bin/sh", ["-c", command], { encoding:"utf8" });
  assert.equal(executed.status, 0);
  assert.equal(executed.stdout, "TERMA_REMOTE_POSIX=quoted value\n");

  const streamed = spawnSync("/bin/sh", ["-c", buildRemotePosixCommand("cat")], {
    input:"TERMA_STREAM_INPUT\n",
    encoding:"utf8"
  });
  assert.equal(streamed.status, 0);
  assert.equal(streamed.stdout, "TERMA_STREAM_INPUT\n", "remote POSIX scripts must inherit the original SSH input stream");

  const missingDecoder = spawnSync("/bin/sh", ["-c", command], {
    encoding:"utf8",
    env:{...process.env, PATH:""}
  });
  assert.equal(missingDecoder.status, 127, "missing remote decoders must not be reported as success");
  assert.match(missingDecoder.stderr, /requires base64 or openssl/);
}

const shell = process.platform === "win32" ? path.join(process.env.ProgramFiles || "C:/Program Files", "Git/bin/sh.exe") : "/bin/sh";
if (fs.existsSync(shell)) {
  const { __buildStreamRemoteOpenCommand } = require("../dist/sftp");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "terma-file-read-"));
  const name = "literal $(oops) o'k [!].txt";
  const contents = "sample contents";
  const limit = 1024 * 1024;
  const read = target => spawnSync(shell, ["-s"], {
    input:`stat() { return 127; }; base64() { return 127; }; openssl() { return 127; }; ${__buildStreamRemoteOpenCommand(target, limit)}\n`,
    cwd:directory,encoding:"utf8",timeout:10000
  });
  try {
    fs.writeFileSync(path.join(directory, name), contents);
    const opened = read(`./${name}`);
    assert.ifError(opened.error);
    assert.equal(opened.status, 0, opened.stderr);
    assert.equal(opened.stdout, `TERMA_OPEN_READY:${Buffer.byteLength(contents)}:0:0\n${contents}`);
    const notRegular = read(".");
    assert.equal(notRegular.status, 1);
    assert.match(notRegular.stderr, /目标不是普通文件/);
    assert.equal(notRegular.stdout, "");
    fs.truncateSync(path.join(directory, name), limit + 1);
    const oversized = read(`./${name}`);
    assert.equal(oversized.status, 1);
    assert.match(oversized.stderr, /超过 1 MB/);
    assert.equal(oversized.stdout, "", "an oversized file must not send file bytes");
    if (process.platform !== "win32") {
      fs.symlinkSync(name, path.join(directory,"link"));
      const link = read("./link");
      assert.equal(link.status, 1);
      assert.match(link.stderr, /符号链接本身为 \d+ B，目标文件实际为 1048577 B/);
    }
  } finally {
    for (const file of fs.readdirSync(directory)) fs.unlinkSync(path.join(directory,file));
    fs.rmdirSync(directory);
  }
  console.log("精简 Shell 文件读取检查通过：特殊路径、大小上限和目录拒绝");
}

const sftpSource = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../src/sftp.ts'), 'utf8');
const sftpJobsSource = readSftpJobSource(require('node:path').resolve(__dirname, '..'));
assert.match(sftpSource, /runRemoteCommand\(connection, buildRemotePosixCommand\(command\), input, timeoutMs, signal\)/);
assert.match(sftpJobsSource, /spawnSftpSessionCommand\(connection, buildRemotePosixCommand\(command\)\)/);
assert.doesNotMatch(sftpSource, /sh -c \$\{shellQuote\(command\)\}/);
assert.doesNotMatch(sftpJobsSource, /sh -c \$\{shellQuote\(command\)\}/);

console.log("远端 POSIX 脚本封装检查通过：固定 Base64 载荷、无嵌套单引号并显式交给 /bin/sh");

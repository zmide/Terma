"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { buildRemotePosixCommand } = require("../dist/remote-posix");

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

const sftpSource = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../src/sftp.ts'), 'utf8');
const sftpJobsSource = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../src/sftp-jobs.ts'), 'utf8');
assert.match(sftpSource, /spawnSftpSessionCommand\(connection, buildRemotePosixCommand\(command\)\)/);
assert.match(sftpJobsSource, /spawnSftpSessionCommand\(connection, buildRemotePosixCommand\(command\)\)/);
assert.doesNotMatch(sftpSource, /sh -c \$\{shellQuote\(command\)\}/);
assert.doesNotMatch(sftpJobsSource, /sh -c \$\{shellQuote\(command\)\}/);

console.log("远端 POSIX 脚本封装检查通过：固定 Base64 载荷、无嵌套单引号并显式交给 /bin/sh");

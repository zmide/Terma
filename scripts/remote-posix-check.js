"use strict";

const assert = require("node:assert/strict");
const { buildRemotePosixCommand } = require("../dist/remote-posix");

const source = [
  "set +e",
  "td_value='quoted value'",
  "printf 'TERMA_REMOTE_POSIX=%s\\n' \"$td_value\""
].join("\n");
const command = buildRemotePosixCommand(source);
assert.match(command, /^\/bin\/sh -lc '/);
assert.match(command, /td_decode \| \/bin\/sh'$/);
const body = command.slice("/bin/sh -lc '".length, -1);
assert.doesNotMatch(body, /'/, "outer command body must not expose nested single quotes to csh/tcsh");
const match = /^td_payload=([A-Za-z0-9+/=]+);/.exec(body);
assert.ok(match);
assert.equal(Buffer.from(match[1], "base64").toString("utf8"), source);
assert.throws(() => buildRemotePosixCommand(""), /empty or too large/);

console.log("远端 POSIX 脚本封装检查通过：固定 Base64 载荷、无嵌套单引号并显式交给 /bin/sh");

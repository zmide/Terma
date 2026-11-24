const POSIX_PAYLOAD_LIMIT = 2 * 1024 * 1024;

/**
 * Run a POSIX script through /bin/sh even when the SSH account login shell is
 * csh/tcsh/fish. The outer command deliberately contains no nested quoting or
 * shell-specific redirections for the login shell to reinterpret.
 */
function buildRemotePosixCommand(script: unknown): string {
  const source = String(script || "");
  const payload = Buffer.from(source, "utf8").toString("base64");
  if (!source || payload.length > POSIX_PAYLOAD_LIMIT) throw new Error("Remote POSIX script is empty or too large");
  const runner = [
    `terma_payload=${payload};`,
    "terma_decode() {",
    "if command -v base64 >/dev/null 2>&1; then",
    "if printf %s \"$terma_payload\" | base64 -d >/dev/null 2>&1; then printf %s \"$terma_payload\" | base64 -d; else printf %s \"$terma_payload\" | base64 -D; fi;",
    "elif command -v openssl >/dev/null 2>&1; then",
    "printf %s \"$terma_payload\" | openssl base64 -d -A;",
    "else",
    "printf \"%s\\n\" \"Terma requires base64 or openssl on the remote host\" >&2; return 127;",
    "fi;",
    "};",
    "terma_script=$(terma_decode) || exit $?;",
    "exec /bin/sh -c \"$terma_script\""
  ].join(" ");
  return `/bin/sh -c '${runner}'`;
}

/**
 * Reserve the first stdin line for an octal-encoded script. `read` consumes
 * only that line; the executed command inherits the remaining binary input.
 * The fixed outer command is also safe for csh/tcsh login shells.
 */
function prepareRemotePosixInput(script: unknown, input: Buffer = Buffer.alloc(0)): { command: string; input: Buffer } {
  const source = Buffer.from(String(script || ""), "utf8");
  if (!source.length || source.length * 5 > POSIX_PAYLOAD_LIMIT) throw new Error("Remote POSIX script is empty or too large");
  const encoded = [...source].map(byte => `\\0${byte.toString(8).padStart(3, "0")}`).join("");
  return {
    command: `/bin/sh -c 'IFS= read -r terma_script || exit 1; terma_script=$(printf "%b" "$terma_script") || exit $?; exec /bin/sh -c "$terma_script"'`,
    input: Buffer.concat([Buffer.from(`${encoded}\n`, "ascii"), input])
  };
}

module.exports = { buildRemotePosixCommand, prepareRemotePosixInput };

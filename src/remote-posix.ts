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
    `td_payload=${payload};`,
    "td_decode() {",
    "if command -v base64 >/dev/null 2>&1; then",
    "if printf %s \"$td_payload\" | base64 -d >/dev/null 2>&1; then printf %s \"$td_payload\" | base64 -d; else printf %s \"$td_payload\" | base64 -D; fi;",
    "elif command -v openssl >/dev/null 2>&1; then",
    "printf %s \"$td_payload\" | openssl base64 -d -A;",
    "else",
    "printf \"%s\\n\" \"Terma requires base64 or openssl on the remote host\" >&2; return 127;",
    "fi;",
    "};",
    "td_decode | /bin/sh"
  ].join(" ");
  return `/bin/sh -lc '${runner}'`;
}

module.exports = { buildRemotePosixCommand };

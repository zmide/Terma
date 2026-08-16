const { buildRemotePosixCommand } = require("./remote-posix");
const { runSshCommandForConnectionStreaming } = require("./ssh");

const TERMINAL_CLIPBOARD_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const TERMINAL_CLIPBOARD_COMMAND_TIMEOUT_MS = 25 * 1000;
const TERMINAL_CLIPBOARD_READY_MARKER = "TERMA_TERMINAL_CLIPBOARD_READY";
const TERMINAL_CLIPBOARD_UNAVAILABLE_PREFIX = "TERMA_TERMINAL_CLIPBOARD_UNAVAILABLE=";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface TerminalClipboardCommandResult {
  status?: number | null;
  stdout?: string;
  stderr?: string;
  error?: Error | null;
}

type TerminalClipboardRunCommand = (
  connection: any,
  command: string,
  timeoutMs: number,
  onChunk: (chunk: Uint8Array, source: string) => void,
  options: {input: Buffer; x11Mode: string}
) => Promise<TerminalClipboardCommandResult>;

interface TerminalClipboardWriteOptions {
  x11Mode?: unknown;
  runCommand?: TerminalClipboardRunCommand;
}

function normalizeTerminalClipboardX11Mode(value: unknown): "off" | "trusted" | "untrusted" {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "trusted" || mode === "untrusted") return mode;
  return "off";
}

function validateTerminalClipboardImage(value: unknown): Buffer {
  const image = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
      : value instanceof ArrayBuffer
        ? Buffer.from(value)
        : Buffer.alloc(0);
  if (!image.length) throw new Error("剪贴板图片为空");
  if (image.length > TERMINAL_CLIPBOARD_IMAGE_MAX_BYTES) throw new Error("剪贴板图片超过 25 MB");
  if (image.length < PNG_SIGNATURE.length || !image.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error("剪贴板图片不是有效的 PNG 数据");
  }
  return image;
}

function terminalClipboardImageScript(): string {
  return [
    "set +e",
    `if [ -z "\${DISPLAY:-}" ]; then printf '${TERMINAL_CLIPBOARD_UNAVAILABLE_PREFIX}display\\n'; exit 20; fi`,
    `if ! command -v xclip >/dev/null 2>&1; then printf '${TERMINAL_CLIPBOARD_UNAVAILABLE_PREFIX}xclip\\n'; exit 21; fi`,
    "umask 077",
    "terma_clip_file=$(mktemp \"${TMPDIR:-/tmp}/terma-terminal-clipboard.XXXXXX\") || exit 22",
    "terma_clip_error=$(mktemp \"${TMPDIR:-/tmp}/terma-terminal-clipboard-error.XXXXXX\") || { rm -f \"$terma_clip_file\"; exit 22; }",
    "terma_clip_pid=",
    "terma_clip_cleanup() { if [ -n \"$terma_clip_pid\" ] && kill -0 \"$terma_clip_pid\" 2>/dev/null; then kill \"$terma_clip_pid\" 2>/dev/null || true; wait \"$terma_clip_pid\" 2>/dev/null || true; fi; rm -f \"$terma_clip_file\" \"$terma_clip_error\"; }",
    "trap terma_clip_cleanup EXIT HUP INT TERM",
    "cat > \"$terma_clip_file\" || exit 23",
    "xclip -selection clipboard -target image/png -quiet -i < \"$terma_clip_file\" >/dev/null 2>\"$terma_clip_error\" &",
    "terma_clip_pid=$!",
    "sleep 1",
    `if ! kill -0 "$terma_clip_pid" 2>/dev/null; then wait "$terma_clip_pid"; terma_clip_status=$?; cat "$terma_clip_error" >&2; printf '${TERMINAL_CLIPBOARD_UNAVAILABLE_PREFIX}xclip-failed\\n'; exit "$terma_clip_status"; fi`,
    `printf '${TERMINAL_CLIPBOARD_READY_MARKER}\\n'`,
    "terma_clip_elapsed=0",
    "while kill -0 \"$terma_clip_pid\" 2>/dev/null; do terma_clip_elapsed=$((terma_clip_elapsed + 1)); if [ \"$terma_clip_elapsed\" -ge 15 ]; then kill \"$terma_clip_pid\" 2>/dev/null || true; break; fi; sleep 1; done",
    "wait \"$terma_clip_pid\" 2>/dev/null || true",
    "exit 0"
  ].join("\n");
}

function terminalClipboardUnavailableReason(output: unknown, result: TerminalClipboardCommandResult | null): string {
  const marker = String(output || "").match(/TERMA_TERMINAL_CLIPBOARD_UNAVAILABLE=([a-z-]+)/i)?.[1] || "";
  if (marker) return marker.toLowerCase();
  if (result?.error?.message) return "ssh-failed";
  if (result?.status === null || result?.status === undefined) return "ssh-failed";
  return result?.status === 0 ? "not-ready" : "remote-failed";
}

async function writeTerminalClipboardImage(connection: any, value: unknown, options: TerminalClipboardWriteOptions = {}): Promise<any> {
  const x11Mode = normalizeTerminalClipboardX11Mode(options.x11Mode);
  if (x11Mode === "off") return {ready:false, available:false, reason:"x11-disabled"};
  const image = validateTerminalClipboardImage(value);
  const runCommand = options.runCommand || runSshCommandForConnectionStreaming;
  const command = buildRemotePosixCommand(terminalClipboardImageScript());
  return new Promise<any>((resolve) => {
    let settled = false;
    let streamedOutput = "";
    const settle = (result: any) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const onChunk = (chunk: Uint8Array, source: string) => {
      if (source !== "stdout") return;
      streamedOutput = `${streamedOutput}${Buffer.from(chunk).toString("utf8")}`.slice(-4096);
      if (streamedOutput.includes(TERMINAL_CLIPBOARD_READY_MARKER)) {
        settle({ready:true, available:true, transport:"x11", tool:"xclip", bytes:image.length});
        return;
      }
      if (streamedOutput.includes(TERMINAL_CLIPBOARD_UNAVAILABLE_PREFIX)) {
        settle({ready:false, available:false, reason:terminalClipboardUnavailableReason(streamedOutput, null)});
      }
    };
    Promise.resolve(runCommand(connection, command, TERMINAL_CLIPBOARD_COMMAND_TIMEOUT_MS, onChunk, {
      input:image,
      x11Mode
    })).then((result) => {
      if (settled) return;
      const output = `${streamedOutput}${result?.stdout || ""}`;
      if (output.includes(TERMINAL_CLIPBOARD_READY_MARKER)) {
        settle({ready:true, available:true, transport:"x11", tool:"xclip", bytes:image.length});
      } else {
        settle({ready:false, available:false, reason:terminalClipboardUnavailableReason(output, result)});
      }
    }).catch(() => {
      settle({ready:false, available:false, reason:"ssh-failed"});
    });
  });
}

module.exports = {
  PNG_SIGNATURE,
  TERMINAL_CLIPBOARD_IMAGE_MAX_BYTES,
  TERMINAL_CLIPBOARD_READY_MARKER,
  TERMINAL_CLIPBOARD_UNAVAILABLE_PREFIX,
  normalizeTerminalClipboardX11Mode,
  terminalClipboardImageScript,
  validateTerminalClipboardImage,
  writeTerminalClipboardImage
};

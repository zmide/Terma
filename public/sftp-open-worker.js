self.addEventListener("message", event => {
  try {
    const bytes = new Uint8Array(event.data.buffer);
    if (bytes.includes(0)) throw Object.assign(new Error("binary content"), {code:"binary_content"});
    const allowed = new Set(["auto", "utf8", "utf8bom", "gb18030", "gbk", "big5", "shift_jis", "euc-kr", "latin1"]);
    let encoding = String(event.data.encoding || "auto").toLowerCase();
    if (!allowed.has(encoding)) throw Object.assign(new Error("unsupported encoding"), {code:"unsupported_encoding"});
    const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
    if (encoding === "auto") {
      if (hasBom) encoding = "utf8bom";
      else {
        try {
          new TextDecoder("utf-8", {fatal:true}).decode(bytes);
          encoding = "utf8";
        } catch {
          encoding = "gb18030";
        }
      }
    }
    const source = encoding === "utf8bom" && hasBom ? bytes.subarray(3) : bytes;
    let content;
    if (encoding === "latin1") {
      const parts = [];
      for (let offset = 0; offset < source.length; offset += 32768) {
        parts.push(String.fromCharCode(...source.subarray(offset, Math.min(source.length, offset + 32768))));
      }
      content = parts.join("");
    } else {
      const labels = {utf8:"utf-8", utf8bom:"utf-8"};
      content = new TextDecoder(labels[encoding] || encoding).decode(source);
    }
    let lineCount = 1;
    let crlfCount = 0;
    let lfCount = 0;
    let crCount = 0;
    for (let index = 0; index < content.length; index += 1) {
      const code = content.charCodeAt(index);
      if (code === 13 && content.charCodeAt(index + 1) === 10) {
        crlfCount += 1;
        lineCount += 1;
        index += 1;
      } else if (code === 10) {
        lfCount += 1;
        lineCount += 1;
      } else if (code === 13) {
        crCount += 1;
        lineCount += 1;
      }
    }
    const lineEnding = crlfCount >= lfCount && crlfCount >= crCount && crlfCount > 0
      ? "crlf"
      : crCount > lfCount && crCount > 0
        ? "cr"
        : "lf";
    self.postMessage({
      ok:true,
      content,
      encoding,
      bom:hasBom,
      line_count:lineCount,
      line_ending:lineEnding,
      final_newline:/[\r\n]$/.test(content)
    });
  } catch (error) {
    self.postMessage({ok:false, error_code:error?.code || "decode_failed"});
  }
});

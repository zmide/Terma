self.addEventListener("message", event => {
  try {
    const bytes = new Uint8Array(event.data.buffer);
    if (bytes.includes(0)) throw new Error("该文件包含二进制内容，无法安全地以文本编辑");
    const allowed = new Set(["auto", "utf8", "utf8bom", "gb18030", "gbk", "big5", "shift_jis", "euc-kr", "latin1"]);
    let encoding = String(event.data.encoding || "auto").toLowerCase();
    if (!allowed.has(encoding)) throw new Error("不支持的文本编码");
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
    self.postMessage({ok:true, content, encoding, bom:encoding === "utf8bom" && hasBom});
  } catch (error) {
    self.postMessage({ok:false, error:error?.message || "文本解码失败"});
  }
});

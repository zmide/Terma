const fs = require("node:fs");
const path = require("node:path");

function renderFnosDescription(directory) {
  let description = fs.readFileSync(path.join(directory,"description.html"),"utf8");
  for (const [placeholder,name] of [["@TERMINAL_IMAGE@","terminal.jpg"],["@SFTP_IMAGE@","sftp.jpg"]]) {
    // fnOS's manifest reader treats a literal semicolon as an INI delimiter,
    // even inside desc quotes. A percent-encoded (non-base64) data URL has no
    // semicolon and remains self-contained without external image requests.
    const image = fs.readFileSync(path.join(directory,"poster",name));
    const data = Array.from(image,byte=>"%"+byte.toString(16).padStart(2,"0")).join("");
    description = description.replaceAll(placeholder,"data:image/jpeg,"+data);
  }
  description = description.replace(/\r?\n/g," ").trim();
  if (/[;"\r\n]/.test(description)) throw new Error("fnOS description must not contain INI delimiters or double quotes");
  return description;
}
module.exports={renderFnosDescription};

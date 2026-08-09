function productivityConnectionLabel(connection) {
  return `${connection.name}  ${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port}`;
}

function quoteExternalCommandArg(value) {
  const text = String(value || "");
  return /[\s"']/u.test(text) ? `"${text.replace(/(["\\])/g, "\\$1")}"` : text;
}

function externalConnectionCommand(connection, kind="ssh") {
  const jump = connection.jump_connection_id ? currentConnection(Number(connection.jump_connection_id)) : null;
  const args = [];
  if (kind === "ssh") args.push("ssh", "-p", String(connection.ssh_port || 22));
  else args.push("sftp", "-P", String(connection.ssh_port || 22));
  if (connection.identity_file) args.push("-i", quoteExternalCommandArg(connection.identity_file));
  if (jump) args.push("-J", `${jump.ssh_user}@${jump.ssh_host}:${jump.ssh_port || 22}`);
  args.push(`${connection.ssh_user}@${connection.ssh_host}`);
  return args.join(" ");
}

async function copyExternalConnectionCommand(id, kind="ssh") {
  const connection = currentConnection(Number(id));
  if (!connection) return;
  await navigator.clipboard.writeText(externalConnectionCommand(connection, kind));
  notify(`已复制 ${kind === "sftp" ? "SFTP" : "SSH"} 命令（不含密码和私钥口令）`, "success");
}

async function openConnectionInVsCode(id, remotePath="") {
  await api(`/api/connections/${Number(id)}/external-tools/vscode`, {method:"POST", body:JSON.stringify({path:remotePath})});
  notify("已交给 VS Code Remote SSH 打开", "success");
}

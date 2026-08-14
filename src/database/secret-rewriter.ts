const { decryptText, encryptText, isCurrentEncryptedText, isEncryptedText } = require("../crypto-store");
const databaseCore = require("./core");
const { all, now } = databaseCore;
const db = {
  exec(sql: string) { return databaseCore.getDatabase().exec(sql); },
  prepare(sql: string) { return databaseCore.getDatabase().prepare(sql); }
};

function rewriteConnectionSecrets(transform: (value: any) => any): number {
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = all("SELECT id, identity_file, ssh_password, private_key_passphrase, extra_args, terminal_program_path, terminal_program_args, terminal_working_directory FROM connections");
    const update = db.prepare("UPDATE connections SET identity_file=?, ssh_password=?, private_key_passphrase=?, extra_args=?, terminal_program_path=?, terminal_program_args=?, terminal_working_directory=?, updated_at=? WHERE id=?");
    let changed = 0;
    for (const row of rows) {
      const identityFile = row.identity_file ? transform(row.identity_file) : row.identity_file;
      const sshPassword = row.ssh_password ? transform(row.ssh_password) : row.ssh_password;
      const privateKeyPassphrase = row.private_key_passphrase ? transform(row.private_key_passphrase) : row.private_key_passphrase;
      const extraArgs = row.extra_args ? transform(row.extra_args) : row.extra_args;
      const terminalProgramPath = row.terminal_program_path ? transform(row.terminal_program_path) : row.terminal_program_path;
      const terminalProgramArgs = row.terminal_program_args ? transform(row.terminal_program_args) : row.terminal_program_args;
      const terminalWorkingDirectory = row.terminal_working_directory ? transform(row.terminal_working_directory) : row.terminal_working_directory;
      if (
        identityFile !== row.identity_file
        || sshPassword !== row.ssh_password
        || privateKeyPassphrase !== row.private_key_passphrase
        || extraArgs !== row.extra_args
        || terminalProgramPath !== row.terminal_program_path
        || terminalProgramArgs !== row.terminal_program_args
        || terminalWorkingDirectory !== row.terminal_working_directory
      ) {
        update.run(identityFile, sshPassword, privateKeyPassphrase, extraArgs, terminalProgramPath, terminalProgramArgs, terminalWorkingDirectory, now(), row.id);
        changed += 1;
      }
    }
    const remoteRows = all("SELECT id,password FROM remote_profiles");
    const updateRemote = db.prepare("UPDATE remote_profiles SET password=?,updated_at=? WHERE id=?");
    for (const row of remoteRows) {
      const password = row.password ? transform(row.password) : row.password;
      if (password !== row.password) {
        updateRemote.run(password, now(), row.id);
        changed += 1;
      }
    }
    const tunnelRows = all("SELECT id,identity_file,extra_args FROM tunnels");
    const updateTunnel = db.prepare("UPDATE tunnels SET identity_file=?,extra_args=?,updated_at=? WHERE id=?");
    for (const row of tunnelRows) {
      const identityFile = row.identity_file ? transform(row.identity_file) : row.identity_file;
      const extraArgs = row.extra_args ? transform(row.extra_args) : row.extra_args;
      if (identityFile !== row.identity_file || extraArgs !== row.extra_args) {
        updateTunnel.run(identityFile, extraArgs, now(), row.id);
        changed += 1;
      }
    }
    db.exec("COMMIT");
    return changed;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function encryptStoredConnectionSecrets(): number {
  return rewriteConnectionSecrets((value: any) => {
    if (isCurrentEncryptedText(value)) return value;
    return isEncryptedText(value) ? encryptText(decryptText(value)) : encryptText(value);
  });
}

function decryptStoredConnectionSecrets(): number {
  return rewriteConnectionSecrets((value: any) => isEncryptedText(value) ? decryptText(value) : value);
}

module.exports = { decryptStoredConnectionSecrets, encryptStoredConnectionSecrets, rewriteConnectionSecrets };

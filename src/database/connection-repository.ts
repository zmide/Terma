import fs from "node:fs";
import path from "node:path";

interface ConnectionRepositoryDependencies {
  all(sql: string, params?: any): any[];
  get(sql: string, params?: any): any;
  run(sql: string, params?: any): any;
  exec(sql: string): void;
  now(): number;
  decryptText(value: unknown): any;
  encryptText(value: unknown): any;
  requireEncryptionUnlocked(): void;
  cleanConnection(data: any, defaultExtraArgs: string, existing?: any): any;
  cleanTerminalPreferences(data: any, existing?: any): any;
  cleanTerminalStartup(data: any, existing?: any): any;
  cleanSftpTextEncoding(value: unknown): string;
  cleanSftpFilenameEncoding(value: unknown): string;
  ensureConnectionGroup(name: string): void;
  insertForward(connectionId: number, data: any): number;
  validatePort(value: unknown, label: string): number;
  assertAllowedIdentityPath(value: string): string;
  allowedIdentityPath(value: string): boolean;
  pidRunning(pid: unknown): boolean;
}

export function createConnectionRepository(dependencies: ConnectionRepositoryDependencies) {
  const { all, get, run, now } = dependencies;

  const identityFileUnsafeMessage = "私钥已不在安全目录，请编辑连接并导入 Terma 密钥目录或用户 ~/.ssh 顶层。";

  function connectionIdentityFileState(authType: unknown, identityFile: unknown, cache = new Map<string, any>()) {
    if (String(authType || "key") !== "key" || !String(identityFile || "").trim()) {
      return { identity_file_status:"none", identity_file_message:"" };
    }
    const resolved = path.resolve(String(identityFile));
    const cacheKey = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, dependencies.allowedIdentityPath(resolved)
        ? { identity_file_status:"ready", identity_file_message:"" }
        : { identity_file_status:"unsafe", identity_file_message:identityFileUnsafeMessage });
    }
    return cache.get(cacheKey);
  }

  function listConnections() {
    const rows = all(`SELECT connections.*, connection_groups.sort_order AS group_sort_order
      FROM connections LEFT JOIN connection_groups ON connection_groups.name=connections.group_name
      ORDER BY COALESCE(connection_groups.sort_order,2147483647), connections.sort_order, connections.name COLLATE NOCASE, connections.created_at, connections.id`)
      .sort((a, b) => Number(a.group_sort_order ?? 2147483647) - Number(b.group_sort_order ?? 2147483647)
        || Number(a.sort_order || 1) - Number(b.sort_order || 1)
        || String(a.name || "").localeCompare(String(b.name || ""), "zh-Hans-CN", {numeric:true, sensitivity:"base"})
        || Number(a.created_at || 0) - Number(b.created_at || 0)
        || Number(a.id) - Number(b.id));
    const forwardsByConnection = new Map<number, any[]>();
    for (const forward of all("SELECT * FROM connection_forwards ORDER BY connection_id,id")) {
      const running = forward.pid && dependencies.pidRunning(forward.pid);
      const item = {
        ...forward,
        status:running
          ? "running"
          : forward.status === "running" && !forward.pid
            ? "running"
            : ["failed", "reconnecting"].includes(forward.status)
              ? forward.status
              : "stopped",
        pid:running ? forward.pid : null
      };
      if (!forwardsByConnection.has(forward.connection_id)) forwardsByConnection.set(forward.connection_id, []);
      forwardsByConnection.get(forward.connection_id)?.push(item);
    }
    const identityStateCache = new Map<string, any>();
    return rows.map((connection) => {
      const identityFile = dependencies.decryptText(connection.identity_file);
      return {
        ...connection,
        identity_file:identityFile,
        ...connectionIdentityFileState(connection.auth_type, identityFile, identityStateCache),
        ssh_password:undefined,
        has_password:Boolean(connection.ssh_password),
        private_key_passphrase:undefined,
        has_private_key_passphrase:Boolean(connection.private_key_passphrase),
        extra_args:dependencies.decryptText(connection.extra_args),
        terminal_program_path:dependencies.decryptText(connection.terminal_program_path),
        terminal_program_args:dependencies.decryptText(connection.terminal_program_args),
        terminal_working_directory:dependencies.decryptText(connection.terminal_working_directory),
        forwards:forwardsByConnection.get(connection.id) || []
      };
    });
  }

  function getConnection(id: number) {
    const row = get("SELECT * FROM connections WHERE id = ?", [Number(id)]);
    if (!row) throw new Error("连接不存在");
    return {
      ...row,
      identity_file:dependencies.decryptText(row.identity_file),
      ssh_password:dependencies.decryptText(row.ssh_password),
      private_key_passphrase:dependencies.decryptText(row.private_key_passphrase),
      extra_args:dependencies.decryptText(row.extra_args),
      terminal_program_path:dependencies.decryptText(row.terminal_program_path),
      terminal_program_args:dependencies.decryptText(row.terminal_program_args),
      terminal_working_directory:dependencies.decryptText(row.terminal_working_directory)
    };
  }

  function getForward(id: number) {
    const row = get("SELECT * FROM connection_forwards WHERE id = ?", [Number(id)]);
    if (!row) throw new Error("转发不存在");
    return row;
  }

  function insertConnection(data: any, defaultExtraArgs: string) {
    const item = dependencies.cleanConnection(data, defaultExtraArgs);
    dependencies.ensureConnectionGroup(item.group_name);
    const timestamp = now();
    const result = run(
      `INSERT INTO connections
       (name, group_name, ssh_host, ssh_port, ssh_user, auth_type, identity_file, ssh_password, private_key_passphrase, ssh_agent_mode, jump_connection_id, connect_timeout_seconds, keepalive_interval_seconds, keepalive_count_max, tcp_keepalive, x11_mode, favorite, last_used_at, notifications_muted, tags, extra_args, autostart_forwards, sort_order, terminal_encoding, terminal_font_family, terminal_font_family_inherit, terminal_font_size, terminal_font_size_inherit, terminal_mobile_font_size, terminal_mobile_font_size_inherit, terminal_line_height, terminal_font_weight, terminal_startup_mode, terminal_profile_name, terminal_profile_kind, terminal_program_path, terminal_program_args, terminal_working_directory, terminal_program_platform, sftp_text_encoding, sftp_filename_encoding, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.name, item.group_name, item.ssh_host, item.ssh_port, item.ssh_user, item.auth_type, item.identity_file, item.ssh_password, item.private_key_passphrase, item.ssh_agent_mode, item.jump_connection_id, item.connect_timeout_seconds, item.keepalive_interval_seconds, item.keepalive_count_max, item.tcp_keepalive, item.x11_mode, item.favorite, null, item.notifications_muted, item.tags, item.extra_args, item.autostart_forwards, item.sort_order, item.terminal_encoding, item.terminal_font_family, item.terminal_font_family_inherit, item.terminal_font_size, item.terminal_font_size_inherit, item.terminal_mobile_font_size, item.terminal_mobile_font_size_inherit, item.terminal_line_height, item.terminal_font_weight, item.terminal_startup_mode, item.terminal_profile_name, item.terminal_profile_kind, item.terminal_program_path, item.terminal_program_args, item.terminal_working_directory, item.terminal_program_platform, item.sftp_text_encoding, item.sftp_filename_encoding, timestamp, timestamp]
    );
    return Number(result.lastInsertRowid);
  }

  function nextConnectionCopyName(name: string) {
    const source = String(name || "").trim();
    const base = source.replace(/\s*(?:（copy\d+）|\(copy\d+\))$/i, "").trim() || source || "SSH";
    const existing = new Set(all("SELECT name FROM connections").map(item => String(item.name || "").toLocaleLowerCase()));
    let index = 1;
    while (existing.has(`${base}（copy${index}）`.toLocaleLowerCase())) index += 1;
    return `${base}（copy${index}）`;
  }

  function duplicateConnection(id: number, defaultExtraArgs: string) {
    const source = getConnection(id);
    const name = nextConnectionCopyName(source.name);
    const forwards = all("SELECT * FROM connection_forwards WHERE connection_id=? ORDER BY id", [Number(id)]);
    dependencies.exec("BEGIN IMMEDIATE");
    try {
      const connectionId = insertConnection({ ...source, name }, defaultExtraArgs);
      for (const forward of forwards) dependencies.insertForward(connectionId, forward);
      dependencies.exec("COMMIT");
      return { id:connectionId, name, forwards:forwards.length };
    } catch (error) {
      dependencies.exec("ROLLBACK");
      throw error;
    }
  }

  function updateConnection(id: number, data: any, defaultExtraArgs: string) {
    const existing = get("SELECT * FROM connections WHERE id=?", [Number(id)]);
    if (!existing) throw new Error("连接不存在");
    const item = dependencies.cleanConnection(data, defaultExtraArgs, existing);
    dependencies.ensureConnectionGroup(item.group_name);
    run(
      `UPDATE connections SET name=?, group_name=?, ssh_host=?, ssh_port=?, ssh_user=?, auth_type=?, identity_file=?, ssh_password=?, private_key_passphrase=?, ssh_agent_mode=?, jump_connection_id=?, connect_timeout_seconds=?, keepalive_interval_seconds=?, keepalive_count_max=?, tcp_keepalive=?, x11_mode=?, favorite=?, notifications_muted=?, tags=?, extra_args=?, autostart_forwards=?, sort_order=?, terminal_encoding=?, terminal_font_family=?, terminal_font_family_inherit=?, terminal_font_size=?, terminal_font_size_inherit=?, terminal_mobile_font_size=?, terminal_mobile_font_size_inherit=?, terminal_line_height=?, terminal_font_weight=?, terminal_startup_mode=?, terminal_profile_name=?, terminal_profile_kind=?, terminal_program_path=?, terminal_program_args=?, terminal_working_directory=?, terminal_program_platform=?, sftp_text_encoding=?, sftp_filename_encoding=?, updated_at=? WHERE id=?`,
      [item.name, item.group_name, item.ssh_host, item.ssh_port, item.ssh_user, item.auth_type, item.identity_file, item.ssh_password, item.private_key_passphrase, item.ssh_agent_mode, item.jump_connection_id, item.connect_timeout_seconds, item.keepalive_interval_seconds, item.keepalive_count_max, item.tcp_keepalive, item.x11_mode, item.favorite, item.notifications_muted, item.tags, item.extra_args, item.autostart_forwards, item.sort_order, item.terminal_encoding, item.terminal_font_family, item.terminal_font_family_inherit, item.terminal_font_size, item.terminal_font_size_inherit, item.terminal_mobile_font_size, item.terminal_mobile_font_size_inherit, item.terminal_line_height, item.terminal_font_weight, item.terminal_startup_mode, item.terminal_profile_name, item.terminal_profile_kind, item.terminal_program_path, item.terminal_program_args, item.terminal_working_directory, item.terminal_program_platform, item.sftp_text_encoding, item.sftp_filename_encoding, now(), Number(id)]
    );
  }

  function updateConnectionUsage(id: number, action = "open") {
    getConnection(id);
    const timestamp = now();
    run("UPDATE connections SET last_used_at=?,updated_at=CASE WHEN ?='edit' THEN ? ELSE updated_at END WHERE id=?", [timestamp, String(action), timestamp, Number(id)]);
    return { ok:true, last_used_at:timestamp };
  }

  function updateConnectionFlags(id: number, data: any = {}) {
    getConnection(id);
    const favorite = Number(data.favorite || 0) ? 1 : 0;
    const notificationsMuted = Number(data.notifications_muted || 0) ? 1 : 0;
    run("UPDATE connections SET favorite=?,notifications_muted=?,updated_at=? WHERE id=?", [favorite, notificationsMuted, now(), Number(id)]);
    return { favorite, notifications_muted:notificationsMuted };
  }

  async function deleteConnection(id: number, stopForward: (id: number) => unknown) {
    for (const forward of all("SELECT id FROM connection_forwards WHERE connection_id=?", [Number(id)])) {
      await Promise.resolve(stopForward(forward.id));
    }
    run("DELETE FROM connection_forwards WHERE connection_id=?", [Number(id)]);
    run("UPDATE connections SET jump_connection_id=NULL WHERE jump_connection_id=?", [Number(id)]);
    run("DELETE FROM connections WHERE id=?", [Number(id)]);
  }

  function updateTerminalPreferences(id: number, data: any) {
    const existing = get("SELECT * FROM connections WHERE id=?", [Number(id)]);
    if (!existing) throw new Error("连接不存在");
    const item = dependencies.cleanTerminalPreferences(data, existing);
    run("UPDATE connections SET terminal_encoding=?,terminal_font_family=?,terminal_font_family_inherit=?,terminal_font_size=?,terminal_font_size_inherit=?,terminal_mobile_font_size=?,terminal_mobile_font_size_inherit=?,terminal_line_height=?,terminal_font_weight=?,updated_at=? WHERE id=?",
      [item.terminal_encoding, item.terminal_font_family, item.terminal_font_family_inherit, item.terminal_font_size, item.terminal_font_size_inherit, item.terminal_mobile_font_size, item.terminal_mobile_font_size_inherit, item.terminal_line_height, item.terminal_font_weight, now(), Number(id)]);
    return item;
  }

  function updateTerminalStartup(id: number, data: any) {
    dependencies.requireEncryptionUnlocked();
    const existing = get("SELECT * FROM connections WHERE id=?", [Number(id)]);
    if (!existing) throw new Error("连接不存在");
    const item = dependencies.cleanTerminalStartup(data, existing);
    run(
      "UPDATE connections SET terminal_startup_mode=?,terminal_profile_name=?,terminal_profile_kind=?,terminal_program_path=?,terminal_program_args=?,terminal_working_directory=?,terminal_program_platform=?,updated_at=? WHERE id=?",
      [
        item.terminal_startup_mode,
        item.terminal_profile_name,
        item.terminal_profile_kind,
        dependencies.encryptText(item.terminal_program_path),
        dependencies.encryptText(item.terminal_program_args),
        dependencies.encryptText(item.terminal_working_directory),
        item.terminal_program_platform,
        now(),
        Number(id)
      ]
    );
    return item;
  }

  function updateConnectionX11Mode(id: number, value: unknown) {
    const existing = get("SELECT id FROM connections WHERE id=?", [Number(id)]);
    if (!existing) throw new Error("连接不存在");
    const mode = String(value || "off").trim().toLowerCase();
    if (!["off", "untrusted", "trusted"].includes(mode)) throw new Error("X11 转发模式无效");
    run("UPDATE connections SET x11_mode=?,updated_at=? WHERE id=?", [mode, now(), Number(id)]);
    return { ok:true, x11_mode:mode };
  }

  function updateSftpTextEncoding(id: number, value: unknown) {
    getConnection(id);
    const encoding = dependencies.cleanSftpTextEncoding(value);
    run("UPDATE connections SET sftp_text_encoding=?,updated_at=? WHERE id=?", [encoding, now(), Number(id)]);
    return { sftp_text_encoding:encoding };
  }

  function updateSftpFilenameEncoding(id: number, value: unknown) {
    getConnection(id);
    const encoding = dependencies.cleanSftpFilenameEncoding(value);
    run("UPDATE connections SET sftp_filename_encoding=?,updated_at=? WHERE id=?", [encoding, now(), Number(id)]);
    return { sftp_filename_encoding:encoding };
  }

  function bulkUpdateConnections(connectionIds: unknown[], changes: any = {}) {
    const ids = [...new Set((connectionIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
    if (!ids.length) throw new Error("请选择要修改的 SSH 连接");
    if (ids.length > 500) throw new Error("单次最多批量修改 500 个 SSH 连接");

    const assignments: string[] = [];
    const values: any[] = [];
    if (Object.prototype.hasOwnProperty.call(changes, "group_name")) {
      const groupName = String(changes.group_name || "").trim();
      if (!groupName || groupName.length > 100) throw new Error("分组名称长度必须在 1-100 个字符之间");
      assignments.push("group_name=?");
      values.push(groupName);
      dependencies.ensureConnectionGroup(groupName);
    }
    if (Object.prototype.hasOwnProperty.call(changes, "ssh_port")) {
      assignments.push("ssh_port=?");
      values.push(dependencies.validatePort(changes.ssh_port, "SSH 端口"));
    }
    if (changes.auth) {
      dependencies.requireEncryptionUnlocked();
      const authType = String(changes.auth.type || "");
      if (authType === "password") {
        const password = String(changes.auth.password || "");
        if (!password || password.length > 4096) throw new Error("SSH 密码长度必须在 1-4096 个字符之间");
        assignments.push("auth_type=?", "identity_file=?", "ssh_password=?");
        values.push("password", null, dependencies.encryptText(password));
      } else if (authType === "key") {
        const identityFile = dependencies.assertAllowedIdentityPath(String(changes.auth.identity_file || ""));
        if (!identityFile || !fs.existsSync(identityFile)) throw new Error("请选择存在的私钥文件");
        assignments.push("auth_type=?", "identity_file=?", "ssh_password=?");
        values.push("key", dependencies.encryptText(identityFile), null);
      } else {
        throw new Error("不支持的认证方式");
      }
    }
    if (!assignments.length) throw new Error("请至少选择一项批量设置");

    const placeholders = ids.map(() => "?").join(",");
    const existing = all(`SELECT id FROM connections WHERE id IN (${placeholders})`, ids);
    if (existing.length !== ids.length) throw new Error("部分 SSH 连接不存在，请刷新后重试");
    dependencies.exec("BEGIN IMMEDIATE");
    try {
      const timestamp = now();
      for (const id of ids) run(`UPDATE connections SET ${assignments.join(", ")}, updated_at=? WHERE id=?`, [...values, timestamp, id]);
      dependencies.exec("COMMIT");
    } catch (error) {
      dependencies.exec("ROLLBACK");
      throw error;
    }
    return { ok:true, updated:ids.length };
  }

  function renameConnectionGroup(currentName: string, nextName: string) {
    const source = String(currentName || "").trim();
    const target = String(nextName || "").trim();
    if (!source || source.length > 100 || !target || target.length > 100) throw new Error("分组名称长度必须在 1-100 个字符之间");
    const existing = get("SELECT (SELECT COUNT(*) FROM connections WHERE group_name=?)+(SELECT COUNT(*) FROM remote_profiles WHERE group_name=?) AS count", [source, source]);
    if (!Number(existing?.count)) throw new Error("分组不存在，请刷新后重试");
    if (source === target) return { ok:true, updated:0, group_name:target };
    const conflict = get("SELECT 1 AS found FROM connections WHERE group_name=? UNION ALL SELECT 1 AS found FROM remote_profiles WHERE group_name=? LIMIT 1", [target, target]);
    if (conflict) throw new Error("该分组名称已存在，请使用其他名称");
    const result = run("UPDATE connections SET group_name=?, updated_at=? WHERE group_name=?", [target, now(), source]);
    const remoteResult = run("UPDATE remote_profiles SET group_name=?, updated_at=? WHERE group_name=?", [target, now(), source]);
    run("DELETE FROM connection_groups WHERE name=?", [target]);
    run("UPDATE connection_groups SET name=?,updated_at=? WHERE name=?", [target, now(), source]);
    return { ok:true, updated:Number(result?.changes || 0) + Number(remoteResult?.changes || 0), group_name:target };
  }

  function reorderConnectionGroups(names: unknown[]) {
    const requested = [...new Set((names || []).map(name => String(name || "").trim()).filter(Boolean))];
    const active = all("SELECT group_name FROM connections UNION SELECT group_name FROM remote_profiles").map(row => row.group_name);
    if (requested.length !== active.length || active.some(name => !requested.includes(name))) throw new Error("分组列表已变化，请刷新后重试");
    dependencies.exec("BEGIN IMMEDIATE");
    try {
      requested.forEach((name, index) => {
        dependencies.ensureConnectionGroup(name);
        run("UPDATE connection_groups SET sort_order=?,updated_at=? WHERE name=?", [index + 1, now(), name]);
      });
      dependencies.exec("COMMIT");
    } catch (error) {
      dependencies.exec("ROLLBACK");
      throw error;
    }
    return { ok:true, groups:requested.length };
  }

  function reorderConnections(groupName: unknown, connectionIds: unknown[]) {
    const group = String(groupName || "").trim();
    if (!group || group.length > 100) throw new Error("分组名称长度必须在 1-100 个字符之间");
    const requested = [...new Set((connectionIds || []).map(Number).filter(id => Number.isInteger(id) && id > 0))];
    if (!requested.length || requested.length > 500) throw new Error("服务器顺序必须包含 1-500 个 SSH 连接");
    const active = all("SELECT id FROM connections WHERE group_name=? ORDER BY sort_order,created_at,id", [group]).map(row => Number(row.id));
    if (requested.length !== active.length || active.some(id => !requested.includes(id))) throw new Error("服务器列表已变化，请刷新后重试");
    dependencies.exec("BEGIN IMMEDIATE");
    try {
      requested.forEach((id, index) => {
        run("UPDATE connections SET sort_order=?,updated_at=? WHERE id=? AND group_name=?", [index + 1, now(), id, group]);
      });
      dependencies.exec("COMMIT");
    } catch (error) {
      dependencies.exec("ROLLBACK");
      throw error;
    }
    return { ok:true, connections:requested.length };
  }

  return {
    listConnections,
    getConnection,
    getForward,
    insertConnection,
    duplicateConnection,
    updateConnection,
    updateConnectionUsage,
    updateConnectionFlags,
    deleteConnection,
    updateTerminalPreferences,
    updateTerminalStartup,
    updateConnectionX11Mode,
    updateSftpTextEncoding,
    updateSftpFilenameEncoding,
    bulkUpdateConnections,
    renameConnectionGroup,
    reorderConnectionGroups,
    reorderConnections
  };
}

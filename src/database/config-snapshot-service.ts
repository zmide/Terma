const { decryptText, encryptionState, encryptText, isEncryptedText, requireEncryptionUnlocked } = require("../crypto-store");
const { DEFAULT_TERMINAL_FONT, TERMINAL_PROFILE_KINDS, TERMINAL_PROGRAM_PLATFORMS, TERMINAL_STARTUP_MODES } = require("./connection-normalizer");
const { allowedIdentityPath } = require("../identity-path");
const { assertSafeExtraArgs } = require("../ssh-command");
const { validateSshHost, validateSshUser } = require("../ssh-connection");
const databaseCore = require("./core");
const { all, get, now, run } = databaseCore;
const db = { exec(sql: string) { return databaseCore.getDatabase().exec(sql); } };

const COMMAND_SNIPPET_BADGES = new Set(["", "command", "inspect", "service", "network", "database", "file", "start", "stop"]);
const LEGACY_COMMAND_SNIPPET_BADGES = new Map([
  ["令", "command"],
  ["查", "inspect"],
  ["服", "service"],
  ["网", "network"],
  ["库", "database"],
  ["文", "file"],
  ["启", "start"],
  ["停", "stop"]
]);

function normalizeCommandSnippetBadge(value: any): string {
  const raw = String(value || "");
  const code = LEGACY_COMMAND_SNIPPET_BADGES.get(raw) || raw;
  return COMMAND_SNIPPET_BADGES.has(code) ? code : "command";
}

function createConfigSnapshotService(options: any = {}) {
  const cleanRemoteProfile = options.cleanRemoteProfile;
  const cleanForward = options.cleanForward;
  if (typeof cleanRemoteProfile !== "function") throw new Error("cleanRemoteProfile is required");
  if (typeof cleanForward !== "function") throw new Error("cleanForward is required");

  function exportConfigSnapshot(): any {
    return {
      version: 1,
      connections: all("SELECT * FROM connections ORDER BY id"),
      remote_profiles: all("SELECT * FROM remote_profiles ORDER BY id"),
      connection_groups: all("SELECT * FROM connection_groups ORDER BY sort_order,name"),
      forwards: all("SELECT * FROM connection_forwards ORDER BY id").map((row: any) => ({...row, pid:null, status:"stopped", restore:0, reconnect_count:0, started_at:null})),
      forward_templates: all("SELECT * FROM forward_templates ORDER BY id"),
      command_snippets: all("SELECT * FROM command_snippets ORDER BY id"),
      named_workspaces: all("SELECT * FROM named_workspaces ORDER BY id")
    };
  }

  const SNAPSHOT_CONNECTION_SECRET_COLUMNS = [
    "identity_file",
    "ssh_password",
    "private_key_passphrase",
    "extra_args",
    "terminal_program_path",
    "terminal_program_args",
    "terminal_working_directory"
  ];

  function normalizeSnapshotSecret(value: any, label: string, state: any): any {
    if (value == null || value === "") return value;
    if (!state.enabled) {
      if (isEncryptedText(value)) throw new Error(`配置快照包含当前实例无法解密的字段：${label}`);
      return value;
    }
    let plain = value;
    if (isEncryptedText(value)) {
      try {
        plain = decryptText(value);
      } catch {
        throw new Error(`配置快照包含无法使用当前主密钥验证的字段：${label}`);
      }
    }
    return encryptText(plain);
  }

  function restoreConfigSnapshot(snapshot: any): any {
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.connections) || !Array.isArray(snapshot.forwards) || !Array.isArray(snapshot.forward_templates)) throw new Error("配置快照格式无效");
    const state = encryptionState();
    if (state.enabled) requireEncryptionUnlocked();
    const restoredConnections = snapshot.connections.map((source: any) => {
      const row = { ...source };
      for (const column of SNAPSHOT_CONNECTION_SECRET_COLUMNS) {
        row[column] = normalizeSnapshotSecret(row[column], `connections.${column}`, state);
      }
      return row;
    });
    const restoredRemoteProfiles = (snapshot.remote_profiles || []).map((source: any) => ({
      ...source,
      password:normalizeSnapshotSecret(source.password, "remote_profiles.password", state)
    }));
    const restoredForwards = snapshot.forwards.map((source: any) => ({...source, ...cleanForward(source)}));
    const restoredForwardTemplates = snapshot.forward_templates.map((source: any) => ({...source, ...cleanForward(source)}));
    db.exec("BEGIN IMMEDIATE");
    try {
      run("DELETE FROM connection_forwards");
      run("DELETE FROM connections");
      run("DELETE FROM remote_profiles");
      run("DELETE FROM connection_groups");
      run("DELETE FROM forward_templates");
      run("DELETE FROM command_snippets");
      run("DELETE FROM named_workspaces");
      const groups = Array.isArray(snapshot.connection_groups) ? snapshot.connection_groups : [...new Set(restoredConnections.map((row: any) => row.group_name))].map((name: any, index: number) => ({name,sort_order:index+1,created_at:now(),updated_at:now()}));
      for (const row of groups) run("INSERT INTO connection_groups(name,sort_order,created_at,updated_at) VALUES(?,?,?,?)", [row.name,row.sort_order,row.created_at,row.updated_at]);
      for (const row of restoredConnections) {
        const startupMode = TERMINAL_STARTUP_MODES.has(String(row.terminal_startup_mode || ""))
          ? String(row.terminal_startup_mode)
          : "default";
        const profileKind = TERMINAL_PROFILE_KINDS.has(String(row.terminal_profile_kind || ""))
          ? String(row.terminal_profile_kind)
          : "shell";
        const programPlatform = TERMINAL_PROGRAM_PLATFORMS.has(String(row.terminal_program_platform || ""))
          ? String(row.terminal_program_platform)
          : "auto";
        run(
          "INSERT INTO connections(id,name,group_name,ssh_host,ssh_port,ssh_user,auth_type,identity_file,ssh_password,private_key_passphrase,ssh_agent_mode,jump_connection_id,connect_timeout_seconds,keepalive_interval_seconds,keepalive_count_max,tcp_keepalive,x11_mode,favorite,last_used_at,notifications_muted,tags,extra_args,autostart_forwards,sort_order,terminal_encoding,terminal_font_family,terminal_font_family_inherit,terminal_font_size,terminal_font_size_inherit,terminal_mobile_font_size,terminal_mobile_font_size_inherit,terminal_line_height,terminal_font_weight,terminal_startup_mode,terminal_profile_name,terminal_profile_kind,terminal_program_path,terminal_program_args,terminal_working_directory,terminal_program_platform,sftp_text_encoding,sftp_filename_encoding,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          [
            row.id,
            row.name,
            row.group_name,
            row.ssh_host,
            row.ssh_port,
            row.ssh_user,
            row.auth_type || "key",
            row.identity_file,
            row.ssh_password || null,
            row.private_key_passphrase || null,
            new Set(["auto","off","required"]).has(row.ssh_agent_mode) ? row.ssh_agent_mode : "auto",
            row.jump_connection_id || null,
            Number(row.connect_timeout_seconds) || 10,
            Number.isInteger(Number(row.keepalive_interval_seconds)) ? Number(row.keepalive_interval_seconds) : 60,
            Number(row.keepalive_count_max) || 3,
            Number(row.tcp_keepalive ?? 1) ? 1 : 0,
            ["off","untrusted","trusted"].includes(String(row.x11_mode || "")) ? row.x11_mode : "off",
            Number(row.favorite || 0) ? 1 : 0,
            row.last_used_at || null,
            Number(row.notifications_muted || 0) ? 1 : 0,
            row.tags,
            row.extra_args,
            row.autostart_forwards,
            Number.isInteger(Number(row.sort_order)) && Number(row.sort_order) > 0 ? Number(row.sort_order) : 1,
            row.terminal_encoding || "utf8",
            row.terminal_font_family || DEFAULT_TERMINAL_FONT,
            Number(row.terminal_font_family_inherit ?? (row.terminal_font_family && row.terminal_font_family !== DEFAULT_TERMINAL_FONT ? 0 : 1)) ? 1 : 0,
            Number(row.terminal_font_size) || 13,
            Number(row.terminal_font_size_inherit ?? (Number(row.terminal_font_size || 13) === 13 ? 1 : 0)) ? 1 : 0,
            Number(row.terminal_mobile_font_size) || 13,
            Number(row.terminal_mobile_font_size_inherit ?? (Number(row.terminal_mobile_font_size || 13) === 13 ? 1 : 0)) ? 1 : 0,
            Number(row.terminal_line_height) || 1,
            row.terminal_font_weight || "normal",
            startupMode,
            row.terminal_profile_name || "",
            profileKind,
            row.terminal_program_path || "",
            row.terminal_program_args || "",
            row.terminal_working_directory || "",
            programPlatform,
            row.sftp_text_encoding || "auto",
            row.sftp_filename_encoding || "utf8",
            row.created_at,
            row.updated_at
          ]
        );
      }
      for (const row of restoredRemoteProfiles) {
        const item = cleanRemoteProfile({
          ...row,
          password:row.password ? decryptText(row.password) : "",
          options:row.options_json
        });
        run("INSERT INTO remote_profiles(id,name,group_name,protocol,host,port,username,password,favorite,last_used_at,tags,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
          row.id,item.name,item.group_name,item.protocol,item.host,item.port,item.username,item.password,item.favorite,row.last_used_at || null,item.tags,item.options_json,row.created_at || now(),row.updated_at || now()
        ]);
      }
      for (const row of restoredForwards) run("INSERT INTO connection_forwards(id,connection_id,mode,service_name,service_type,service_note,url_scheme,url_path,bind_host,bind_port,target_host,target_port,pid,status,restore,reconnect_count,last_error,last_error_code,started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [row.id,row.connection_id,row.mode,row.service_name,row.service_type,row.service_note,row.url_scheme,row.url_path,row.bind_host,row.bind_port,row.target_host,row.target_port,null,"stopped",0,0,row.last_error || null,row.last_error_code || null,null,row.created_at,row.updated_at]);
      for (const row of restoredForwardTemplates) run("INSERT INTO forward_templates(id,name,mode,service_name,service_type,service_note,url_scheme,url_path,bind_host,bind_port,target_host,target_port,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [row.id,row.name,row.mode,row.service_name,row.service_type,row.service_note,row.url_scheme,row.url_path,row.bind_host,row.bind_port,row.target_host,row.target_port,row.created_at,row.updated_at]);
      for (const row of snapshot.command_snippets || []) run("INSERT INTO command_snippets(id,name,group_name,command,description,tags,workflow_json,favorite,quick_visible,quick_action,quick_badge,quick_color,quick_sort_order,last_used_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [row.id,row.name,row.group_name || "默认分组",row.command,row.description || "",row.tags || "",row.workflow_json || "",Number(row.favorite || 0) ? 1 : 0,Number(row.quick_visible || 0) ? 1 : 0,["execute","insert"].includes(String(row.quick_action || "")) ? row.quick_action : "execute",normalizeCommandSnippetBadge(row.quick_badge),["blue","green","amber","red","cyan","gray","purple"].includes(String(row.quick_color || "")) ? row.quick_color : "blue",Math.max(0,Math.min(1000000,Math.trunc(Number(row.quick_sort_order || 0) || 0))),row.last_used_at || null,row.created_at || now(),row.updated_at || now()]);
      for (const row of snapshot.named_workspaces || []) run("INSERT INTO named_workspaces(id,name,description,layout_json,last_used_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", [row.id,row.name,row.description || "",row.layout_json || "{}",row.last_used_at || null,row.created_at || now(),row.updated_at || now()]);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { ok:true, connections:restoredConnections.length, remote_profiles:restoredRemoteProfiles.length, forwards:snapshot.forwards.length, templates:snapshot.forward_templates.length, snippets:(snapshot.command_snippets || []).length, workspaces:(snapshot.named_workspaces || []).length };
  }

  const CONFIG_SELECTION_VERSION = 1;
  const CONFIG_CONNECTION_SECRET_COLUMNS = ["ssh_password", "private_key_passphrase"];
  const CONFIG_CONNECTION_ENCRYPTED_COLUMNS = [
    "identity_file", "ssh_password", "private_key_passphrase", "extra_args",
    "terminal_program_path", "terminal_program_args", "terminal_working_directory"
  ];
  const CONFIG_CONNECTION_COLUMNS = [
    "name", "group_name", "ssh_host", "ssh_port", "ssh_user", "auth_type", "identity_file",
    "ssh_password", "private_key_passphrase", "ssh_agent_mode", "jump_connection_id",
    "connect_timeout_seconds", "keepalive_interval_seconds", "keepalive_count_max", "tcp_keepalive",
    "x11_mode", "favorite", "last_used_at", "notifications_muted", "tags", "extra_args",
    "autostart_forwards", "sort_order", "terminal_encoding", "terminal_font_family",
    "terminal_font_family_inherit", "terminal_font_size", "terminal_font_size_inherit",
    "terminal_mobile_font_size", "terminal_mobile_font_size_inherit", "terminal_line_height",
    "terminal_font_weight", "terminal_startup_mode", "terminal_profile_name", "terminal_profile_kind",
    "terminal_program_path", "terminal_program_args", "terminal_working_directory",
    "terminal_program_platform", "sftp_text_encoding", "sftp_filename_encoding", "created_at", "updated_at"
  ];

  function normalizeConfigSelection(value: any = {}): any {
    const flag = (item: any) => item === true || item === 1 || item === "1";
    return {
      connections: flag(value.connections),
      remote_profiles: flag(value.remote_profiles ?? value.other_connections),
      forwards: flag(value.forwards),
      command_snippets: flag(value.command_snippets ?? value.batch_commands),
      passwords: flag(value.passwords)
    };
  }

  function secretPlainValue(value: any, label: string): any {
    if (value == null || value === "") return value;
    if (!isEncryptedText(value)) return value;
    try {
      return decryptText(value);
    } catch {
      throw new Error(`配置选择性导出无法解密字段：${label}`);
    }
  }

  function selectionExportRow(row: any, includePasswords: boolean): any {
    const result = {...row};
    for (const column of CONFIG_CONNECTION_ENCRYPTED_COLUMNS) result[column] = secretPlainValue(result[column], `connections.${column}`);
    if (!includePasswords) {
      result.ssh_password = null;
      result.private_key_passphrase = null;
    }
    return result;
  }

  function exportConfigSelection(selectionInput: any = {}): any {
    const selection = normalizeConfigSelection(selectionInput);
    if (!selection.connections && !selection.remote_profiles && !selection.forwards && !selection.command_snippets) {
      throw new Error("请至少选择一类配置");
    }
    const state = encryptionState();
    if (state.enabled) requireEncryptionUnlocked();
    const data: any = {};
    if (selection.connections) {
      data.connections = all("SELECT * FROM connections ORDER BY id").map((row: any) => selectionExportRow(row, selection.passwords));
      data.connection_groups = all("SELECT * FROM connection_groups ORDER BY sort_order,name");
    }
    if (selection.remote_profiles) {
      data.remote_profiles = all("SELECT * FROM remote_profiles ORDER BY id").map((row: any) => ({
        ...row,
        password:selection.passwords ? secretPlainValue(row.password, "remote_profiles.password") : null
      }));
      if (!data.connection_groups) data.connection_groups = all("SELECT * FROM connection_groups ORDER BY sort_order,name");
    }
    if (selection.forwards) {
      data.forwards = all("SELECT * FROM connection_forwards ORDER BY id").map((row: any) => ({...row, pid:null, status:"stopped", restore:0, reconnect_count:0, started_at:null}));
      data.forward_templates = all("SELECT * FROM forward_templates ORDER BY id");
    }
    if (selection.command_snippets) data.command_snippets = all("SELECT * FROM command_snippets ORDER BY id");
    return {
      type:"terma-config-selection",
      version:CONFIG_SELECTION_VERSION,
      created_at:new Date().toISOString(),
      selection,
      data
    };
  }

  function boundedText(value: any, label: string, maximum = 4096, fallback = ""): string {
    const result = String(value ?? fallback);
    if (result.includes("\0") || result.length > maximum) throw new Error(`${label} 配置无效`);
    return result;
  }

  function importedPlainValue(value: any, label: string): any {
    if (value == null || value === "") return value;
    return secretPlainValue(value, label);
  }

  function currentSecretValue(value: any): any {
    if (value == null) return null;
    const plain = String(value);
    if (!plain) return "";
    return encryptionState().enabled ? encryptText(plain) : plain;
  }

  function normalizeImportedConnection(source: any, includePasswords: boolean): any {
    const item: any = {};
    item.name = boundedText(source.name, "连接名称", 120).trim();
    item.group_name = boundedText(source.group_name || "默认分组", "分组名称", 120).trim() || "默认分组";
    item.ssh_host = validateSshHost(boundedText(source.ssh_host, "SSH 主机", 255));
    item.ssh_user = validateSshUser(boundedText(source.ssh_user, "SSH 用户", 255));
    if (!item.name || !item.ssh_host || !item.ssh_user) throw new Error("SSH 连接缺少名称、主机或用户");
    item.ssh_port = Number.isInteger(Number(source.ssh_port)) && Number(source.ssh_port) >= 1 && Number(source.ssh_port) <= 65535 ? Number(source.ssh_port) : 22;
    item.auth_type = String(source.auth_type || "key") === "password" ? "password" : "key";
    const identityPlain = importedPlainValue(source.identity_file, "connections.identity_file");
    item.identity_file = identityPlain && allowedIdentityPath(String(identityPlain)) ? allowedIdentityPath(String(identityPlain)) : null;
    for (const column of CONFIG_CONNECTION_COLUMNS) {
      if (Object.prototype.hasOwnProperty.call(item, column)) continue;
      if (column === "ssh_password" || column === "private_key_passphrase") continue;
      let value = source[column];
      if (CONFIG_CONNECTION_ENCRYPTED_COLUMNS.includes(column)) value = importedPlainValue(value, `connections.${column}`);
      item[column] = value;
    }
    item.ssh_password = includePasswords ? currentSecretValue(importedPlainValue(source.ssh_password, "connections.ssh_password")) : undefined;
    item.private_key_passphrase = includePasswords ? currentSecretValue(importedPlainValue(source.private_key_passphrase, "connections.private_key_passphrase")) : undefined;
    item.identity_file = currentSecretValue(item.identity_file);
    item.terminal_program_path = currentSecretValue(item.terminal_program_path || "");
    item.terminal_program_args = currentSecretValue(item.terminal_program_args || "");
    item.terminal_working_directory = currentSecretValue(item.terminal_working_directory || "");
    item.jump_connection_id = Number.isInteger(Number(source.jump_connection_id)) && Number(source.jump_connection_id) > 0 ? Number(source.jump_connection_id) : null;
    item.ssh_agent_mode = new Set(["auto", "off", "required"]).has(String(source.ssh_agent_mode)) ? String(source.ssh_agent_mode) : "auto";
    item.x11_mode = new Set(["off", "untrusted", "trusted"]).has(String(source.x11_mode)) ? String(source.x11_mode) : "off";
    item.terminal_startup_mode = TERMINAL_STARTUP_MODES.has(String(source.terminal_startup_mode)) ? String(source.terminal_startup_mode) : "default";
    item.terminal_profile_kind = TERMINAL_PROFILE_KINDS.has(String(source.terminal_profile_kind)) ? String(source.terminal_profile_kind) : "shell";
    item.terminal_program_platform = TERMINAL_PROGRAM_PLATFORMS.has(String(source.terminal_program_platform)) ? String(source.terminal_program_platform) : "auto";
    item.terminal_encoding = String(source.terminal_encoding || "utf8");
    item.sftp_text_encoding = String(source.sftp_text_encoding || "auto");
    item.sftp_filename_encoding = String(source.sftp_filename_encoding || "utf8");
    item.favorite = Number(source.favorite || 0) ? 1 : 0;
    item.notifications_muted = Number(source.notifications_muted || 0) ? 1 : 0;
    item.tcp_keepalive = Number(source.tcp_keepalive ?? 1) ? 1 : 0;
    item.autostart_forwards = Number(source.autostart_forwards || 0) ? 1 : 0;
    item.sort_order = Number.isInteger(Number(source.sort_order)) && Number(source.sort_order) > 0 ? Number(source.sort_order) : 1;
    item.connect_timeout_seconds = Number(source.connect_timeout_seconds) || 10;
    item.keepalive_interval_seconds = Number(source.keepalive_interval_seconds) || 60;
    item.keepalive_count_max = Number(source.keepalive_count_max) || 3;
    const extraArgsPlain = boundedText(importedPlainValue(source.extra_args || "", "connections.extra_args"), "SSH 参数", 8192);
    assertSafeExtraArgs(extraArgsPlain, {
      connect_timeout_seconds:item.connect_timeout_seconds,
      keepalive_interval_seconds:item.keepalive_interval_seconds,
      keepalive_count_max:item.keepalive_count_max,
      tcp_keepalive:item.tcp_keepalive
    });
    item.extra_args = currentSecretValue(extraArgsPlain);
    item.terminal_font_family = boundedText(source.terminal_font_family || DEFAULT_TERMINAL_FONT, "终端字体", 300);
    item.terminal_font_family_inherit = Number(source.terminal_font_family_inherit ?? 1) ? 1 : 0;
    item.terminal_font_size = Number(source.terminal_font_size) || 13;
    item.terminal_font_size_inherit = Number(source.terminal_font_size_inherit ?? 1) ? 1 : 0;
    item.terminal_mobile_font_size = Number(source.terminal_mobile_font_size) || 13;
    item.terminal_mobile_font_size_inherit = Number(source.terminal_mobile_font_size_inherit ?? 1) ? 1 : 0;
    item.terminal_line_height = Number(source.terminal_line_height) || 1;
    item.terminal_font_weight = ["normal", "500", "600", "bold"].includes(String(source.terminal_font_weight)) ? String(source.terminal_font_weight) : "normal";
    item.created_at = Number(source.created_at) || now();
    item.updated_at = Number(source.updated_at) || now();
    return item;
  }

  function findImportedConnection(source: any) {
    const byId = Number(source.id);
    if (Number.isInteger(byId) && byId > 0) {
      const row = get("SELECT * FROM connections WHERE id=?", [byId]);
      if (row && String(row.ssh_host) === String(source.ssh_host) && Number(row.ssh_port) === Number(source.ssh_port || 22) && String(row.ssh_user) === String(source.ssh_user)) return row;
    }
    return get("SELECT * FROM connections WHERE name=? AND ssh_host=? AND ssh_port=? AND ssh_user=? LIMIT 1", [source.name, source.ssh_host, Number(source.ssh_port || 22), source.ssh_user]);
  }

  function saveImportedConnection(source: any, includePasswords: boolean, idMap: Map<number, number>): any {
    const item = normalizeImportedConnection(source, includePasswords);
    const existing = findImportedConnection(source);
    const fields = CONFIG_CONNECTION_COLUMNS.filter(column => includePasswords || !CONFIG_CONNECTION_SECRET_COLUMNS.includes(column));
    const values = fields.map(column => {
      if (column === "jump_connection_id") return null;
      if (column === "last_used_at") return null;
      if (column === "identity_file" || column === "extra_args" || column === "terminal_program_path" || column === "terminal_program_args" || column === "terminal_working_directory") return item[column] ?? null;
      return item[column] ?? null;
    });
    const jumpSource = Number(source.jump_connection_id);
    const jumpTarget = idMap.get(jumpSource);
    const jumpIndex = fields.indexOf("jump_connection_id");
    if (jumpIndex >= 0) values[jumpIndex] = jumpTarget || null;
    let targetId: number;
    if (existing) {
      const assignments = fields.map(column => `${column}=?`).join(",");
      run(`UPDATE connections SET ${assignments} WHERE id=?`, [...values, Number(existing.id)]);
      targetId = Number(existing.id);
    } else {
      const result = run(`INSERT INTO connections(${fields.join(",")}) VALUES(${fields.map(() => "?").join(",")})`, values);
      targetId = Number(result.lastInsertRowid);
    }
    const sourceId = Number(source.id);
    if (Number.isInteger(sourceId) && sourceId > 0) idMap.set(sourceId, targetId);
    return targetId;
  }

  function normalizeImportedRemote(source: any, includePasswords: boolean, idMap: Map<number, number>): any {
    const options = (() => {
      try {
        const parsed = typeof source.options_json === "string" ? JSON.parse(source.options_json || "{}") : (source.options || {});
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? {...parsed} : {};
      } catch { return {}; }
    })();
    for (const key of ["source_ssh_connection_id", "ssh_connection_id"]) {
      const oldId = Number(options[key] || 0);
      if (oldId) options[key] = idMap.get(oldId) || oldId;
    }
    const item: any = {
      name:boundedText(source.name, "远程连接名称", 120).trim(),
      group_name:boundedText(source.group_name || "默认分组", "分组名称", 120).trim() || "默认分组",
      protocol:String(source.protocol || "").toLowerCase(),
      host:boundedText(source.host || "", "远程主机", 2048).trim(),
      port:source.port == null ? null : Number(source.port),
      username:boundedText(source.username || "", "远程用户名", 255).trim(),
      tags:boundedText(source.tags || "", "标签", 2048),
      options
    };
    if (includePasswords) item.password = importedPlainValue(source.password, "remote_profiles.password");
    else item.clear_password = false;
    return item;
  }

  function findImportedRemote(source: any) {
    const id = Number(source.id);
    if (Number.isInteger(id) && id > 0) {
      const row = get("SELECT * FROM remote_profiles WHERE id=?", [id]);
      if (row && String(row.protocol) === String(source.protocol) && String(row.host || "") === String(source.host || "")) return row;
    }
    return get("SELECT * FROM remote_profiles WHERE name=? LIMIT 1", [source.name]);
  }

  function saveImportedRemote(source: any, includePasswords: boolean, idMap: Map<number, number>): number {
    const item = normalizeImportedRemote(source, includePasswords, idMap);
    const existing = findImportedRemote(source);
    const cleaned = cleanRemoteProfile(item, existing || null);
    if (existing) {
      run("UPDATE remote_profiles SET name=?,group_name=?,protocol=?,host=?,port=?,username=?,password=?,favorite=?,tags=?,options_json=?,updated_at=? WHERE id=?", [cleaned.name,cleaned.group_name,cleaned.protocol,cleaned.host,cleaned.port,cleaned.username,includePasswords ? cleaned.password : existing.password,Number(source.favorite || 0) ? 1 : 0,cleaned.tags,cleaned.options_json,now(),Number(existing.id)]);
      return Number(existing.id);
    }
    const result = run("INSERT INTO remote_profiles(name,group_name,protocol,host,port,username,password,favorite,last_used_at,tags,options_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?,?)", [cleaned.name,cleaned.group_name,cleaned.protocol,cleaned.host,cleaned.port,cleaned.username,includePasswords ? cleaned.password : null,Number(source.favorite || 0) ? 1 : 0,cleaned.tags,cleaned.options_json,Number(source.created_at) || now(),Number(source.updated_at) || now()]);
    return Number(result.lastInsertRowid);
  }

  function saveImportedForward(source: any, idMap: Map<number, number>): boolean {
    const connectionId = idMap.get(Number(source.connection_id));
    if (!connectionId) return false;
    const item = cleanForward(source);
    const existing = Number(source.id) > 0 ? get("SELECT id FROM connection_forwards WHERE id=? AND connection_id=?", [Number(source.id), connectionId]) : null;
    const values = [connectionId,item.mode,item.service_name,item.service_type,item.service_note,item.url_scheme,item.url_path,item.bind_host,item.bind_port,item.target_host,item.target_port,Number(source.created_at) || now(),Number(source.updated_at) || now()];
    if (existing) {
      run("UPDATE connection_forwards SET connection_id=?,mode=?,service_name=?,service_type=?,service_note=?,url_scheme=?,url_path=?,bind_host=?,bind_port=?,target_host=?,target_port=?,pid=NULL,status='stopped',restore=0,reconnect_count=0,started_at=NULL,updated_at=? WHERE id=?", [...values.slice(0, 11), values[12], Number(existing.id)]);
    } else {
      run("INSERT INTO connection_forwards(connection_id,mode,service_name,service_type,service_note,url_scheme,url_path,bind_host,bind_port,target_host,target_port,pid,status,restore,reconnect_count,started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,'stopped',0,0,NULL,?,?)", values);
    }
    return true;
  }

  function saveImportedTemplate(source: any): boolean {
    const name = boundedText(source.name, "转发模板名称", 120).trim();
    if (!name) return false;
    const item = cleanForward(source);
    const existing = Number(source.id) > 0 ? get("SELECT id FROM forward_templates WHERE id=? AND name=?", [Number(source.id), name]) : get("SELECT id FROM forward_templates WHERE name=?", [name]);
    const values = [name,item.mode,item.service_name,item.service_type,item.service_note,item.url_scheme,item.url_path,item.bind_host,item.bind_port,item.target_host,item.target_port,Number(source.updated_at) || now()];
    if (existing) run("UPDATE forward_templates SET name=?,mode=?,service_name=?,service_type=?,service_note=?,url_scheme=?,url_path=?,bind_host=?,bind_port=?,target_host=?,target_port=?,updated_at=? WHERE id=?", [...values, Number(existing.id)]);
    else run("INSERT INTO forward_templates(name,mode,service_name,service_type,service_note,url_scheme,url_path,bind_host,bind_port,target_host,target_port,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", [...values.slice(0, 11), Number(source.created_at) || now(), values[11]]);
    return true;
  }

  function saveImportedSnippet(source: any): boolean {
    const name = boundedText(source.name, "命令名称", 120).trim();
    const command = boundedText(source.command, "命令内容", 16384);
    if (!name || !command) return false;
    const existing = Number(source.id) > 0 ? get("SELECT id FROM command_snippets WHERE id=? AND name=? AND command=?", [Number(source.id), name, command]) : get("SELECT id FROM command_snippets WHERE name=? AND command=?", [name, command]);
    const fields = ["name","group_name","command","description","tags","workflow_json","favorite","quick_visible","quick_action","quick_badge","quick_color","quick_sort_order","last_used_at","created_at","updated_at"];
    const values = [name,boundedText(source.group_name || "默认分组", "命令分组", 120),command,boundedText(source.description || "", "命令描述", 4096),boundedText(source.tags || "", "命令标签", 2048),boundedText(source.workflow_json || "", "命令流程", 65536),Number(source.favorite || 0) ? 1 : 0,Number(source.quick_visible || 0) ? 1 : 0,["execute", "insert"].includes(String(source.quick_action)) ? String(source.quick_action) : "execute",normalizeCommandSnippetBadge(source.quick_badge),["blue", "green", "amber", "red", "cyan", "gray", "purple"].includes(String(source.quick_color)) ? String(source.quick_color) : "blue",Math.max(0,Math.min(1000000,Math.trunc(Number(source.quick_sort_order || 0) || 0))),null,Number(source.created_at) || now(),Number(source.updated_at) || now()];
    if (existing) run(`UPDATE command_snippets SET ${fields.map(field => `${field}=?`).join(",")} WHERE id=?`, [...values, Number(existing.id)]);
    else run(`INSERT INTO command_snippets(${fields.join(",")}) VALUES(${fields.map(() => "?").join(",")})`, values);
    return true;
  }

  function restoreConfigSelection(payload: any): any {
    if (!payload || payload.type !== "terma-config-selection" || Number(payload.version) !== CONFIG_SELECTION_VERSION) throw new Error("选择性配置包格式无效");
    const selection = normalizeConfigSelection(payload.selection);
    const data = payload.data && typeof payload.data === "object" ? payload.data : {};
    const state = encryptionState();
    if (state.enabled) requireEncryptionUnlocked();
    if (!selection.connections && !selection.remote_profiles && !selection.forwards && !selection.command_snippets) throw new Error("选择性配置包没有可导入的配置");
    const idMap = new Map<number, number>();
    const result: any = {ok:true, connections:0, remote_profiles:0, forwards:0, forward_templates:0, command_snippets:0, skipped_forwards:0};
    db.exec("BEGIN IMMEDIATE");
    try {
      if (selection.connections || selection.remote_profiles) {
        for (const group of Array.isArray(data.connection_groups) ? data.connection_groups.slice(0, 1000) : []) {
          const name = boundedText(group.name, "分组名称", 120).trim();
          if (!name) continue;
          run("INSERT OR IGNORE INTO connection_groups(name,sort_order,created_at,updated_at) VALUES(?,?,?,?)", [name,Number(group.sort_order) || 1,Number(group.created_at) || now(),Number(group.updated_at) || now()]);
        }
      }
      if (!selection.connections && (selection.remote_profiles || selection.forwards)) {
        const referencedIds = new Set<number>();
        for (const source of [...(Array.isArray(data.forwards) ? data.forwards : []), ...(Array.isArray(data.remote_profiles) ? data.remote_profiles : [])]) {
          const options = typeof source.options_json === "string" ? (() => { try { return JSON.parse(source.options_json || "{}"); } catch { return {}; } })() : (source.options || {});
          const ids = [source.connection_id, options?.source_ssh_connection_id, options?.ssh_connection_id];
          for (const id of ids) if (Number.isInteger(Number(id)) && Number(id) > 0) referencedIds.add(Number(id));
        }
        for (const id of referencedIds) if (get("SELECT id FROM connections WHERE id=?", [id])) idMap.set(id, id);
      }
      if (selection.connections) for (const source of Array.isArray(data.connections) ? data.connections.slice(0, 10000) : []) { saveImportedConnection(source, selection.passwords, idMap); result.connections += 1; }
      if (selection.connections) {
        for (const source of Array.isArray(data.connections) ? data.connections.slice(0, 10000) : []) {
          const targetId = idMap.get(Number(source.id));
          const jumpTarget = idMap.get(Number(source.jump_connection_id));
          if (targetId) run("UPDATE connections SET jump_connection_id=? WHERE id=?", [jumpTarget || null, targetId]);
        }
      }
      if (selection.remote_profiles) for (const source of Array.isArray(data.remote_profiles) ? data.remote_profiles.slice(0, 10000) : []) { saveImportedRemote(source, selection.passwords, idMap); result.remote_profiles += 1; }
      if (selection.forwards) {
        for (const source of Array.isArray(data.forwards) ? data.forwards.slice(0, 20000) : []) {
          if (saveImportedForward(source, idMap)) result.forwards += 1; else result.skipped_forwards += 1;
        }
        for (const source of Array.isArray(data.forward_templates) ? data.forward_templates.slice(0, 10000) : []) if (saveImportedTemplate(source)) result.forward_templates += 1;
      }
      if (selection.command_snippets) for (const source of Array.isArray(data.command_snippets) ? data.command_snippets.slice(0, 10000) : []) if (saveImportedSnippet(source)) result.command_snippets += 1;
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return result;
  }

  return { exportConfigSnapshot, restoreConfigSnapshot, exportConfigSelection, restoreConfigSelection };
}

module.exports = { createConfigSnapshotService };

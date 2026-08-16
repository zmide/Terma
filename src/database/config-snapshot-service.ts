const { decryptText, encryptionState, encryptText, isEncryptedText, requireEncryptionUnlocked } = require("../crypto-store");
const { DEFAULT_TERMINAL_FONT, TERMINAL_PROFILE_KINDS, TERMINAL_PROGRAM_PLATFORMS, TERMINAL_STARTUP_MODES } = require("./connection-normalizer");
const databaseCore = require("./core");
const { all, now, run } = databaseCore;
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
  if (typeof cleanRemoteProfile !== "function") throw new Error("cleanRemoteProfile is required");

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
      for (const row of snapshot.forwards) run("INSERT INTO connection_forwards(id,connection_id,mode,service_name,service_type,service_note,url_scheme,bind_host,bind_port,target_host,target_port,pid,status,restore,reconnect_count,last_error,last_error_code,started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [row.id,row.connection_id,row.mode,row.service_name,row.service_type,row.service_note,row.url_scheme,row.bind_host,row.bind_port,row.target_host,row.target_port,null,"stopped",0,0,row.last_error || null,row.last_error_code || null,null,row.created_at,row.updated_at]);
      for (const row of snapshot.forward_templates) run("INSERT INTO forward_templates(id,name,mode,service_name,service_type,service_note,url_scheme,bind_host,bind_port,target_host,target_port,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", [row.id,row.name,row.mode,row.service_name,row.service_type,row.service_note,row.url_scheme,row.bind_host,row.bind_port,row.target_host,row.target_port,row.created_at,row.updated_at]);
      for (const row of snapshot.command_snippets || []) run("INSERT INTO command_snippets(id,name,group_name,command,description,tags,favorite,quick_visible,quick_action,quick_badge,quick_color,quick_sort_order,last_used_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [row.id,row.name,row.group_name || "默认分组",row.command,row.description || "",row.tags || "",Number(row.favorite || 0) ? 1 : 0,Number(row.quick_visible || 0) ? 1 : 0,["execute","insert"].includes(String(row.quick_action || "")) ? row.quick_action : "execute",normalizeCommandSnippetBadge(row.quick_badge),["blue","green","amber","red","cyan","gray","purple"].includes(String(row.quick_color || "")) ? row.quick_color : "blue",Math.max(0,Math.min(1000000,Math.trunc(Number(row.quick_sort_order || 0) || 0))),row.last_used_at || null,row.created_at || now(),row.updated_at || now()]);
      for (const row of snapshot.named_workspaces || []) run("INSERT INTO named_workspaces(id,name,description,layout_json,last_used_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)", [row.id,row.name,row.description || "",row.layout_json || "{}",row.last_used_at || null,row.created_at || now(),row.updated_at || now()]);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { ok:true, connections:restoredConnections.length, remote_profiles:restoredRemoteProfiles.length, forwards:snapshot.forwards.length, templates:snapshot.forward_templates.length, snippets:(snapshot.command_snippets || []).length, workspaces:(snapshot.named_workspaces || []).length };
  }

  return { exportConfigSnapshot, restoreConfigSnapshot };
}

module.exports = { createConfigSnapshotService };

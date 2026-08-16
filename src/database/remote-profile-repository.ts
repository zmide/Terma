interface RemoteProfileRepositoryDependencies {
  all(sql: string, params?: any): any[];
  get(sql: string, params?: any): any;
  run(sql: string, params?: any): any;
  exec(sql: string): void;
  now(): number;
  decryptText(value: unknown): any;
  encryptText(value: unknown): any;
  requireEncryptionUnlocked(): void;
  ensureConnectionGroup(name: string): void;
  getConnection(id: number): any;
  validatePort(value: unknown, label: string): number;
  boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, label: string): number;
}

const { normalizeRemoteHost, validateRemoteHost } = require("../remote-host");

const REMOTE_PROTOCOLS = new Set(["rdp", "vnc", "xdmcp", "ftp", "telnet", "serial"]);
const REMOTE_DEFAULT_PORTS: Record<string, number> = { rdp:3389, vnc:5900, xdmcp:177, ftp:21, telnet:23 };
const REMOTE_TERMINAL_ENCODINGS = new Set(["utf8", "gb18030", "gbk", "big5", "shift_jis", "euc-kr", "latin1"]);

export function createRemoteProfileRepository(dependencies: RemoteProfileRepositoryDependencies) {
  const { all, get, run, now } = dependencies;

  function parseRemoteOptions(value: any) {
    if (!value) return {};
    if (typeof value === "object" && !Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function cleanRemoteOptions(protocol: string, source: any = {}) {
    const value: any = parseRemoteOptions(source);
    const bool = (key: string, fallback = false) => Boolean(value[key] ?? fallback);
    const text = (key: string, fallback = "", maximum = 2048) => {
      const result = String(value[key] ?? fallback).trim();
      if (result.includes("\0") || /[\r\n]/.test(result) || result.length > maximum) throw new Error(`${key} 配置无效`);
      return result;
    };
    const integer = (key: string, fallback: number, minimum: number, maximum: number) =>
      dependencies.boundedInteger(value[key], fallback, minimum, maximum, key);
    const sourceSshId = integer("source_ssh_connection_id", 0, 0, 2147483647);
    const withSource = (options: any) => sourceSshId ? {...options, source_ssh_connection_id:sourceSshId} : options;
    if (protocol === "rdp") {
      const legacyFullscreen = Object.prototype.hasOwnProperty.call(value, "fullscreen") ? bool("fullscreen") : null;
      const displayMode = new Set(["dynamic", "fullscreen", "fixed"]).has(String(value.display_mode))
        ? String(value.display_mode)
        : legacyFullscreen === true
          ? "fullscreen"
          : legacyFullscreen === false
            ? "fixed"
            : "dynamic";
      return withSource({
        domain:text("domain", "", 255),
        display_mode:displayMode,
        fullscreen:displayMode === "fullscreen",
        width:integer("width", 1440, 640, 8192),
        height:integer("height", 900, 480, 8192),
        admin_session:bool("admin_session"),
        clipboard:bool("clipboard", true),
        audio:new Set(["local", "remote", "off"]).has(String(value.audio)) ? String(value.audio) : "local",
        allow_password_transfer:bool("allow_password_transfer")
      });
    }
    if (protocol === "vnc") {
      const serverSessionMode = new Set(["auto", "shared", "virtual"]).has(String(value.server_session_mode))
        ? String(value.server_session_mode)
        : "auto";
      const serverDisplay = text("server_display", "", 32);
      if (serverDisplay && !/^:[0-9]+(?:\.[0-9]+)?$/.test(serverDisplay)) throw new Error("VNC 服务端显示编号无效");
      return withSource({
        client_mode:new Set(["auto", "embedded", "system"]).has(String(value.client_mode)) ? String(value.client_mode) : "auto",
        cursor_mode:new Set(["auto", "show", "hide"]).has(String(value.cursor_mode)) ? String(value.cursor_mode) : "auto",
        display_mode:new Set(["scale", "original", "resize"]).has(String(value.display_mode)) ? String(value.display_mode) : "scale",
        server_session_mode:serverSessionMode,
        server_display:serverSessionMode === "shared" ? serverDisplay : "",
        view_only:bool("view_only"),
        shared:bool("shared", true),
        quality:integer("quality", 8, 0, 9)
      });
    }
    if (protocol === "xdmcp") {
      const rawWindowMode = String(value.window_mode || "");
      const windowMode = new Set(["resizable", "fullscreen", "fixed"]).has(rawWindowMode)
        ? rawWindowMode
        : rawWindowMode === "windowed"
          ? "fixed"
          : "resizable";
      return withSource({
        mode:new Set(["query", "indirect", "broadcast"]).has(String(value.mode)) ? String(value.mode) : "query",
        window_mode:windowMode,
        width:integer("width", 1440, 640, 8192),
        height:integer("height", 900, 480, 8192),
        local_address:text("local_address", "", 255),
        ssh_connection_id:integer("ssh_connection_id", 0, 0, 2147483647)
      });
    }
    if (protocol === "ftp") return withSource({
      secure:new Set(["none", "explicit", "implicit"]).has(String(value.secure)) ? String(value.secure) : "none",
      passive:bool("passive", true),
      reject_unauthorized:bool("reject_unauthorized", true),
      base_path:text("base_path", "/", 2048) || "/"
    });
    if (protocol === "telnet") {
      const encoding = String(value.encoding || "utf8").toLowerCase();
      if (!REMOTE_TERMINAL_ENCODINGS.has(encoding)) throw new Error("不支持的 Telnet 编码");
      return withSource({ terminal_type:text("terminal_type", "xterm-256color", 80) || "xterm-256color", encoding });
    }
    const encoding = String(value.encoding || "utf8").toLowerCase();
    if (!REMOTE_TERMINAL_ENCODINGS.has(encoding)) throw new Error("不支持的串口编码");
    const dataBits = Number(value.data_bits || 8);
    const stopBits = Number(value.stop_bits || 1);
    const parity = String(value.parity || "none").toLowerCase();
    if (![5, 6, 7, 8].includes(dataBits)) throw new Error("串口数据位无效");
    if (![1, 1.5, 2].includes(stopBits)) throw new Error("串口停止位无效");
    if (!["none", "even", "odd", "mark", "space"].includes(parity)) throw new Error("串口校验位无效");
    return withSource({
      path:text("path", "", 1024),
      baud_rate:integer("baud_rate", 115200, 50, 4000000),
      data_bits:dataBits,
      stop_bits:stopBits,
      parity,
      rts_cts:bool("rts_cts"),
      xon:bool("xon"),
      xoff:bool("xoff"),
      encoding
    });
  }

  function cleanRemoteProfile(data: any, existing: any = null) {
    dependencies.requireEncryptionUnlocked();
    const protocol = String(data.protocol || existing?.protocol || "").trim().toLowerCase();
    if (!REMOTE_PROTOCOLS.has(protocol)) throw new Error("不支持的远程连接协议");
    const name = String(data.name || existing?.name || "").trim();
    if (!name || name.length > 120) throw new Error("连接名称长度必须在 1-120 个字符之间");
    const options = cleanRemoteOptions(protocol, data.options ?? existing?.options_json);
    const requiresHost = protocol !== "serial" && !(protocol === "xdmcp" && options.mode === "broadcast");
    const host = protocol === "serial"
      ? ""
      : validateRemoteHost(data.host ?? existing?.host ?? "", {required:requiresHost});
    const submittedPassword = Object.prototype.hasOwnProperty.call(data, "password") ? String(data.password || "") : "";
    const keepExistingPassword = !data.clear_password && existing?.password;
    const password = submittedPassword || (keepExistingPassword ? dependencies.decryptText(existing.password) : "");
    if (password.length > 4096) throw new Error("密码长度不能超过 4096 个字符");
    const username = (() => {
      const value = String(data.username ?? existing?.username ?? "").trim();
      if (/[\0\r\n]/.test(value)) throw new Error("用户名无效");
      return value.slice(0, 255);
    })();
    if (protocol === "rdp" && options.allow_password_transfer && password && !username) {
      throw new Error("允许传递 RDP 密码时必须填写用户名");
    }
    if (protocol === "serial" && !options.path) throw new Error("请选择串口设备");
    return {
      name,
      group_name:String(data.group_name || existing?.group_name || "默认分组").trim() || "默认分组",
      protocol,
      host,
      port:protocol === "serial" ? null : dependencies.validatePort(data.port || existing?.port || REMOTE_DEFAULT_PORTS[protocol], `${protocol.toUpperCase()} 端口`),
      username,
      password:password ? dependencies.encryptText(password) : null,
      favorite:Number(data.favorite ?? existing?.favorite ?? 0) ? 1 : 0,
      tags:String(data.tags ?? existing?.tags ?? "").split(/[,，\s]+/).map(item => item.trim()).filter(Boolean).join(","),
      options_json:JSON.stringify(options)
    };
  }

  function remoteProfileView(row: any, includeSecret = false) {
    const options = cleanRemoteOptions(String(row.protocol), row.options_json);
    let host = String(row.host || "").trim();
    if (String(row.protocol) !== "serial") {
      try { host = normalizeRemoteHost(host); } catch {}
    } else host = "";
    return {
      ...row,
      kind:"remote",
      host,
      options,
      options_json:undefined,
      password:includeSecret ? dependencies.decryptText(row.password) : undefined,
      has_password:Boolean(row.password)
    };
  }

  function listRemoteProfiles() {
    return all(`SELECT remote_profiles.*, connection_groups.sort_order AS group_sort_order
      FROM remote_profiles LEFT JOIN connection_groups ON connection_groups.name=remote_profiles.group_name
      ORDER BY COALESCE(connection_groups.sort_order,2147483647), remote_profiles.name COLLATE NOCASE, remote_profiles.created_at, remote_profiles.id`)
      .map(row => remoteProfileView(row));
  }

  function getRemoteProfile(id: number) {
    const row = get("SELECT * FROM remote_profiles WHERE id=?", [Number(id)]);
    if (!row) throw new Error("远程连接不存在");
    return remoteProfileView(row, true);
  }

  function insertRemoteProfile(data: any) {
    const item = cleanRemoteProfile(data);
    dependencies.ensureConnectionGroup(item.group_name);
    const timestamp = now();
    const result = run(`INSERT INTO remote_profiles(name,group_name,protocol,host,port,username,password,favorite,last_used_at,tags,options_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,NULL,?,?,?,?)`, [item.name,item.group_name,item.protocol,item.host,item.port,item.username,item.password,item.favorite,item.tags,item.options_json,timestamp,timestamp]);
    return Number(result.lastInsertRowid);
  }

  function createRemoteProfileFromConnection(connectionId: number, protocolValue: unknown) {
    const protocol = String(protocolValue || "").trim().toLowerCase();
    if (!REMOTE_PROTOCOLS.has(protocol) || protocol === "serial") throw new Error("该协议不能从 SSH 连接生成");
    const connection = dependencies.getConnection(connectionId);
    const existing = listRemoteProfiles().find(profile => profile.protocol === protocol
      && Number(profile.options?.source_ssh_connection_id || 0) === Number(connection.id));
    if (existing) return {id:existing.id, name:existing.name, protocol, created:false};
    const labels: Record<string, string> = {rdp:"RDP", vnc:"VNC", xdmcp:"XDMCP", ftp:"FTP", telnet:"Telnet"};
    const baseName = `${connection.name} · ${labels[protocol] || protocol.toUpperCase()}`.slice(0, 120);
    const names = new Set(listRemoteProfiles().map(profile => String(profile.name || "").toLocaleLowerCase()));
    let name = baseName;
    let suffix = 2;
    while (names.has(name.toLocaleLowerCase())) {
      const ending = `（${suffix}）`;
      name = `${baseName.slice(0, Math.max(1, 120 - ending.length))}${ending}`;
      suffix += 1;
    }
    const options = {
      source_ssh_connection_id:Number(connection.id),
      ...(protocol === "xdmcp" ? {ssh_connection_id:Number(connection.id)} : {})
    };
    const id = insertRemoteProfile({
      protocol,
      name,
      group_name:connection.group_name || "默认分组",
      host:connection.ssh_host,
      port:REMOTE_DEFAULT_PORTS[protocol],
      username:["vnc", "ftp"].includes(protocol) ? connection.ssh_user : "",
      password:"",
      tags:connection.tags || "",
      options
    });
    return {id, name, protocol, created:true};
  }

  function createAllRemoteProfilesFromConnection(connectionId: number) {
    const protocols = ["rdp", "vnc", "xdmcp", "ftp", "telnet"];
    dependencies.exec("BEGIN IMMEDIATE");
    try {
      const results = protocols.map(protocol => createRemoteProfileFromConnection(connectionId, protocol));
      dependencies.exec("COMMIT");
      return {
        results,
        created_count:results.filter(item => item.created).length,
        existing_count:results.filter(item => !item.created).length
      };
    } catch (error) {
      dependencies.exec("ROLLBACK");
      throw error;
    }
  }

  function updateRemoteProfile(id: number, data: any) {
    const existing = get("SELECT * FROM remote_profiles WHERE id=?", [Number(id)]);
    if (!existing) throw new Error("远程连接不存在");
    const item = cleanRemoteProfile(data, existing);
    dependencies.ensureConnectionGroup(item.group_name);
    run(`UPDATE remote_profiles SET name=?,group_name=?,protocol=?,host=?,port=?,username=?,password=?,favorite=?,tags=?,options_json=?,updated_at=? WHERE id=?`,
      [item.name,item.group_name,item.protocol,item.host,item.port,item.username,item.password,item.favorite,item.tags,item.options_json,now(),Number(id)]);
    return getRemoteProfile(id);
  }

  function repairRemoteProfileManagementConnection(id: number, connectionId: number) {
    const profileId = Number(id);
    const resolvedConnectionId = Number(connectionId);
    if (!Number.isInteger(profileId) || profileId < 1) throw new Error("远程连接 ID 无效");
    if (!Number.isInteger(resolvedConnectionId) || resolvedConnectionId < 1) throw new Error("SSH 管理连接 ID 无效");
    const connection = dependencies.getConnection(resolvedConnectionId);
    const existing = get("SELECT protocol,host,options_json FROM remote_profiles WHERE id=?", [profileId]);
    if (!existing) throw new Error("远程连接不存在");
    const profileHost = normalizeRemoteHost(existing.host).trim().toLowerCase().replace(/\.$/, "").replace(/^::ffff:/, "");
    const connectionHost = normalizeRemoteHost(connection.ssh_host).trim().toLowerCase().replace(/\.$/, "").replace(/^::ffff:/, "");
    if (!profileHost || profileHost !== connectionHost) {
      throw new Error("SSH 管理连接与远程连接主机不一致，拒绝修复关联");
    }
    const options = parseRemoteOptions(existing.options_json);
    const currentSourceId = Number(options.source_ssh_connection_id || 0);
    const currentXdmcpId = Number(options.ssh_connection_id || 0);
    if (currentSourceId === resolvedConnectionId
      && (String(existing.protocol) !== "xdmcp" || currentXdmcpId === resolvedConnectionId)) return false;
    options.source_ssh_connection_id = resolvedConnectionId;
    if (String(existing.protocol) === "xdmcp") options.ssh_connection_id = resolvedConnectionId;
    run("UPDATE remote_profiles SET options_json=?,updated_at=? WHERE id=?", [JSON.stringify(options),now(),profileId]);
    return true;
  }

  function getVncProfileCredential(id: number) {
    const profile = getRemoteProfile(id);
    if (profile.protocol !== "vnc") throw new Error("该连接不是 VNC 配置");
    return {has_password:Boolean(profile.password), password:String(profile.password || "")};
  }

  function updateVncProfileCredential(id: number, value: unknown) {
    dependencies.requireEncryptionUnlocked();
    const profile = getRemoteProfile(id);
    if (profile.protocol !== "vnc") throw new Error("该连接不是 VNC 配置");
    const password = String(value || "");
    if (password.length > 4096) throw new Error("VNC 密码长度不能超过 4096 个字符");
    run("UPDATE remote_profiles SET password=?,updated_at=? WHERE id=?", [password ? dependencies.encryptText(password) : null,now(),Number(id)]);
    return {ok:true, has_password:Boolean(password)};
  }

  function duplicateRemoteProfile(id: number) {
    const source = getRemoteProfile(id);
    const base = String(source.name || "连接").replace(/\s*(?:（copy\d+）|\(copy\d+\))$/i, "").trim() || "连接";
    const existing = new Set(all("SELECT name FROM remote_profiles").map(item => String(item.name || "").toLocaleLowerCase()));
    let index = 1;
    while (existing.has(`${base}（copy${index}）`.toLocaleLowerCase())) index += 1;
    const name = `${base}（copy${index}）`;
    const profileId = insertRemoteProfile({...source, name, password:source.password || "", options:source.options});
    return {id:profileId, name};
  }

  function deleteRemoteProfile(id: number) {
    const result = run("DELETE FROM remote_profiles WHERE id=?", [Number(id)]);
    if (!result.changes) throw new Error("远程连接不存在");
    return {ok:true};
  }

  function updateRemoteProfileUsage(id: number) {
    getRemoteProfile(id);
    run("UPDATE remote_profiles SET last_used_at=?,updated_at=? WHERE id=?", [now(),now(),Number(id)]);
    return {ok:true};
  }

  function updateRemoteProfileFlags(id: number, data: any) {
    const profile = getRemoteProfile(id);
    const favorite = data.favorite === undefined ? Number(profile.favorite || 0) : Number(data.favorite || 0) ? 1 : 0;
    run("UPDATE remote_profiles SET favorite=?,updated_at=? WHERE id=?", [favorite,now(),Number(id)]);
    return {ok:true, favorite:Boolean(favorite)};
  }

  return {
    cleanRemoteProfile,
    listRemoteProfiles,
    getRemoteProfile,
    insertRemoteProfile,
    createRemoteProfileFromConnection,
    createAllRemoteProfilesFromConnection,
    updateRemoteProfile,
    repairRemoteProfileManagementConnection,
    getVncProfileCredential,
    updateVncProfileCredential,
    duplicateRemoteProfile,
    deleteRemoteProfile,
    updateRemoteProfileUsage,
    updateRemoteProfileFlags
  };
}

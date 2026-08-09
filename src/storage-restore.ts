const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

function createStorageRestoreHelpers(options: any = {}) {
  const {
    BASE_DIR, DATA_DIR, PROJECT_SSH_DIR, RUNTIME_ROOT, STORAGE_SETTINGS_FILE,
    decryptText, encryptionReady, encryptText, isEncryptedText, listIdentityFiles, readSecuritySettings,
    validateSortOrder, getDesktopIntegration, getArgs, requestShutdown
  } = options;
  const encryptedValue = typeof isEncryptedText === "function"
    ? isEncryptedText
    : (value) => /^(?:tdenc|termaenc):v1:/.test(String(value || ""));
  const secretColumnsByTable = {
    connections: ["identity_file", "ssh_password", "private_key_passphrase", "extra_args", "terminal_program_path", "terminal_program_args", "terminal_working_directory"],
    remote_profiles: ["password"],
    tunnels: ["identity_file", "extra_args"]
  };

  function connectionRowsFromBackup(tempDb) {
    const table = tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='connections'").get();
    if (!table) return [];
    const columns = new Set(tempDb.prepare("PRAGMA table_info(connections)").all().map((item: any) => item.name));
    if (!columns.has("id") || !columns.has("name")) return [];
    if (!columns.has("sort_order")) {
      tempDb.exec("ALTER TABLE connections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 1");
      columns.add("sort_order");
    }
    const optional = [
      ["ssh_host", "''"], ["ssh_port", "22"], ["ssh_user", "''"], ["auth_type", "'key'"],
      ["identity_file", "NULL"], ["ssh_password", "NULL"], ["extra_args", "''"], ["sort_order", "1"]
    ].map(([name, fallback]) => columns.has(name) ? name : `${fallback} AS ${name}`);
    return tempDb.prepare(`SELECT id, name, ${optional.join(", ")} FROM connections ORDER BY id`).all();
  }

  function storageSettingsView() {
    return {
      root:RUNTIME_ROOT,
      data_dir:DATA_DIR,
      ssh_dir:PROJECT_SSH_DIR,
      environment_override:Boolean(process.env.TERMA_DATA_DIR || process.env.TERMA_SSH_DIR || process.env.TUNNELDESK_DATA_DIR || process.env.TUNNELDESK_SSH_DIR)
    };
  }

  function pathInside(parent, candidate) {
    const relative = path.relative(path.resolve(parent), path.resolve(candidate));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  }

  function copyRuntimeDirectory(source, target) {
    if (!fs.existsSync(source) || path.resolve(source) === path.resolve(target)) return;
    if (pathInside(source, target)) throw new Error("新目录不能位于当前数据目录内部");
    fs.mkdirSync(target, { recursive:true });
    fs.cpSync(source, target, { recursive:true, force:false, errorOnExist:false });
  }

  function saveWebStorageSettings(data) {
    if (getDesktopIntegration()?.saveSettings) throw new Error("桌面端请使用桌面数据路径模式");
    const rootValue = String(data?.root || "").trim();
    if (!rootValue || rootValue.includes("\0") || !path.isAbsolute(rootValue)) throw new Error("请选择有效的绝对运行根目录");
    const root = path.resolve(rootValue);
    const targetData = path.join(root, "data");
    const targetSsh = path.join(root, ".ssh");
    if (Boolean(data?.migrate) && path.resolve(root) !== path.resolve(RUNTIME_ROOT)) {
      const targetDb = path.join(targetData, "tunnels.db");
      if (fs.existsSync(targetDb)) throw new Error("目标目录已有 Terma 数据库，已拒绝覆盖");
      copyRuntimeDirectory(DATA_DIR, targetData);
      copyRuntimeDirectory(PROJECT_SSH_DIR, targetSsh);
    } else {
      fs.mkdirSync(targetData, { recursive:true });
      fs.mkdirSync(targetSsh, { recursive:true });
    }
    const temporary = `${STORAGE_SETTINGS_FILE}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, JSON.stringify({root, updated_at:new Date().toISOString()}, null, 2), "utf8");
    fs.renameSync(temporary, STORAGE_SETTINGS_FILE);

    const environment = {...process.env};
    delete environment.TERMA_DATA_DIR;
    delete environment.TERMA_SSH_DIR;
    delete environment.TUNNELDESK_DATA_DIR;
    delete environment.TUNNELDESK_SSH_DIR;
    const restartPayload = {
      cwd:BASE_DIR,
      entry:path.join(BASE_DIR, "dist", "server.js"),
      args:["--host", (getArgs().requested_hosts || getArgs().listen_hosts).join(","), "--port", String(getArgs().requested_port || getArgs().listen_port)],
      env:environment,
      logFile:path.join(targetData, "web.log")
    };
    const encoded = Buffer.from(JSON.stringify(restartPayload), "utf8").toString("base64");
    const helper = spawn(process.execPath, [path.join(BASE_DIR, "scripts", "restart-web.js"), String(process.pid), encoded], {
      cwd:BASE_DIR,
      detached:true,
      windowsHide:true,
      stdio:"ignore"
    });
    helper.unref();
    setTimeout(() => requestShutdown().catch(error => console.error(`storage restart failed: ${error.message}`)), 250);
    return {ok:true, restart_required:true, root, data_dir:targetData, ssh_dir:targetSsh};
  }

  function listLocalDirectories(requestedPath) {
    const current = path.resolve(String(requestedPath || RUNTIME_ROOT));
    const stat = fs.statSync(current);
    if (!stat.isDirectory()) throw new Error("所选路径不是目录");
    const roots = process.platform === "win32"
      ? Array.from({length:26}, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
        .filter(root => fs.existsSync(root))
        .map(root => ({name:root, path:root}))
      : [{name:"/", path:"/"}];
    const directories = fs.readdirSync(current, {withFileTypes:true})
      .filter(entry => entry.isDirectory())
      .slice(0, 500)
      .map(entry => ({name:entry.name, path:path.join(current, entry.name)}));
    const parent = path.dirname(current);
    return {current, parent:parent === current ? "" : parent, roots, directories};
  }

  function normalizeIdentityBindings(value) {
    const bindings = new Map();
    for (const item of Array.isArray(value) ? value : []) {
      const connectionId = Number(item?.connection_id);
      const identityPath = String(item?.identity_path || "").trim();
      if (Number.isInteger(connectionId) && connectionId > 0 && identityPath) bindings.set(connectionId, identityPath);
    }
    return bindings;
  }

  function identityTargetMap(rows, requestedBindings = []) {
    const identities = listIdentityFiles();
    const allowedPaths: Map<string, any> = new Map(identities.map(item => [path.resolve(item.path), item]));
    const bindings = normalizeIdentityBindings(requestedBindings);
    const mappings = [];
    const unresolved = [];
    const encrypted = [];
    const missingByName = new Map();
    for (const row of rows) {
      if (encryptedValue(row.identity_file)) {
        encrypted.push({ connection_id:row.id, connection_name:row.name });
        continue;
      }
      const keyName = path.posix.basename(String(row.identity_file || "").replace(/\\/g, "/"));
      const requested = bindings.get(Number(row.id));
      if (requested && !allowedPaths.has(path.resolve(requested))) throw new Error(`连接 ${row.name || row.id} 的私钥绑定无效，请重新选择`);
      const target = requested ? allowedPaths.get(path.resolve(requested))?.path : null;
      const item = {
        connection_id: row.id,
        connection_name: row.name,
        ssh_host: row.ssh_host || "",
        ssh_port: Number(row.ssh_port || 22),
        ssh_user: row.ssh_user || "",
        auth_type: row.auth_type || "key",
        extra_args: row.extra_args || "",
        key_name: keyName,
        old_path: row.identity_file,
        target_path: target || path.join(PROJECT_SSH_DIR, keyName)
      };
      if (target && fs.existsSync(target)) mappings.push(item);
      else {
        unresolved.push(item);
        if (!missingByName.has(keyName)) {
          missingByName.set(keyName, { ...item, connection_count: 1, connection_names: [row.name] });
        } else {
          const missingItem = missingByName.get(keyName);
          missingItem.connection_count += 1;
          if (row.name && !missingItem.connection_names.includes(row.name)) missingItem.connection_names.push(row.name);
        }
      }
    }
    return { missing: [...missingByName.values()], unresolved, encrypted, mappings };
  }

  function normalizeCredentialBindings(value) {
    const bindings = new Map();
    for (const item of Array.isArray(value) ? value : []) {
      const connectionId = Number(item?.connection_id);
      if (!Number.isInteger(connectionId) || connectionId <= 0) continue;
      const hasSortOrder = Object.prototype.hasOwnProperty.call(item || {}, "sort_order");
      const sortOrder = hasSortOrder ? validateSortOrder(item.sort_order) : undefined;
      const authType = String(item?.auth_type || "");
      if (!authType) {
        if (hasSortOrder) bindings.set(connectionId, {connection_id:connectionId, sort_order:sortOrder});
        continue;
      }
      if (authType === "key") {
        const identityPath = String(item?.identity_path || "").trim();
        bindings.set(connectionId, {connection_id:connectionId, auth_type:"key", identity_path:identityPath, ...(hasSortOrder ? {sort_order:sortOrder} : {})});
        continue;
      }
      if (authType !== "password") throw new Error(`连接 ${connectionId} 的验证方式无效`);
      const passwordAction = ["preserve", "replace", "clear"].includes(String(item?.password_action)) ? String(item.password_action) : "preserve";
      const password = passwordAction === "replace" ? String(item?.password || "") : "";
      if (passwordAction === "replace" && !password) throw new Error(`连接 ${connectionId} 的新密码不能为空`);
      if (password.length > 4096) throw new Error(`连接 ${connectionId} 的密码过长`);
      bindings.set(connectionId, {connection_id:connectionId, auth_type:"password", password_action:passwordAction, password, ...(hasSortOrder ? {sort_order:sortOrder} : {})});
    }
    return bindings;
  }

  function inspectRestoreDatabaseFile(databasePath, security = null, credentialBindings = [], identityBindings = []) {
    const tempDb = new DatabaseSync(databasePath);
    try {
      const rows = connectionRowsFromBackup(tempDb);
      const requestedCredentials = normalizeCredentialBindings(credentialBindings);
      const keyRows = rows.filter((row) => {
        const requested = requestedCredentials.get(Number(row.id));
        return requested?.auth_type === "key" || (requested?.auth_type !== "password" && String(row.auth_type || "key") !== "password" && String(row.identity_file || "").trim());
      });
      const requestedIdentities = [
        ...(Array.isArray(identityBindings) ? identityBindings : []),
        ...[...requestedCredentials.values()].filter((item) => item.auth_type === "key" && item.identity_path).map((item) => ({connection_id:item.connection_id, identity_path:item.identity_path}))
      ];
      const identities = identityTargetMap(keyRows, requestedIdentities);
      return {
        ok: true,
        connections: rows.map((row) => {
          const authType = String(row.auth_type || "key") === "password" ? "password" : "key";
          const identityFile = String(row.identity_file || "");
          const password = String(row.ssh_password || "");
          return {
            connection_id: Number(row.id),
            connection_name: row.name || `连接 ${row.id}`,
            ssh_host: row.ssh_host || "",
            ssh_port: Number(row.ssh_port || 22),
            ssh_user: row.ssh_user || "",
            sort_order: Number(row.sort_order || 1),
            auth_type: authType,
            original_auth_type: authType,
            key_name: identityFile && !encryptedValue(identityFile) ? path.posix.basename(identityFile.replace(/\\/g, "/")) : "",
            identity_encrypted: encryptedValue(identityFile),
            has_password: Boolean(password),
            password_encrypted: encryptedValue(password),
            extra_args: row.extra_args || ""
          };
        }),
        identity_bindings_complete: identities.missing.length === 0,
        missing_identities: identities.missing,
        unresolved_identities: identities.unresolved,
        encrypted_identities: identities.encrypted,
        mapped_identities: identities.mappings,
        available_identities: listIdentityFiles(),
        upload_directory: PROJECT_SSH_DIR,
        encrypted_bundle: Boolean(security?.encryption_enabled),
        password_replacement_allowed: security
          ? !Boolean(security.encryption_enabled)
          : (!readSecuritySettings().encryption_enabled || encryptionReady())
      };
    } finally {
      tempDb.close();
    }
  }

  function normalizeRestoredCredentials(dbPath, identityBindings = [], credentialBindings = [], encryptedBundle = false, encryptionEnabled = false) {
    if (encryptionEnabled && typeof encryptionReady === "function" && !encryptionReady()) {
      throw new Error("当前实例已启用配置加密，请先解锁主密码后再恢复普通数据库");
    }
    const restoredDb = new DatabaseSync(dbPath);
    try {
      const rows = connectionRowsFromBackup(restoredDb);
      const credentials = normalizeCredentialBindings(credentialBindings);
      const keyRows = rows.filter((row) => {
        const requested = credentials.get(Number(row.id));
        return requested?.auth_type === "key" || (requested?.auth_type !== "password" && String(row.auth_type || "key") !== "password" && String(row.identity_file || "").trim());
      });
      const requestedIdentities = [
        ...(Array.isArray(identityBindings) ? identityBindings : []),
        ...[...credentials.values()].filter((item) => item.auth_type === "key" && item.identity_path).map((item) => ({connection_id:item.connection_id, identity_path:item.identity_path}))
      ];
      const identities = identityTargetMap(keyRows, requestedIdentities);
      const updateIdentity = restoredDb.prepare("UPDATE connections SET auth_type='key', identity_file=?, ssh_password=NULL WHERE id=?");
      for (const item of identities.mappings) {
        updateIdentity.run(item.target_path, item.connection_id);
      }
      for (const item of identities.unresolved) {
        updateIdentity.run(null, item.connection_id);
      }
      const updatePassword = restoredDb.prepare("UPDATE connections SET auth_type='password', identity_file=NULL, ssh_password=? WHERE id=?");
      const preservePassword = restoredDb.prepare("UPDATE connections SET auth_type='password', identity_file=NULL WHERE id=?");
      const updateSortOrder = restoredDb.prepare("UPDATE connections SET sort_order=? WHERE id=?");
      for (const item of credentials.values()) {
        if (item.sort_order) updateSortOrder.run(item.sort_order, item.connection_id);
        if (item.auth_type !== "password") continue;
        if (item.password_action === "replace" && encryptedBundle) throw new Error("加密迁移包不能在恢复前改写密码；请恢复并解锁后在连接设置中修改");
        if (item.password_action === "replace") updatePassword.run(encryptionEnabled ? encryptText(item.password) : item.password, item.connection_id);
        else if (item.password_action === "clear") updatePassword.run(null, item.connection_id);
        else preservePassword.run(item.connection_id);
      }
      let encrypted_fields = 0;
      if (encryptionEnabled && !encryptedBundle) encrypted_fields = encryptRestoredSecrets(restoredDb);
      else if (!encryptedBundle) assertNoEncryptedRestoredSecrets(restoredDb);
      return {
        ...identities,
        encrypted_fields,
        credential_bindings: [...credentials.values()].map((item) => ({...item, password:item.password ? "(replaced)" : ""}))
      };
    } finally {
      restoredDb.close();
    }
  }

  function restoredSecretRows(restoredDb, callback) {
    for (const [table, columns] of Object.entries(secretColumnsByTable)) {
      const exists = restoredDb.prepare("SELECT 1 AS found FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) continue;
      const available = new Set(restoredDb.prepare(`PRAGMA table_info(${table})`).all().map((item:any) => item.name));
      const selected = columns.filter(column => available.has(column));
      if (!selected.length) continue;
      const rows = restoredDb.prepare(`SELECT id, ${selected.join(", ")} FROM ${table}`).all();
      callback(table, selected, rows);
    }
  }

  function assertNoEncryptedRestoredSecrets(restoredDb) {
    restoredSecretRows(restoredDb, (table, columns, rows) => {
      for (const row of rows) {
        const column = columns.find(item => encryptedValue(row[item]));
        if (column) {
          throw new Error(`普通数据库包含无法在当前未加密实例中使用的 Terma 加密字段：${table}.${column}`);
        }
      }
    });
  }

  function encryptRestoredSecrets(restoredDb) {
    let changed = 0;
    restoredSecretRows(restoredDb, (table, selected, rows) => {
      const update = restoredDb.prepare(`UPDATE ${table} SET ${selected.map(column => `${column}=?`).join(", ")} WHERE id=?`);
      for (const row of rows) {
        const values = selected.map(column => {
          const value = row[column];
          if (value == null || value === "") return value;
          if (encryptedValue(value)) {
            try {
              const decrypted = decryptText(value);
              if (decrypted === "") throw new Error("decrypted secret is empty");
              changed += 1;
              return encryptText(decrypted);
            } catch {
              throw new Error(`普通数据库包含无法使用当前主密钥验证的 Terma 加密字段：${table}.${column}`);
            }
          }
          changed += 1;
          return encryptText(value);
        });
        if (values.some((value, index) => value !== row[selected[index]])) update.run(...values, row.id);
      }
    });
    return changed;
  }

  return {connectionRowsFromBackup, storageSettingsView, pathInside, copyRuntimeDirectory, saveWebStorageSettings, listLocalDirectories, normalizeIdentityBindings, identityTargetMap, normalizeCredentialBindings, inspectRestoreDatabaseFile, normalizeRestoredCredentials, assertNoEncryptedRestoredSecrets, encryptRestoredSecrets};
}

module.exports = { createStorageRestoreHelpers };

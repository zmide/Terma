import { DatabaseSync } from "node:sqlite";

function timestamp(): number {
  return Math.floor(Date.now() / 1000);
}

export function applyDatabaseMigrations(database: DatabaseSync): void {
  const run = (sql: string, params: any = {}) => {
    const statement = database.prepare(sql);
    return Array.isArray(params) ? statement.run(...params) : statement.run(params);
  };
  const get = (sql: string, params: any = {}) => {
    const statement = database.prepare(sql);
    return Array.isArray(params) ? statement.get(...params) : statement.get(params);
  };
  const all = (sql: string, params: any = {}) => {
    const statement = database.prepare(sql);
    return (Array.isArray(params) ? statement.all(...params) : statement.all(params)) as any[];
  };

  database.exec(`
CREATE TABLE IF NOT EXISTS tunnels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('local', 'remote', 'socks')),
  ssh_host TEXT NOT NULL,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_user TEXT NOT NULL,
  identity_file TEXT,
  bind_host TEXT NOT NULL DEFAULT '127.0.0.1',
  bind_port INTEGER NOT NULL,
  target_host TEXT,
  target_port INTEGER,
  forwards TEXT,
  extra_args TEXT,
  autostart INTEGER NOT NULL DEFAULT 0,
  pid INTEGER,
  status TEXT NOT NULL DEFAULT 'stopped',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '默认分组',
  ssh_host TEXT NOT NULL,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_user TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'key',
  identity_file TEXT,
  ssh_password TEXT,
  private_key_passphrase TEXT,
  ssh_agent_mode TEXT NOT NULL DEFAULT 'auto',
  jump_connection_id INTEGER,
  connect_timeout_seconds INTEGER NOT NULL DEFAULT 10,
  keepalive_interval_seconds INTEGER NOT NULL DEFAULT 60,
  keepalive_count_max INTEGER NOT NULL DEFAULT 3,
  tcp_keepalive INTEGER NOT NULL DEFAULT 1,
  x11_mode TEXT NOT NULL DEFAULT 'off',
  favorite INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  notifications_muted INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  extra_args TEXT,
  autostart_forwards INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 1,
  terminal_encoding TEXT NOT NULL DEFAULT 'utf8',
  terminal_font_family TEXT NOT NULL DEFAULT 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  terminal_font_family_inherit INTEGER NOT NULL DEFAULT 1,
  terminal_font_size INTEGER NOT NULL DEFAULT 13,
  terminal_font_size_inherit INTEGER NOT NULL DEFAULT 1,
  terminal_mobile_font_size INTEGER NOT NULL DEFAULT 13,
  terminal_mobile_font_size_inherit INTEGER NOT NULL DEFAULT 1,
  terminal_line_height REAL NOT NULL DEFAULT 1,
  terminal_font_weight TEXT NOT NULL DEFAULT 'normal',
  terminal_startup_mode TEXT NOT NULL DEFAULT 'default',
  terminal_profile_name TEXT NOT NULL DEFAULT '',
  terminal_profile_kind TEXT NOT NULL DEFAULT 'shell',
  terminal_program_path TEXT NOT NULL DEFAULT '',
  terminal_program_args TEXT NOT NULL DEFAULT '',
  terminal_working_directory TEXT NOT NULL DEFAULT '',
  terminal_program_platform TEXT NOT NULL DEFAULT 'auto',
  sftp_text_encoding TEXT NOT NULL DEFAULT 'auto',
  sftp_filename_encoding TEXT NOT NULL DEFAULT 'utf8',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS remote_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '默认分组',
  protocol TEXT NOT NULL,
  host TEXT,
  port INTEGER,
  username TEXT,
  password TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  tags TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connection_groups (
  name TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connection_forwards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  connection_id INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('local', 'remote', 'socks')),
  service_name TEXT,
  service_type TEXT,
  service_note TEXT,
  url_scheme TEXT,
  bind_host TEXT NOT NULL DEFAULT '127.0.0.1',
  bind_port INTEGER NOT NULL,
  target_host TEXT,
  target_port INTEGER,
  pid INTEGER,
  status TEXT NOT NULL DEFAULT 'stopped',
  restore INTEGER NOT NULL DEFAULT 0,
  reconnect_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_error_code TEXT,
  started_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY(connection_id) REFERENCES connections(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS forward_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('local', 'remote', 'socks')),
  service_name TEXT,
  service_type TEXT,
  service_note TEXT,
  url_scheme TEXT,
  bind_host TEXT NOT NULL DEFAULT '127.0.0.1',
  bind_port INTEGER NOT NULL,
  target_host TEXT,
  target_port INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS command_snippets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '默认分组',
  command TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',
  favorite INTEGER NOT NULL DEFAULT 0,
  quick_visible INTEGER NOT NULL DEFAULT 0,
  quick_action TEXT NOT NULL DEFAULT 'execute',
  quick_badge TEXT NOT NULL DEFAULT '',
  quick_color TEXT NOT NULL DEFAULT 'blue',
  quick_sort_order INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS named_workspaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  layout_json TEXT NOT NULL,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
  `);

  const remoteProfileSchema: any = get("SELECT sql FROM sqlite_master WHERE type='table' AND name='remote_profiles'");
  if (/CHECK\s*\(\s*protocol\s+IN/i.test(String(remoteProfileSchema?.sql || ""))) {
    database.exec(`
BEGIN IMMEDIATE;
ALTER TABLE remote_profiles RENAME TO remote_profiles_legacy_protocol_check;
CREATE TABLE remote_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT '默认分组',
  protocol TEXT NOT NULL,
  host TEXT,
  port INTEGER,
  username TEXT,
  password TEXT,
  favorite INTEGER NOT NULL DEFAULT 0,
  last_used_at INTEGER,
  tags TEXT,
  options_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT INTO remote_profiles(id,name,group_name,protocol,host,port,username,password,favorite,last_used_at,tags,options_json,created_at,updated_at)
SELECT id,name,group_name,protocol,host,port,username,password,favorite,last_used_at,tags,options_json,created_at,updated_at
FROM remote_profiles_legacy_protocol_check;
DROP TABLE remote_profiles_legacy_protocol_check;
COMMIT;
    `);
  }

  const connectionColumns = new Set(all("PRAGMA table_info(connections)").map((row: any) => row.name));
  if (!connectionColumns.has("autostart_forwards")) run("ALTER TABLE connections ADD COLUMN autostart_forwards INTEGER NOT NULL DEFAULT 0");
  if (!connectionColumns.has("tags")) run("ALTER TABLE connections ADD COLUMN tags TEXT");
  if (!connectionColumns.has("auth_type")) run("ALTER TABLE connections ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'key'");
  if (!connectionColumns.has("ssh_password")) run("ALTER TABLE connections ADD COLUMN ssh_password TEXT");
  if (!connectionColumns.has("private_key_passphrase")) run("ALTER TABLE connections ADD COLUMN private_key_passphrase TEXT");
  if (!connectionColumns.has("ssh_agent_mode")) run("ALTER TABLE connections ADD COLUMN ssh_agent_mode TEXT NOT NULL DEFAULT 'auto'");
  if (!connectionColumns.has("jump_connection_id")) run("ALTER TABLE connections ADD COLUMN jump_connection_id INTEGER");
  if (!connectionColumns.has("connect_timeout_seconds")) run("ALTER TABLE connections ADD COLUMN connect_timeout_seconds INTEGER NOT NULL DEFAULT 10");
  if (!connectionColumns.has("keepalive_interval_seconds")) run("ALTER TABLE connections ADD COLUMN keepalive_interval_seconds INTEGER NOT NULL DEFAULT 60");
  if (!connectionColumns.has("keepalive_count_max")) run("ALTER TABLE connections ADD COLUMN keepalive_count_max INTEGER NOT NULL DEFAULT 3");
  if (!connectionColumns.has("tcp_keepalive")) run("ALTER TABLE connections ADD COLUMN tcp_keepalive INTEGER NOT NULL DEFAULT 1");
  if (!connectionColumns.has("x11_mode")) run("ALTER TABLE connections ADD COLUMN x11_mode TEXT NOT NULL DEFAULT 'off'");
  if (!connectionColumns.has("favorite")) run("ALTER TABLE connections ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
  if (!connectionColumns.has("last_used_at")) run("ALTER TABLE connections ADD COLUMN last_used_at INTEGER");
  if (!connectionColumns.has("notifications_muted")) run("ALTER TABLE connections ADD COLUMN notifications_muted INTEGER NOT NULL DEFAULT 0");
  if (!connectionColumns.has("sort_order")) run("ALTER TABLE connections ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 1");
  if (!connectionColumns.has("terminal_encoding")) run("ALTER TABLE connections ADD COLUMN terminal_encoding TEXT NOT NULL DEFAULT 'utf8'");
  if (!connectionColumns.has("terminal_font_family")) run("ALTER TABLE connections ADD COLUMN terminal_font_family TEXT NOT NULL DEFAULT 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'");
  if (!connectionColumns.has("terminal_font_family_inherit")) {
    run("ALTER TABLE connections ADD COLUMN terminal_font_family_inherit INTEGER NOT NULL DEFAULT 1");
    run("UPDATE connections SET terminal_font_family_inherit=0 WHERE terminal_font_family<>'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'");
  }
  if (!connectionColumns.has("terminal_font_size")) run("ALTER TABLE connections ADD COLUMN terminal_font_size INTEGER NOT NULL DEFAULT 13");
  if (!connectionColumns.has("terminal_font_size_inherit")) {
    run("ALTER TABLE connections ADD COLUMN terminal_font_size_inherit INTEGER NOT NULL DEFAULT 1");
    run("UPDATE connections SET terminal_font_size_inherit=0 WHERE terminal_font_size<>13");
  }
  if (!connectionColumns.has("terminal_mobile_font_size")) run("ALTER TABLE connections ADD COLUMN terminal_mobile_font_size INTEGER NOT NULL DEFAULT 13");
  if (!connectionColumns.has("terminal_mobile_font_size_inherit")) {
    run("ALTER TABLE connections ADD COLUMN terminal_mobile_font_size_inherit INTEGER NOT NULL DEFAULT 1");
    run("UPDATE connections SET terminal_mobile_font_size_inherit=0 WHERE terminal_mobile_font_size<>13");
  }
  if (!connectionColumns.has("terminal_line_height")) run("ALTER TABLE connections ADD COLUMN terminal_line_height REAL NOT NULL DEFAULT 1");
  if (!connectionColumns.has("terminal_font_weight")) run("ALTER TABLE connections ADD COLUMN terminal_font_weight TEXT NOT NULL DEFAULT 'normal'");
  if (!connectionColumns.has("terminal_startup_mode")) run("ALTER TABLE connections ADD COLUMN terminal_startup_mode TEXT NOT NULL DEFAULT 'default'");
  if (!connectionColumns.has("terminal_profile_name")) run("ALTER TABLE connections ADD COLUMN terminal_profile_name TEXT NOT NULL DEFAULT ''");
  if (!connectionColumns.has("terminal_profile_kind")) run("ALTER TABLE connections ADD COLUMN terminal_profile_kind TEXT NOT NULL DEFAULT 'shell'");
  if (!connectionColumns.has("terminal_program_path")) run("ALTER TABLE connections ADD COLUMN terminal_program_path TEXT NOT NULL DEFAULT ''");
  if (!connectionColumns.has("terminal_program_args")) run("ALTER TABLE connections ADD COLUMN terminal_program_args TEXT NOT NULL DEFAULT ''");
  if (!connectionColumns.has("terminal_working_directory")) run("ALTER TABLE connections ADD COLUMN terminal_working_directory TEXT NOT NULL DEFAULT ''");
  if (!connectionColumns.has("terminal_program_platform")) run("ALTER TABLE connections ADD COLUMN terminal_program_platform TEXT NOT NULL DEFAULT 'auto'");
  if (!connectionColumns.has("sftp_text_encoding")) run("ALTER TABLE connections ADD COLUMN sftp_text_encoding TEXT NOT NULL DEFAULT 'auto'");
  if (!connectionColumns.has("sftp_filename_encoding")) run("ALTER TABLE connections ADD COLUMN sftp_filename_encoding TEXT NOT NULL DEFAULT 'utf8'");

  const commandSnippetColumns = new Set(all("PRAGMA table_info(command_snippets)").map((row: any) => row.name));
  if (!commandSnippetColumns.has("quick_visible")) run("ALTER TABLE command_snippets ADD COLUMN quick_visible INTEGER NOT NULL DEFAULT 0");
  if (!commandSnippetColumns.has("quick_action")) run("ALTER TABLE command_snippets ADD COLUMN quick_action TEXT NOT NULL DEFAULT 'execute'");
  if (!commandSnippetColumns.has("quick_badge")) run("ALTER TABLE command_snippets ADD COLUMN quick_badge TEXT NOT NULL DEFAULT ''");
  if (!commandSnippetColumns.has("quick_color")) run("ALTER TABLE command_snippets ADD COLUMN quick_color TEXT NOT NULL DEFAULT 'blue'");
  if (!commandSnippetColumns.has("quick_sort_order")) run("ALTER TABLE command_snippets ADD COLUMN quick_sort_order INTEGER NOT NULL DEFAULT 0");
  run(`UPDATE command_snippets SET quick_badge=CASE quick_badge
    WHEN '令' THEN 'command'
    WHEN '查' THEN 'inspect'
    WHEN '服' THEN 'service'
    WHEN '网' THEN 'network'
    WHEN '库' THEN 'database'
    WHEN '文' THEN 'file'
    WHEN '启' THEN 'start'
    WHEN '停' THEN 'stop'
    ELSE quick_badge END
    WHERE quick_badge IN ('令','查','服','网','库','文','启','停')`);

  const existingGroups = all("SELECT DISTINCT group_name FROM connections ORDER BY group_name COLLATE NOCASE");
  existingGroups.forEach((row: any, index: number) => run(
    "INSERT OR IGNORE INTO connection_groups(name,sort_order,created_at,updated_at) VALUES(?,?,?,?)",
    [row.group_name, index + 1, timestamp(), timestamp()]
  ));
  run("UPDATE connection_forwards SET status='stopped' WHERE pid IS NULL AND status='running'");
  const forwardColumns = new Set(all("PRAGMA table_info(connection_forwards)").map((row: any) => row.name));
  if (!forwardColumns.has("service_name")) run("ALTER TABLE connection_forwards ADD COLUMN service_name TEXT");
  if (!forwardColumns.has("service_type")) run("ALTER TABLE connection_forwards ADD COLUMN service_type TEXT");
  if (!forwardColumns.has("service_note")) run("ALTER TABLE connection_forwards ADD COLUMN service_note TEXT");
  if (!forwardColumns.has("restore")) run("ALTER TABLE connection_forwards ADD COLUMN restore INTEGER NOT NULL DEFAULT 0");
  if (!forwardColumns.has("reconnect_count")) run("ALTER TABLE connection_forwards ADD COLUMN reconnect_count INTEGER NOT NULL DEFAULT 0");
  if (!forwardColumns.has("last_error")) run("ALTER TABLE connection_forwards ADD COLUMN last_error TEXT");
  if (!forwardColumns.has("last_error_code")) run("ALTER TABLE connection_forwards ADD COLUMN last_error_code TEXT");
  if (!forwardColumns.has("started_at")) run("ALTER TABLE connection_forwards ADD COLUMN started_at INTEGER");
  if (!forwardColumns.has("url_scheme")) run("ALTER TABLE connection_forwards ADD COLUMN url_scheme TEXT");
  run("CREATE INDEX IF NOT EXISTS idx_connection_forwards_connection_id ON connection_forwards(connection_id,id)");
  run("CREATE INDEX IF NOT EXISTS idx_connections_group_sort ON connections(group_name,sort_order,created_at,id)");
  run("CREATE INDEX IF NOT EXISTS idx_connection_groups_sort ON connection_groups(sort_order,name)");
  run("CREATE INDEX IF NOT EXISTS idx_connections_recent ON connections(favorite,last_used_at)");
  run("CREATE INDEX IF NOT EXISTS idx_remote_profiles_group_sort ON remote_profiles(group_name,name,id)");
  run("CREATE INDEX IF NOT EXISTS idx_remote_profiles_recent ON remote_profiles(favorite,last_used_at)");
  run("CREATE INDEX IF NOT EXISTS idx_command_snippets_sort ON command_snippets(favorite,last_used_at,updated_at)");
  run("CREATE INDEX IF NOT EXISTS idx_command_snippets_quick_sort ON command_snippets(quick_visible,quick_sort_order,created_at,id)");
  run("CREATE INDEX IF NOT EXISTS idx_named_workspaces_recent ON named_workspaces(last_used_at,updated_at)");

  // Keep the frequent UI refresh probe scoped to data that can change the
  // connection explorer, running forwards, or remote-profile views. Unrelated
  // writes such as SFTP jobs, notifications, and logs must not wake those
  // views while a terminal or VNC canvas is rendering.
  run("CREATE TABLE IF NOT EXISTS ui_state_revision(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0)");
  run("INSERT OR IGNORE INTO ui_state_revision(id,revision) VALUES(1,0)");
  for (const table of ["connections", "connection_groups", "connection_forwards", "remote_profiles", "forward_templates"]) {
    for (const action of ["INSERT", "UPDATE", "DELETE"]) {
      database.exec(`CREATE TRIGGER IF NOT EXISTS terma_ui_state_${table}_${action.toLowerCase()}
        AFTER ${action} ON ${table}
        BEGIN
          UPDATE ui_state_revision SET revision=revision+1 WHERE id=1;
        END;`);
    }
  }
}

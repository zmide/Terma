import { publicError } from "../public-error";

interface ProductivityRepositoryDependencies {
  all(sql: string, params?: any): any[];
  get(sql: string, params?: any): any;
  run(sql: string, params?: any): any;
  now(): number;
}

export function createProductivityRepository(dependencies: ProductivityRepositoryDependencies) {
  const { all, get, run, now } = dependencies;
  const quickActions = new Set(["execute", "insert"]);
  const quickBadges = new Set(["", "command", "inspect", "service", "network", "database", "file", "start", "stop"]);
  const legacyQuickBadges = new Map([
    ["令", "command"],
    ["查", "inspect"],
    ["服", "service"],
    ["网", "network"],
    ["库", "database"],
    ["文", "file"],
    ["启", "start"],
    ["停", "stop"]
  ]);
  const quickColors = new Set(["blue", "green", "amber", "red", "cyan", "gray", "purple"]);

  function normalizeQuickBadge(value: any): string {
    const raw = String(value ?? "");
    const code = legacyQuickBadges.get(raw) || raw;
    return quickBadges.has(code) ? code : "";
  }

  function cleanCommandSnippet(data: any = {}, existing: any = null) {
    const name = String(data.name ?? existing?.name ?? "").trim();
    const command = String(data.command ?? existing?.command ?? "").replace(/\r\n?/g, "\n").trim();
    if (!name) throw publicError("COMMAND_SNIPPET_NAME_REQUIRED", "命令片段需要名称");
    if (!command) throw publicError("COMMAND_SNIPPET_COMMAND_REQUIRED", "命令片段不能为空");
    if (name.length > 120) throw publicError("COMMAND_SNIPPET_NAME_TOO_LONG", "命令片段名称不能超过 120 个字符", { max:120 });
    if (command.length > 100000) throw publicError("COMMAND_SNIPPET_CONTENT_TOO_LONG", "命令片段内容过长", { max:100000 });
    return {
      name,
      group_name:String(data.group_name ?? existing?.group_name ?? "默认分组").trim() || "默认分组",
      command,
      description:String(data.description ?? existing?.description ?? "").trim().slice(0, 1000),
      tags:String(data.tags ?? existing?.tags ?? "").split(/[,，\s]+/).map((item: string) => item.trim()).filter(Boolean).join(","),
      favorite:Number(data.favorite ?? existing?.favorite ?? 0) ? 1 : 0,
      quick_visible:Number(data.quick_visible ?? existing?.quick_visible ?? 0) ? 1 : 0,
      quick_action:quickActions.has(String(data.quick_action ?? existing?.quick_action ?? "execute")) ? String(data.quick_action ?? existing?.quick_action ?? "execute") : "execute",
      quick_badge:normalizeQuickBadge(data.quick_badge ?? existing?.quick_badge ?? ""),
      quick_color:quickColors.has(String(data.quick_color ?? existing?.quick_color ?? "blue")) ? String(data.quick_color ?? existing?.quick_color ?? "blue") : "blue",
      quick_sort_order:Math.max(0, Math.min(1000000, Math.trunc(Number(data.quick_sort_order ?? existing?.quick_sort_order ?? 0) || 0)))
    };
  }

  function listCommandSnippets() {
    return all(`SELECT * FROM command_snippets
      ORDER BY favorite DESC, COALESCE(last_used_at,0) DESC, group_name COLLATE NOCASE, name COLLATE NOCASE, id`);
  }

  function insertCommandSnippet(data: any) {
    const item = cleanCommandSnippet(data);
    const timestamp = now();
    const result = run(
      "INSERT INTO command_snippets(name,group_name,command,description,tags,favorite,quick_visible,quick_action,quick_badge,quick_color,quick_sort_order,last_used_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)",
      [item.name,item.group_name,item.command,item.description,item.tags,item.favorite,item.quick_visible,item.quick_action,item.quick_badge,item.quick_color,item.quick_sort_order,timestamp,timestamp]
    );
    return { id:Number(result.lastInsertRowid), ...item, last_used_at:null, created_at:timestamp, updated_at:timestamp };
  }

  function updateCommandSnippet(id: number, data: any) {
    const existing = get("SELECT * FROM command_snippets WHERE id=?", [Number(id)]);
    if (!existing) throw publicError("COMMAND_SNIPPET_NOT_FOUND", "命令片段不存在");
    const item = cleanCommandSnippet(data, existing);
    const updatedAt = now();
    run("UPDATE command_snippets SET name=?,group_name=?,command=?,description=?,tags=?,favorite=?,quick_visible=?,quick_action=?,quick_badge=?,quick_color=?,quick_sort_order=?,updated_at=? WHERE id=?",
      [item.name,item.group_name,item.command,item.description,item.tags,item.favorite,item.quick_visible,item.quick_action,item.quick_badge,item.quick_color,item.quick_sort_order,updatedAt,Number(id)]);
    return { ...existing, ...item, id:Number(id), updated_at:updatedAt };
  }

  function deleteCommandSnippet(id: number) {
    const result = run("DELETE FROM command_snippets WHERE id=?", [Number(id)]);
    if (!result.changes) throw publicError("COMMAND_SNIPPET_NOT_FOUND", "命令片段不存在");
    return { ok:true };
  }

  function useCommandSnippet(id: number) {
    const item = get("SELECT * FROM command_snippets WHERE id=?", [Number(id)]);
    if (!item) throw publicError("COMMAND_SNIPPET_NOT_FOUND", "命令片段不存在");
    const usedAt = now();
    run("UPDATE command_snippets SET last_used_at=? WHERE id=?", [usedAt,Number(id)]);
    return { ...item, last_used_at:usedAt };
  }

  function cleanNamedWorkspace(data: any = {}, existing: any = null) {
    const name = String(data.name ?? existing?.name ?? "").trim();
    if (!name) throw publicError("WORKSPACE_NAME_REQUIRED", "工作区需要名称");
    if (name.length > 120) throw publicError("WORKSPACE_NAME_TOO_LONG", "工作区名称不能超过 120 个字符", { max:120 });
    let layout;
    try {
      layout = typeof data.layout === "string"
        ? JSON.parse(data.layout)
        : (data.layout ?? JSON.parse(existing?.layout_json || "{}"));
    } catch {
      throw publicError("WORKSPACE_CONTENT_INVALID", "工作区内容格式无效");
    }
    const layoutJson = JSON.stringify(layout);
    if (!layout || !Array.isArray(layout.tabs)) throw publicError("WORKSPACE_TABS_MISSING", "工作区缺少标签信息");
    if (Buffer.byteLength(layoutJson, "utf8") > 2 * 1024 * 1024) throw publicError("WORKSPACE_CONTENT_TOO_LARGE", "工作区内容不能超过 2 MB", { max_mb:2 });
    return {
      name,
      description:String(data.description ?? existing?.description ?? "").trim().slice(0, 1000),
      layout_json:layoutJson
    };
  }

  function workspaceView(row: any) {
    if (!row) return null;
    let layout = {};
    try { layout = JSON.parse(row.layout_json); } catch {}
    const { layout_json, ...rest } = row;
    return { ...rest, layout };
  }

  function listNamedWorkspaces() {
    return all("SELECT * FROM named_workspaces ORDER BY COALESCE(last_used_at,0) DESC, updated_at DESC, name COLLATE NOCASE").map(workspaceView);
  }

  function insertNamedWorkspace(data: any) {
    const item = cleanNamedWorkspace(data);
    const timestamp = now();
    try {
      const result = run("INSERT INTO named_workspaces(name,description,layout_json,last_used_at,created_at,updated_at) VALUES(?,?,?,NULL,?,?)",
        [item.name,item.description,item.layout_json,timestamp,timestamp]);
      return workspaceView({ id:Number(result.lastInsertRowid), ...item, last_used_at:null, created_at:timestamp, updated_at:timestamp });
    } catch (error: any) {
      if (String(error.message || "").includes("UNIQUE")) throw publicError("WORKSPACE_NAME_DUPLICATE", "已存在同名工作区");
      throw error;
    }
  }

  function updateNamedWorkspace(id: number, data: any) {
    const existing = get("SELECT * FROM named_workspaces WHERE id=?", [Number(id)]);
    if (!existing) throw publicError("WORKSPACE_NOT_FOUND", "命名工作区不存在");
    const item = cleanNamedWorkspace(data, existing);
    const updatedAt = now();
    try {
      run("UPDATE named_workspaces SET name=?,description=?,layout_json=?,updated_at=? WHERE id=?",
        [item.name,item.description,item.layout_json,updatedAt,Number(id)]);
      return workspaceView({ ...existing, ...item, id:Number(id), updated_at:updatedAt });
    } catch (error: any) {
      if (String(error.message || "").includes("UNIQUE")) throw publicError("WORKSPACE_NAME_DUPLICATE", "已存在同名工作区");
      throw error;
    }
  }

  function duplicateNamedWorkspace(id: number) {
    const existing = get("SELECT * FROM named_workspaces WHERE id=?", [Number(id)]);
    if (!existing) throw publicError("WORKSPACE_NOT_FOUND", "命名工作区不存在");
    const names = new Set(all("SELECT name FROM named_workspaces").map((item) => String(item.name).toLocaleLowerCase()));
    const base = String(existing.name).replace(/\s*\(\d+\)$/u, "").trim();
    let index = 1;
    while (names.has(`${base} (${index})`.toLocaleLowerCase())) index += 1;
    return insertNamedWorkspace({ name:`${base} (${index})`, description:existing.description, layout:JSON.parse(existing.layout_json) });
  }

  function useNamedWorkspace(id: number) {
    const existing = get("SELECT * FROM named_workspaces WHERE id=?", [Number(id)]);
    if (!existing) throw publicError("WORKSPACE_NOT_FOUND", "命名工作区不存在");
    const usedAt = now();
    run("UPDATE named_workspaces SET last_used_at=? WHERE id=?", [usedAt,Number(id)]);
    return workspaceView({ ...existing, last_used_at:usedAt });
  }

  function deleteNamedWorkspace(id: number) {
    const result = run("DELETE FROM named_workspaces WHERE id=?", [Number(id)]);
    if (!result.changes) throw publicError("WORKSPACE_NOT_FOUND", "命名工作区不存在");
    return { ok:true };
  }

  return {
    listCommandSnippets,
    insertCommandSnippet,
    updateCommandSnippet,
    deleteCommandSnippet,
    useCommandSnippet,
    listNamedWorkspaces,
    insertNamedWorkspace,
    updateNamedWorkspace,
    duplicateNamedWorkspace,
    useNamedWorkspace,
    deleteNamedWorkspace
  };
}

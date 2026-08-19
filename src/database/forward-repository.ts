import { publicError } from "../public-error";

interface ForwardRepositoryDependencies {
  all(sql: string, params?: any): any[];
  get(sql: string, params?: any): any;
  run(sql: string, params?: any): any;
  now(): number;
  validatePort(value: unknown, label: string): number;
  getConnection(id: number): any;
}

export function createForwardRepository(dependencies: ForwardRepositoryDependencies) {
  const { all, get, run, now } = dependencies;

  function cleanForwardUrlPath(value: unknown): string | null {
    let urlPath = String(value || "").trim();
    if (!urlPath) return null;
    if (urlPath.length > 2048) {
      throw publicError("FORWARD_URL_PATH_TOO_LONG", "URL 路径不能超过 2048 个字符", { max:2048 }, 400);
    }
    if (/[\u0000-\u001f\u007f]/.test(urlPath)) {
      throw publicError("FORWARD_URL_PATH_CONTROL_CHARACTER", "URL 路径不能包含控制字符", {}, 400);
    }
    if (urlPath.includes("\\")) {
      throw publicError("FORWARD_URL_PATH_BACKSLASH", "URL 路径不能包含反斜杠", {}, 400);
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(urlPath) || urlPath.startsWith("//")) {
      throw publicError("FORWARD_URL_PATH_EXTERNAL", "URL 路径只能填写当前转发地址后的路径，不能填写完整网址", {}, 400);
    }
    if (!["/", "?", "#"].includes(urlPath[0])) urlPath = `/${urlPath}`;
    return urlPath;
  }

  function cleanForward(data: any) {
    if (!["local", "remote", "socks"].includes(data.mode)) {
      throw new Error("转发类型只能是 local、remote 或 socks");
    }
    const item: any = {
      mode:data.mode,
      service_name:String(data.service_name || "").trim() || null,
      service_type:String(data.service_type || "").trim() || null,
      service_note:String(data.service_note || "").trim() || null,
      url_scheme:["", "http", "https"].includes(String(data.url_scheme || "")) ? String(data.url_scheme || "") || null : null,
      url_path:cleanForwardUrlPath(data.url_path),
      bind_host:String(data.bind_host || "127.0.0.1").trim(),
      bind_port:dependencies.validatePort(data.bind_port, "监听端口"),
      target_host:String(data.target_host || "127.0.0.1").trim(),
      target_port:data.target_port
    };
    if (item.mode === "socks") {
      item.target_host = null;
      item.target_port = null;
    } else {
      item.target_port = dependencies.validatePort(item.target_port, "目标端口");
    }
    return item;
  }

  function getForward(id: number) {
    const row = get("SELECT * FROM connection_forwards WHERE id = ?", [Number(id)]);
    if (!row) throw new Error("转发不存在");
    return row;
  }

  function insertForward(connectionId: number, data: any) {
    dependencies.getConnection(connectionId);
    const item = cleanForward(data);
    const timestamp = now();
    const result = run(
      `INSERT INTO connection_forwards
       (connection_id, mode, service_name, service_type, service_note, url_scheme, url_path, bind_host, bind_port, target_host, target_port, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [Number(connectionId), item.mode, item.service_name, item.service_type, item.service_note, item.url_scheme, item.url_path, item.bind_host, item.bind_port, item.target_host, item.target_port, timestamp, timestamp]
    );
    return Number(result.lastInsertRowid);
  }

  function updateForward(id: number, data: any) {
    getForward(id);
    const item = cleanForward(data);
    run(
      `UPDATE connection_forwards
       SET mode=?, service_name=?, service_type=?, service_note=?, url_scheme=?, url_path=?, bind_host=?, bind_port=?, target_host=?, target_port=?, updated_at=?
       WHERE id=?`,
      [item.mode, item.service_name, item.service_type, item.service_note, item.url_scheme, item.url_path, item.bind_host, item.bind_port, item.target_host, item.target_port, now(), Number(id)]
    );
  }

  async function deleteForward(id: number, stopForward: (id: number) => unknown) {
    await Promise.resolve(stopForward(id));
    run("DELETE FROM connection_forwards WHERE id=?", [Number(id)]);
  }

  function listForwardTemplates() {
    return all("SELECT * FROM forward_templates ORDER BY name, id");
  }

  function cleanForwardTemplate(data: any) {
    const item = cleanForward(data);
    const name = String(data.name || "").trim();
    if (!name) throw new Error("缺少模板名称");
    return { name, ...item };
  }

  function insertForwardTemplate(data: any) {
    const item = cleanForwardTemplate(data);
    const timestamp = now();
    const result = run(
      `INSERT INTO forward_templates
       (name, mode, service_name, service_type, service_note, url_scheme, url_path, bind_host, bind_port, target_host, target_port, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [item.name, item.mode, item.service_name, item.service_type, item.service_note, item.url_scheme, item.url_path, item.bind_host, item.bind_port, item.target_host, item.target_port, timestamp, timestamp]
    );
    return Number(result.lastInsertRowid);
  }

  function updateForwardTemplate(id: number, data: any) {
    const item = cleanForwardTemplate(data);
    run(
      `UPDATE forward_templates
       SET name=?, mode=?, service_name=?, service_type=?, service_note=?, url_scheme=?, url_path=?, bind_host=?, bind_port=?, target_host=?, target_port=?, updated_at=?
       WHERE id=?`,
      [item.name, item.mode, item.service_name, item.service_type, item.service_note, item.url_scheme, item.url_path, item.bind_host, item.bind_port, item.target_host, item.target_port, now(), Number(id)]
    );
  }

  function deleteForwardTemplate(id: number) {
    run("DELETE FROM forward_templates WHERE id=?", [Number(id)]);
  }

  function getForwardTemplate(id: number) {
    const row = get("SELECT * FROM forward_templates WHERE id=?", [Number(id)]);
    if (!row) throw new Error("转发模板不存在");
    return row;
  }

  function applyForwardTemplate(templateId: number, connectionIds: unknown[]) {
    const template = getForwardTemplate(templateId);
    const ids = [...new Set((connectionIds || []).map(Number).filter(Boolean))];
    if (!ids.length) throw new Error("请选择要应用的连接");
    const created = [];
    for (const connectionId of ids) {
      dependencies.getConnection(connectionId);
      created.push(insertForward(connectionId, template));
    }
    return { ok:true, created };
  }

  function ensureBuiltinForwardTemplates() {
    if (get("SELECT value FROM app_meta WHERE key='builtin_forward_templates_v1'")) return;
    const templates = [
      { name:"Web HTTP", mode:"local", service_name:"Web", service_type:"web", url_scheme:"http", bind_host:"127.0.0.1", bind_port:8080, target_host:"127.0.0.1", target_port:80 },
      { name:"MySQL", mode:"local", service_name:"MySQL", service_type:"mysql", bind_host:"127.0.0.1", bind_port:3306, target_host:"127.0.0.1", target_port:3306 },
      { name:"Redis", mode:"local", service_name:"Redis", service_type:"redis", bind_host:"127.0.0.1", bind_port:6379, target_host:"127.0.0.1", target_port:6379 },
      { name:"Memcached", mode:"local", service_name:"Memcached", service_type:"other", bind_host:"127.0.0.1", bind_port:11211, target_host:"127.0.0.1", target_port:11211 },
      { name:"SSH", mode:"local", service_name:"SSH", service_type:"ssh", bind_host:"127.0.0.1", bind_port:2222, target_host:"127.0.0.1", target_port:22 },
      { name:"SOCKS5", mode:"socks", service_name:"SOCKS5", service_type:"socks", bind_host:"127.0.0.1", bind_port:1080, target_host:"", target_port:null }
    ];
    for (const template of templates) insertForwardTemplate(template);
    run("INSERT OR REPLACE INTO app_meta(key,value) VALUES('builtin_forward_templates_v1',?)", [String(Date.now())]);
  }

  return {
    cleanForward,
    getForward,
    insertForward,
    updateForward,
    deleteForward,
    listForwardTemplates,
    insertForwardTemplate,
    updateForwardTemplate,
    deleteForwardTemplate,
    getForwardTemplate,
    applyForwardTemplate,
    ensureBuiltinForwardTemplates
  };
}

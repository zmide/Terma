async function checkConnectionHealth(id, button=null) {
  const c = currentConnection(id) || connections.find(item => item.id === id);
  const progress = createProgressToast({
    title:`正在检查 ${c?.name || "SSH 连接"}`,
    detail:healthConnectionIdentity(c, {id}),
    icon:"activity"
  });
  setButtonBusy(button, true, "检查中...");
  try {
    const result = await api(`/api/connections/${id}/health`, {method:"POST"});
    healthResults.set(id, result);
    renderConnections();
    const message = formatHealthMessage(c, result);
    if (result.ok) progress.finish(message, 3500);
    else progress.fail(message);
  } catch (error) {
    progress.fail(`${healthConnectionIdentity(c, {id})} 健康检查失败\n${error.message}`);
  } finally {
    setButtonBusy(button, false);
  }
}

function formatHealthMessage(connection, result) {
  const identity = healthConnectionIdentity(connection, result);
  const lines = [`${identity} 健康检查：${result.status}${result.cached ? `（缓存 ${Math.round((result.cache_age_ms || 0)/1000)} 秒）` : ""}`];
  lines.push(...healthFailureDetails(result));
  return lines.join("\n");
}

function healthConnectionIdentity(connection, result={}) {
  const name = connection?.name || result.name || result.id || "未知连接";
  const user = connection?.ssh_user || result.ssh_user || "";
  const host = connection?.ssh_host || result.ssh_host || "";
  const port = Number(connection?.ssh_port || result.ssh_port || 22);
  return user && host ? `${name} · ${user}@${host}:${port}` : String(name);
}

function healthForwardLabel(forward) {
  const modes = {local:"本地", remote:"远程", socks:"SOCKS5"};
  const mode = modes[forward?.mode] || forward?.mode || "转发";
  const bind = `${forward?.bind_host || "127.0.0.1"}:${Number(forward?.bind_port || 0)}`;
  if (forward?.mode === "socks") return `${mode} #${forward.id}（${bind}）`;
  const target = `${forward?.target_host || "127.0.0.1"}:${Number(forward?.target_port || 0)}`;
  return `${mode} #${forward.id}（${bind} → ${target}）`;
}

function healthFailureDetails(result) {
  const lines = [];
  if (!result.ssh?.ok) lines.push(`SSH：${result.ssh?.output || "连接异常"}`);
  for (const forward of result.forwards || []) {
    const label = healthForwardLabel(forward);
    if (forward.reachable === false) lines.push(`${label}：监听端口未就绪`);
    if (forward.port_usage?.occupied) {
      const owners = (forward.port_usage.processes || []).map(p => `${p.name || "未知程序"}(${p.pid})`).join("、") || "未知程序";
      lines.push(`${label}：监听端口被占用，${owners}`);
    }
    if (!forward.running && forward.last_error && !forward.port_usage?.occupied) lines.push(`${label}：${forward.last_error}`);
  }
  return lines;
}

function formatAllHealthMessage(results) {
  const failed = results.filter(item => !item.ok);
  const lines = [`健康检查完成：正常 ${results.length - failed.length} 个，异常 ${failed.length} 个`];
  for (const result of failed) {
    const connection = connections.find(item => Number(item.id) === Number(result.id));
    const details = healthFailureDetails(result);
    lines.push(`${healthConnectionIdentity(connection, result)}：${details[0] || result.status || "异常"}`);
    for (const detail of details.slice(1)) lines.push(`  ${detail}`);
  }
  return lines.join("\n");
}

let healthBatchRunning = false;

async function checkAllHealth(button=null) {
  if (healthBatchRunning) return notify("全部连接健康检查正在执行", "info");
  const targets = [...connections];
  if (!targets.length) return notify("暂无 SSH 连接可检查", "info");
  healthBatchRunning = true;
  let completed = 0;
  let failed = 0;
  let cursor = 0;
  let renderFrame = 0;
  const results = new Array(targets.length);
  const progress = createProgressToast({
    title:"正在检查全部连接",
    detail:`0 / ${targets.length} · 最多同时检查 4 台`,
    icon:"activity",
    progress:0
  });
  const scheduleRender = () => {
    if (renderFrame) return;
    renderFrame = requestAnimationFrame(() => {
      renderFrame = 0;
      renderConnections();
    });
  };
  const worker = async () => {
    while (cursor < targets.length) {
      const index = cursor++;
      const connection = targets[index];
      let result;
      try {
        result = await api(`/api/connections/${connection.id}/health`, {method:"POST"});
      } catch (error) {
        result = {
          id:connection.id,
          name:connection.name,
          ssh_user:connection.ssh_user,
          ssh_host:connection.ssh_host,
          ssh_port:connection.ssh_port,
          ok:false,
          status:"检查失败",
          ssh:{ok:false, output:error.message || "健康检查请求失败"},
          forwards:[]
        };
      }
      results[index] = result;
      healthResults.set(connection.id, result);
      completed += 1;
      if (!result.ok) failed += 1;
      progress.update({
        progress:completed / targets.length * 100,
        detail:`${completed} / ${targets.length} · 正常 ${completed - failed} · 异常 ${failed} · 刚完成 ${connection.name}`
      });
      scheduleRender();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };
  setButtonBusy(button, true, "检查中...");
  try {
    await Promise.all(Array.from({length:Math.min(4, targets.length)}, () => worker()));
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderConnections();
    const message = formatAllHealthMessage(results);
    if (failed) progress.fail(message);
    else progress.finish(message, 4500);
  } catch (error) {
    progress.fail(error.message || "全部连接健康检查失败");
  } finally {
    healthBatchRunning = false;
    setButtonBusy(button, false);
  }
}

async function openServerDashboard(id, updateTab=true) {
  const paneId = typeof currentWorkspacePaneId === "function" ? currentWorkspacePaneId() : "";
  const inPane = action => typeof runInWorkspacePane === "function" ? runInWorkspacePane(paneId, action) : action();
  const c = selectConnection(id);
  if (!c) return;
  let body = null;
  inPane(() => {
    $("view-dashboard").innerHTML = `<div class="panel">
    <div class="workspace-head">
      <div>
        <h2>${esc(c.name)} · 仪表盘</h2>
        <div class="subtitle">${esc(c.ssh_user)}@${esc(c.ssh_host)}:${c.ssh_port}</div>
      </div>
      <div class="actions"><button data-action="connection-dashboard-refresh" data-connection-id="${c.id}">刷新巡检</button><button data-action="connection-open-terminal" data-connection-id="${c.id}">打开终端</button></div>
    </div>
    <div id="serverDashboardBody" class="dashboard-grid">
      <div class="dashboard-card"><strong>巡检中</strong><span>正在通过 SSH 获取系统信息...</span></div>
    </div>
  </div>`;
    setWorkspace(`${c.name} · 仪表盘`, "服务器基础巡检", "dashboard", `dashboard-${c.id}`, updateTab, true, {kind:"dashboard", id:c.id});
    body = $("serverDashboardBody");
  });
  try {
    const result = await api(`/api/connections/${c.id}/inspect`, {method:"POST"});
    if (body?.isConnected) body.innerHTML = renderServerInspection(result);
  } catch (error) {
    if (body?.isConnected) body.innerHTML = `<div class="dashboard-card bad"><strong>巡检失败</strong><span>${esc(error.message)}</span></div>`;
  }
}

function renderServerInspection(result) {
  const sections = parseInspectionOutput(result.output || "");
  const names = [
    ["system", "系统"],
    ["os", "发行版"],
    ["uptime", "运行时间"],
    ["memory", "内存"],
    ["disk", "磁盘"],
    ["ports", "监听端口"]
  ];
  return names.map(([key, title]) => `<div class="dashboard-card ${result.ok ? "" : "bad"}"><strong>${title}</strong><pre>${esc(sections[key] || "暂无数据")}</pre></div>`).join("");
}

function parseInspectionOutput(text) {
  const out = {};
  let key = "summary";
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = line.match(/^##\s+(.+)$/);
    if (match) {
      key = match[1].trim();
      out[key] = "";
    } else {
      out[key] = `${out[key] || ""}${line}\n`;
    }
  }
  for (const name of Object.keys(out)) out[name] = out[name].trim();
  return out;
}

function connectionHealthAuthenticationFailure(result) {
  return Boolean(result && result.ssh?.ok === false && typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(result.ssh));
}

async function repairConnectionHealthCredentials(id, options={}) {
  if (typeof repairSshCredentials !== "function") return false;
  return repairSshCredentials(id, {
    context:options.context || tr("connections:health.authentication_failed", {defaultValue:"健康检查认证失败"}),
    error:options.error,
    onSaved:async () => checkConnectionHealth(id, options.button || null, {skipCredentialRepair:true})
  });
}

async function checkConnectionHealth(id, button=null, options={}) {
  const c = currentConnection(id) || connections.find(item => item.id === id);
  const progress = createProgressToast({
    title:tr("connections:health.checking_connection", {
      name:c?.name || tr("connections:health.ssh_connection", {defaultValue:"SSH 连接"}),
      defaultValue:`正在检查 ${c?.name || "SSH 连接"}`
    }),
    detail:healthConnectionIdentity(c, {id}),
    icon:"activity"
  });
  setButtonBusy(button, true, tr("connections:health.checking", {defaultValue:"检查中..."}));
  try {
    const result = await api(`/api/connections/${id}/health`, {method:"POST"});
    healthResults.set(id, result);
    renderConnections();
    const message = formatHealthMessage(c, result);
    if (result.ok) progress.finish(message, 3500);
    else {
      progress.fail(message);
      if (!options.skipCredentialRepair && connectionHealthAuthenticationFailure(result)) {
        await repairConnectionHealthCredentials(id, {button});
      }
    }
  } catch (error) {
    progress.fail(tr("connections:health.check_failed", {
      identity:healthConnectionIdentity(c, {id}),
      error:error.message,
      defaultValue:`${healthConnectionIdentity(c, {id})} 健康检查失败\n${error.message}`
    }));
    if (!options.skipCredentialRepair && typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(error)) {
      await repairConnectionHealthCredentials(id, {button, error});
    }
  } finally {
    setButtonBusy(button, false);
  }
}

function formatHealthMessage(connection, result) {
  const identity = healthConnectionIdentity(connection, result);
  const cache = result.cached ? tr("connections:health.cached", {
    seconds:Math.round((result.cache_age_ms || 0) / 1000),
    defaultValue:`（缓存 ${Math.round((result.cache_age_ms || 0) / 1000)} 秒）`
  }) : "";
  const status = localizedHealthStatus(result.status, result.ok);
  const lines = [tr("connections:health.result", {identity, status, cache, defaultValue:`${identity} 健康检查：${status}${cache}`})];
  lines.push(...healthFailureDetails(result));
  return lines.join("\n");
}

function healthConnectionIdentity(connection, result={}) {
  const name = connection?.name || result.name || result.id || tr("connections:health.unknown_connection", {defaultValue:"未知连接"});
  const user = connection?.ssh_user || result.ssh_user || "";
  const host = connection?.ssh_host || result.ssh_host || "";
  const port = Number(connection?.ssh_port || result.ssh_port || 22);
  const displayHost = String(host).includes(":") && !String(host).startsWith("[") ? `[${host}]` : host;
  return user && host ? `${name} · ${user}@${displayHost}:${port}` : String(name);
}

function healthForwardLabel(forward) {
  const modes = {
    local:tr("connections:health.local", {defaultValue:"本地"}),
    remote:tr("connections:health.remote", {defaultValue:"远程"}),
    socks:tr("connections:health.socks", {defaultValue:"SOCKS5"})
  };
  const mode = modes[forward?.mode] || forward?.mode || tr("connections:health.forward", {defaultValue:"转发"});
  const bind = `${forward?.bind_host || "127.0.0.1"}:${Number(forward?.bind_port || 0)}`;
  if (forward?.mode === "socks") return `${mode} #${forward.id}（${bind}）`;
  const target = `${forward?.target_host || "127.0.0.1"}:${Number(forward?.target_port || 0)}`;
  return `${mode} #${forward.id}（${bind} → ${target}）`;
}

function localizedHealthStatus(status, ok=null) {
  const value = String(status || "");
  if (ok === true || value === "正常" || value === "healthy") return tr("connections:health.healthy", {defaultValue:"正常"});
  if (value === "检查失败" || value === "check_failed") return tr("connections:health.status_failed", {defaultValue:"检查失败"});
  if (ok === false || value === "异常" || value === "abnormal") return tr("connections:health.abnormal", {defaultValue:"异常"});
  return typeof localizedTermaUiPhrase === "function" ? localizedTermaUiPhrase(value) : value;
}

function localizedHealthSshDiagnosis(ssh={}) {
  const diagnosis = ssh?.diagnosis && typeof ssh.diagnosis === "object" ? ssh.diagnosis : null;
  if (!diagnosis) return "";
  const code = /^[a-z][a-z0-9_]*$/i.test(String(diagnosis.reason_code || ""))
    ? String(diagnosis.reason_code).toLowerCase()
    : "ssh_failed";
  const reason = tr(`errors:${code}`, {defaultValue:tr("errors:ssh_failed")});
  const raw = ssh.preserve_raw_output === true
    ? String(ssh.raw_output || diagnosis.message || "").trim()
    : "";
  return [reason, raw && raw !== reason ? raw : ""].filter(Boolean).join("\n");
}

function healthFailureDetails(result) {
  const lines = [];
  if (!result.ssh?.ok) {
    const authFailed = connectionHealthAuthenticationFailure(result);
    const structuredIssue = typeof localizedConnectionExtraArgsError === "function" ? localizedConnectionExtraArgsError(result.ssh) : "";
    const output = structuredIssue
      || localizedHealthSshDiagnosis(result.ssh)
      || result.ssh?.output
      || tr("connections:health.connection_problem", {defaultValue:"连接异常"});
    const repair = authFailed ? tr("connections:health.repair_hint", {defaultValue:"；可单独检查此连接并修复凭据"}) : "";
    lines.push(tr("connections:health.ssh_problem", {output, repair, defaultValue:`SSH：${output}${repair}`}));
  }
  for (const forward of result.forwards || []) {
    const label = healthForwardLabel(forward);
    if (forward.reachable === false) lines.push(tr("connections:health.listener_not_ready", {label, defaultValue:`${label}：监听端口未就绪`}));
    if (forward.port_usage?.occupied) {
      const unknownProgram = tr("connections:health.unknown_program", {defaultValue:"未知程序"});
      const separator = tr("connections:health.owner_separator", {defaultValue:"、"});
      const owners = (forward.port_usage.processes || []).map(p => `${p.name || unknownProgram}(${p.pid})`).join(separator) || unknownProgram;
      lines.push(tr("connections:health.listener_occupied", {label, owners, defaultValue:`${label}：监听端口被占用，${owners}`}));
    }
    if (!forward.running && forward.last_error && !forward.port_usage?.occupied) {
      lines.push(tr("connections:health.forward_error", {label, error:forward.last_error, defaultValue:`${label}：${forward.last_error}`}));
    }
  }
  return lines;
}

function formatAllHealthMessage(results) {
  const failed = results.filter(item => !item.ok);
  const lines = [tr("connections:health.completed", {
    ok:results.length - failed.length,
    failed:failed.length,
    defaultValue:`健康检查完成：正常 ${results.length - failed.length} 个，异常 ${failed.length} 个`
  })];
  for (const result of failed) {
    const connection = connections.find(item => Number(item.id) === Number(result.id));
    const details = healthFailureDetails(result);
    const identity = healthConnectionIdentity(connection, result);
    const detail = details[0] || localizedHealthStatus(result.status, result.ok);
    lines.push(tr("connections:health.failed_item", {identity, detail, defaultValue:`${identity}：${detail}`}));
    for (const detail of details.slice(1)) lines.push(`  ${detail}`);
  }
  return lines.join("\n");
}

let healthBatchRunning = false;

async function checkAllHealth(button=null) {
  if (healthBatchRunning) return notify(tr("connections:health.all_running", {defaultValue:"全部连接健康检查正在执行"}), "info");
  const targets = [...connections];
  if (!targets.length) return notify(tr("connections:health.no_connections", {defaultValue:"暂无 SSH 连接可检查"}), "info");
  healthBatchRunning = true;
  let completed = 0;
  let failed = 0;
  let cursor = 0;
  let renderFrame = 0;
  const results = new Array(targets.length);
  const progress = createProgressToast({
    title:tr("connections:health.checking_all", {defaultValue:"正在检查全部连接"}),
    detail:tr("connections:health.batch_initial", {total:targets.length, defaultValue:`0 / ${targets.length} · 最多同时检查 4 台`}),
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
          status:"check_failed",
          ssh:{ok:false, output:error.message || tr("connections:health.request_failed", {defaultValue:"健康检查请求失败"})},
          forwards:[]
        };
      }
      results[index] = result;
      healthResults.set(connection.id, result);
      completed += 1;
      if (!result.ok) failed += 1;
      progress.update({
        progress:completed / targets.length * 100,
        detail:tr("connections:health.batch_progress", {
          completed,
          total:targets.length,
          ok:completed - failed,
          failed,
          name:connection.name,
          defaultValue:`${completed} / ${targets.length} · 正常 ${completed - failed} · 异常 ${failed} · 刚完成 ${connection.name}`
        })
      });
      scheduleRender();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };
  setButtonBusy(button, true, tr("connections:health.checking", {defaultValue:"检查中..."}));
  try {
    await Promise.all(Array.from({length:Math.min(4, targets.length)}, () => worker()));
    if (renderFrame) cancelAnimationFrame(renderFrame);
    renderConnections();
    const message = formatAllHealthMessage(results);
    if (failed) progress.fail(message);
    else progress.finish(message, 4500);
  } catch (error) {
    progress.fail(error.message || tr("connections:health.all_failed", {defaultValue:"全部连接健康检查失败"}));
  } finally {
    healthBatchRunning = false;
    setButtonBusy(button, false);
  }
}

async function repairServerDashboardCredentials(id) {
  if (typeof repairSshCredentials !== "function") return false;
  return repairSshCredentials(id, {
    context:tr("connections:health.inspection_auth_failed", {defaultValue:"服务器巡检认证失败"}),
    onSaved:async () => openServerDashboard(id, false, {skipCredentialRepair:true})
  });
}

async function openServerDashboard(id, updateTab=true, options={}) {
  const paneId = typeof currentWorkspacePaneId === "function" ? currentWorkspacePaneId() : "";
  const inPane = action => typeof runInWorkspacePane === "function" ? runInWorkspacePane(paneId, action) : action();
  const c = selectConnection(id);
  if (!c) return;
  let body = null;
  inPane(() => {
    $("view-dashboard").innerHTML = `<div class="panel">
    <div class="workspace-head">
      <div>
        <h2>${esc(tr("connections:health.dashboard_title", {name:c.name, defaultValue:`${c.name} · 仪表盘`}))}</h2>
        <div class="subtitle">${esc(c.ssh_user)}@${esc(c.ssh_host)}:${c.ssh_port}</div>
      </div>
      <div class="actions"><button data-action="connection-dashboard-refresh" data-connection-id="${c.id}">${esc(tr("connections:health.refresh_inspection", {defaultValue:"刷新巡检"}))}</button><button data-action="connection-open-terminal" data-connection-id="${c.id}">${esc(tr("connections:health.open_terminal", {defaultValue:"打开终端"}))}</button></div>
    </div>
    <div id="serverDashboardBody" class="dashboard-grid">
      <div class="dashboard-card"><strong>${esc(tr("connections:health.inspecting", {defaultValue:"巡检中"}))}</strong><span>${esc(tr("connections:health.inspecting_hint", {defaultValue:"正在通过 SSH 获取系统信息..."}))}</span></div>
    </div>
  </div>`;
    setWorkspace(tr("connections:health.dashboard_title", {name:c.name, defaultValue:`${c.name} · 仪表盘`}), tr("connections:health.inspection_subtitle", {defaultValue:"服务器基础巡检"}), "dashboard", `dashboard-${c.id}`, updateTab, true, {kind:"dashboard", id:c.id});
    body = $("serverDashboardBody");
  });
  try {
    const result = await api(`/api/connections/${c.id}/inspect`, {method:"POST"});
    if (body?.isConnected) body.innerHTML = renderServerInspection(result);
  } catch (error) {
    const authFailed = typeof sshAuthenticationFailure === "function" && sshAuthenticationFailure(error);
    if (body?.isConnected) body.innerHTML = `<div class="dashboard-card bad"><strong>${esc(tr("connections:health.inspection_failed", {defaultValue:"巡检失败"}))}</strong><span>${esc(error.message)}</span>${authFailed ? `<button type="button" data-action="connection-dashboard-credential-repair" data-connection-id="${Number(c.id)}">${icon("key-round")}<span>${esc(tr("connections:health.repair_credentials", {defaultValue:"修复 SSH 凭据"}))}</span></button>` : ""}</div>`;
    if (authFailed && !options.skipCredentialRepair) await repairServerDashboardCredentials(c.id);
  }
}

if (typeof registerTermaAction === "function") {
  registerTermaAction("connection-dashboard-credential-repair", ({element}) => repairServerDashboardCredentials(Number(element.dataset.connectionId || 0)));
}

function renderServerInspection(result) {
  const sections = parseInspectionOutput(result.output || "");
  const names = [
    ["system", tr("connections:health.system", {defaultValue:"系统"})],
    ["os", tr("connections:health.os", {defaultValue:"发行版"})],
    ["uptime", tr("connections:health.uptime", {defaultValue:"运行时间"})],
    ["memory", tr("connections:health.memory", {defaultValue:"内存"})],
    ["disk", tr("connections:health.disk", {defaultValue:"磁盘"})],
    ["ports", tr("connections:health.listening_ports", {defaultValue:"监听端口"})]
  ];
  const noData = tr("connections:health.no_data", {defaultValue:"暂无数据"});
  return names.map(([key, title]) => `<div class="dashboard-card ${result.ok ? "" : "bad"}"><strong>${esc(title)}</strong><pre>${esc(sections[key] || noData)}</pre></div>`).join("");
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

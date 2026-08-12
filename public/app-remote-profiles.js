function showRemoteProfileFromSshMenu(event, connectionId) {
  const connection = currentConnection(connectionId);
  if (!connection) return;
  showActionMenu(event, remoteProfileFromSshActions(connectionId));
}

function remoteProfileFromSshActions(connectionId) {
  const connection = currentConnection(connectionId);
  if (!connection) return [];
  return [
    {label:"生成全部连接", icon:"layers-3", run:()=>createAllRemoteProfilesFromSsh(connectionId)},
    {separator:true},
    ...Object.entries(REMOTE_PROTOCOL_META)
      .filter(([protocol]) => protocol !== "serial")
      .map(([protocol, meta]) => ({
        label:`生成 ${meta.label} 连接`,
        icon:meta.icon,
        run:()=>createRemoteProfileFromSsh(connectionId, protocol)
      })),
    {separator:true},
    {label:"串口连接需单独选择本机设备", icon:"usb", run:()=>{ showPrimary("remote"); newRemoteProfile("serial", connection.group_name); }}
  ];
}

async function createRemoteProfileFromSsh(connectionId, protocol) {
  const result = await api(`/api/connections/${connectionId}/remote-profiles`, {
    method:"POST",
    body:JSON.stringify({protocol})
  });
  await loadAll();
  selectedRemoteProfileId = Number(result.id || 0) || null;
  const profile = remoteProfileById(result.id);
  if (profile) revealRemoteProfile(profile);
  showPrimary("remote");
  notify(result.created === false ? `已存在 ${result.name}，已切换到其他连接` : `已生成 ${result.name}`, result.created === false ? "info" : "success");
  return result;
}

async function createAllRemoteProfilesFromSsh(connectionId) {
  const result = await api(`/api/connections/${connectionId}/remote-profiles`, {
    method:"POST",
    body:JSON.stringify({protocol:"all"})
  });
  await loadAll();
  const items = Array.isArray(result.results) ? result.results : [];
  const first = items.find(item => item.created) || items[0];
  selectedRemoteProfileId = Number(first?.id || 0) || null;
  const profile = remoteProfileById(first?.id);
  if (profile) revealRemoteProfile(profile);
  showPrimary("remote");
  const created = Number(result.created_count || 0);
  const existing = Number(result.existing_count || 0);
  notify(created
    ? `已生成 ${created} 个连接${existing ? `，${existing} 个已存在` : ""}`
    : "这些连接都已存在，已切换到其他连接", created ? "success" : "info");
  return result;
}

function renderRemoteProfileRow(profile) {
  const meta = REMOTE_PROTOCOL_META[profile.protocol] || {label:profile.protocol.toUpperCase(),icon:"plug",action:"打开"};
  const active = selectedRemoteProfileId === profile.id ? " active" : "";
  const graphical = ["rdp", "vnc", "xdmcp"].includes(profile.protocol);
  const primary = graphical
    ? `openRemoteDesktop(${profile.id})`
    : profile.protocol === "ftp"
      ? `openFtpProfile(${profile.id})`
      : `openRemoteTerminal(${profile.id})`;
  const capability = profile.protocol === "rdp"
    ? "本机 RDP"
    : profile.protocol === "vnc"
      ? (profile.options?.client_mode === "system" ? "系统客户端" : "内置桌面")
      : profile.protocol === "xdmcp" ? "内置 XDMCP"
      : profile.protocol === "ftp" ? "内置文件" : "内置终端";
  const sourceConnection = connections.find(connection => Number(connection.id) === Number(profile.options?.source_ssh_connection_id));
  const sourceTitle = sourceConnection ? ` · 来自 SSH：${sourceConnection.name}` : "";
  const displayName = sourceConnection ? sourceConnection.name : profile.name;
  return `<div class="conn-row remote-profile-row${active}" data-remote-profile-id="${profile.id}">
    <div class="conn-main"><span class="conn-name conn-name-open" title="双击${escAttr(meta.action)}" ondblclick="event.stopPropagation();${primary}">${esc(displayName)}</span><span class="protocol-badge protocol-${escAttr(profile.protocol)}">${icon(meta.icon)} ${esc(meta.label)}</span></div>
    <div class="conn-meta" title="${escAttr(remoteProfileEndpoint(profile))}">${esc(remoteProfileEndpoint(profile))}</div>
    ${profile.tags ? `<div class="forward-tags">${String(profile.tags).split(",").filter(Boolean).map(tag => `<span>${esc(tag)}</span>`).join("")}</div>` : ""}
    <div class="conn-footer">
      <div class="conn-summary"><span title="${escAttr(capability + sourceTitle)}">${icon(["rdp","vnc","xdmcp"].includes(profile.protocol) ? "external-link" : "layers-2")} ${capability}</span>${sourceConnection ? `<span class="remote-source-badge" title="来源：${escAttr(sourceConnection.name)}">${icon("server-cog")}</span>` : ""}</div>
      <div class="conn-actions" aria-label="${escAttr(profile.name)} 快捷操作">
        <button class="icon-button conn-primary-action" onclick="${primary}" title="${meta.action}" aria-label="${meta.action}">${icon(meta.icon)}</button>
        <button class="icon-button" onclick="editRemoteProfile(${profile.id})" title="编辑连接" aria-label="编辑连接">${icon("pencil")}</button>
        <button class="icon-button connection-favorite${profile.favorite ? " active" : ""}" onclick="toggleRemoteProfileFavorite(event,${profile.id},${profile.favorite ? 0 : 1})" title="${profile.favorite ? "取消收藏" : "收藏连接"}" aria-label="${profile.favorite ? "取消收藏" : "收藏连接"}" aria-pressed="${profile.favorite ? "true" : "false"}">${icon("star")}</button>
        <button class="icon-button" onclick="showRemoteProfileMenu(event,${profile.id})" title="更多操作" aria-label="更多操作">${icon("ellipsis")}</button>
      </div>
    </div>
  </div>`;
}

function showRemoteProfileMenu(event, id) {
  const profile = remoteProfileById(id);
  if (!profile) return;
  const openAction = ["rdp", "vnc", "xdmcp"].includes(profile.protocol)
    ? () => openRemoteDesktop(id)
    : profile.protocol === "ftp"
      ? () => openFtpProfile(id)
      : () => openRemoteTerminal(id);
  showActionMenu(event, [
    {label:REMOTE_PROTOCOL_META[profile.protocol]?.action || "打开", icon:REMOTE_PROTOCOL_META[profile.protocol]?.icon || "plug", run:openAction},
    {label:"测试连接", icon:"activity", run:()=>testRemoteProfile(id)},
    {separator:true},
    {label:"复制", icon:"copy", run:()=>duplicateRemoteProfile(id)},
    {label:"编辑连接", icon:"pencil", run:()=>editRemoteProfile(id)},
    {label:"删除连接", icon:"trash-2", danger:true, run:()=>deleteRemoteProfile(id)}
  ]);
}

async function toggleRemoteProfileFavorite(event, id, favorite) {
  event?.stopPropagation?.();
  await api(`/api/remote-profiles/${id}/flags`, {method:"POST", body:JSON.stringify({favorite})});
  await loadAll();
}

async function duplicateRemoteProfile(id) {
  const result = await api(`/api/remote-profiles/${id}/duplicate`, {method:"POST"});
  const source = remoteProfileById(id);
  if (source) revealRemoteProfile(source);
  await loadAll();
  notify(`已复制为 ${result.name}`, "success");
}

async function deleteRemoteProfile(id) {
  const profile = remoteProfileById(id);
  if (!profile || !await confirmModal(`删除连接 ${profile.name}？`, "删除远程连接", "删除", "取消", true)) return;
  await api(`/api/remote-profiles/${id}`, {method:"DELETE"});
  selectedRemoteProfileId = null;
  await loadAll();
  renderWelcome();
  notify("已删除连接", "success");
}

async function testRemoteProfile(id, button=null, options={}) {
  if (button) setButtonBusy(button, true, "测试中...");
  try {
    const result = await api(`/api/remote-profiles/${id}/test`, {method:"POST", body:"{}"});
    notify(result.ok ? (result.message || "连接测试通过") : (result.message || "连接测试失败"), result.ok ? "success" : "error");
    return result;
  } catch (error) {
    const profile = remoteProfileById(id);
    if (
      !options.skipCredentialRepair
      && profile?.protocol === "ftp"
      && typeof remoteProfileAuthenticationFailure === "function"
      && remoteProfileAuthenticationFailure(error, "ftp")
    ) {
      return repairRemoteProfileCredentials(id, {
        context:"FTP 连接测试认证失败",
        error,
        onSaved:async () => testRemoteProfile(id, button, {skipCredentialRepair:true})
      });
    }
    throw error;
  } finally {
    if (button) setButtonBusy(button, false);
  }
}

const REMOTE_RESOLUTION_PRESETS = Object.freeze([
  [1024,768,"XGA · 4:3"],
  [1280,720,"HD · 720p"],
  [1280,800,"WXGA · 16:10"],
  [1366,768,"HD"],
  [1440,900,"WXGA+ · 16:10"],
  [1600,900,"HD+"],
  [1680,1050,"WSXGA+ · 16:10"],
  [1920,1080,"Full HD · 1080p"],
  [1920,1200,"WUXGA · 16:10"],
  [2048,1080,"DCI 2K"],
  [2560,1080,"超宽屏"],
  [2560,1440,"QHD · 1440p"],
  [2560,1600,"WQXGA · 16:10"],
  [3440,1440,"超宽屏"],
  [3840,1080,"双 Full HD"],
  [3840,1600,"超宽屏"],
  [3840,2160,"4K UHD"],
  [4096,2160,"DCI 4K"],
  [5120,1440,"双 QHD"],
  [5120,2880,"5K"],
  [7680,4320,"8K UHD"]
]);

function normalizedRdpDisplayMode(options={}) {
  const mode = String(options.display_mode || "");
  if (["dynamic","fullscreen","fixed"].includes(mode)) return mode;
  if (Object.prototype.hasOwnProperty.call(options, "fullscreen")) return options.fullscreen === false ? "fixed" : "fullscreen";
  return "dynamic";
}

function normalizedXdmcpWindowMode(options={}) {
  const mode = String(options.window_mode || "");
  if (["resizable","fullscreen","fixed"].includes(mode)) return mode;
  return mode === "windowed" ? "fixed" : "resizable";
}

function remoteResolutionPreset(options={}) {
  const width = Math.round(Number(options.width || 1440));
  const height = Math.round(Number(options.height || 900));
  return REMOTE_RESOLUTION_PRESETS.some(([presetWidth,presetHeight]) => presetWidth === width && presetHeight === height)
    ? `${width}x${height}`
    : "custom";
}

function remoteResolutionOptionsMarkup(options={}) {
  const selected = remoteResolutionPreset(options);
  return `${REMOTE_RESOLUTION_PRESETS.map(([width,height,label]) => {
    const value = `${width}x${height}`;
    return `<option value="${value}" ${selected === value ? "selected" : ""}>${width} × ${height} · ${label}</option>`;
  }).join("")}<option value="custom" ${selected === "custom" ? "selected" : ""}>自定义宽高</option>`;
}

function remoteResolutionFieldsMarkup(prefix, options={}, visible=false) {
  const custom = remoteResolutionPreset(options) === "custom";
  return `<div id="${prefix}_resolution_options" class="remote-resolution-options" ${visible ? "" : "hidden"}>
    <label>固定分辨率</label>
    <select id="${prefix}_resolution_preset" onchange="applyRemoteResolutionPreset('${prefix}')">${remoteResolutionOptionsMarkup(options)}</select>
    <div id="${prefix}_custom_resolution" class="grid remote-resolution-custom" ${custom ? "" : "hidden"}>
      <div><label>宽度</label><input id="${prefix}_width" type="number" min="640" max="8192" value="${Number(options.width || 1440)}"></div>
      <div><label>高度</label><input id="${prefix}_height" type="number" min="480" max="8192" value="${Number(options.height || 900)}"></div>
    </div>
  </div>`;
}

function syncRemoteResolutionFields(prefix, modeId) {
  const visible = $(modeId)?.value === "fixed";
  const options = $(`${prefix}_resolution_options`);
  if (options) options.hidden = !visible;
  const custom = $(`${prefix}_custom_resolution`);
  if (custom) custom.hidden = !visible || $(`${prefix}_resolution_preset`)?.value !== "custom";
}

function applyRemoteResolutionPreset(prefix) {
  const preset = $(`${prefix}_resolution_preset`)?.value || "custom";
  if (preset !== "custom") {
    const [width,height] = preset.split("x").map(Number);
    if ($(`${prefix}_width`)) $(`${prefix}_width`).value = String(width);
    if ($(`${prefix}_height`)) $(`${prefix}_height`).value = String(height);
  }
  const custom = $(`${prefix}_custom_resolution`);
  if (custom) custom.hidden = preset !== "custom";
}

function syncRemoteQualityValue(input) {
  const output = $("remote_quality_value");
  if (output) output.textContent = String(Math.max(0, Math.min(9, Number(input?.value ?? 8))));
}

function remoteDesktopProtocolGuideMarkup(protocol, diagnostics=null, profile=null) {
  if (protocol === "rdp") {
    const sourceId = Number(diagnostics?.ssh_connection?.id || profile?.options?.source_ssh_connection_id || profile?.options?.ssh_connection_id || 0);
    const sourceConnection = sourceId ? currentConnection(sourceId) : null;
    const loginUser = String(profile?.username || sourceConnection?.ssh_user || diagnostics?.ssh_connection?.user || diagnostics?.ssh_connection?.ssh_user || diagnostics?.connection?.ssh_user || "").trim();
    const loginHint = loginUser
      ? `XRDP 登录使用远端 Linux 桌面账号：${loginUser}。`
      : "XRDP 登录使用远端 Linux 桌面账号，不是临时管理员授权的 root 密码、VNC 密码或 Windows 当前账号。";
    return `<div class="remote-protocol-guide"><span class="remote-protocol-guide-icon">${icon("badge-check")}</span><div><span class="remote-protocol-guide-tag">推荐</span><strong>xrdp 使用 Xorg/xorgxrdp</strong><small>默认优先选择 Xorg；登录器里的 Xvnc 是兼容后端，仅在 Xorg 后端不可用时使用。</small><small>${esc(loginHint)}${loginUser ? " 不要填写临时管理员授权密码、VNC 密码或 Windows 当前账号。" : ""}</small></div></div>`;
  }
  if (protocol === "vnc") {
    return `<div class="remote-protocol-guide"><span class="remote-protocol-guide-icon">${icon("panels-top-left")}</span><div><span class="remote-protocol-guide-tag">桌面关系</span><strong>共享来源用 x11vnc，独立来源用 TigerVNC</strong><small>物理桌面和 XRDP 会话由 x11vnc 镜像；TigerVNC 创建新的独立 X11 桌面。日志中的 Xtigervnc/Xvnc 是底层进程名，不是另一套需要单独部署的产品。</small><small class="remote-protocol-guide-risk">RDP、VNC、XDMCP 的端口互不冲突；同一 Linux 用户并跑 XRDP 与 TigerVNC 可能争用 HOME、DBus 或桌面单实例，独立 VNC 推荐使用单独的普通用户。</small></div></div>`;
  }
  if (protocol === "xdmcp") {
    return `<div class="remote-protocol-guide"><span class="remote-protocol-guide-icon">${icon("monitor-up")}</span><div><span class="remote-protocol-guide-tag">本机要求</span><strong>运行 Terma 的设备必须有可用的本机 X Server</strong><small>Linux 常用 Xephyr，macOS 使用 XQuartz，Windows 需要已安装并启动的 X Server；XDMCP 不依赖 SSH X11 转发，后者也不是 XDMCP 客户端。</small></div></div>`;
  }
  return "";
}

function remoteProtocolOptionsMarkup(protocol, options={}) {
  if (protocol === "rdp") {
    const displayMode = normalizedRdpDisplayMode(options);
    return `<div class="grid"><div><label>显示方式</label><select id="remote_rdp_display_mode" onchange="syncRemoteResolutionFields('remote_rdp','remote_rdp_display_mode')"><option value="dynamic" ${displayMode === "dynamic" ? "selected" : ""}>自动跟随窗口（推荐）</option><option value="fullscreen" ${displayMode === "fullscreen" ? "selected" : ""}>全屏</option><option value="fixed" ${displayMode === "fixed" ? "selected" : ""}>固定分辨率</option></select></div><div><label>声音</label><select id="remote_audio"><option value="local" ${options.audio !== "remote" && options.audio !== "off" ? "selected" : ""}>在本机播放</option><option value="remote" ${options.audio === "remote" ? "selected" : ""}>在远端播放</option><option value="off" ${options.audio === "off" ? "selected" : ""}>关闭</option></select></div></div>${remoteResolutionFieldsMarkup("remote_rdp", options, displayMode === "fixed")}<div class="remote-display-help">自动模式会让 RDP 桌面随客户端窗口变化；固定模式可选常用、超宽、2K、4K、5K、8K 或自定义尺寸。</div><div class="grid"><div><label>域</label><input id="remote_domain" value="${escAttr(options.domain || "")}" placeholder="可选"></div><div class="check-grid"><label class="checkline"><input id="remote_clipboard" type="checkbox" ${options.clipboard !== false ? "checked" : ""}>共享剪贴板</label><label class="checkline"><input id="remote_admin_session" type="checkbox" ${options.admin_session ? "checked" : ""}>管理会话</label></div></div>${remoteDesktopProtocolGuideMarkup("rdp")}`;
  }
  if (protocol === "vnc") {
    const displayMode = ["scale","original","resize"].includes(String(options.display_mode)) ? String(options.display_mode) : "scale";
    const quality = Math.max(0, Math.min(9, Number(options.quality ?? 8)));
    return `<div class="grid3 remote-display-grid"><div><label>打开方式</label><select id="remote_vnc_client_mode"><option value="auto" ${!["embedded","system"].includes(options.client_mode) ? "selected" : ""}>自动（优先内置）</option><option value="embedded" ${options.client_mode === "embedded" ? "selected" : ""}>Terma 内置</option><option value="system" ${options.client_mode === "system" ? "selected" : ""}>系统客户端</option></select></div><div><label>显示方式</label><select id="remote_vnc_display_mode"><option value="scale" ${displayMode === "scale" ? "selected" : ""}>适应窗口（推荐）</option><option value="original" ${displayMode === "original" ? "selected" : ""}>原始像素</option><option value="resize" ${displayMode === "resize" ? "selected" : ""}>跟随窗口（服务器支持时）</option></select></div><div><label>鼠标模式</label><select id="remote_vnc_cursor_mode"><option value="auto" ${!["show","hide"].includes(options.cursor_mode) ? "selected" : ""}>自动（按远端平台）</option><option value="show" ${options.cursor_mode === "show" ? "selected" : ""}>手动显示本地光标</option><option value="hide" ${options.cursor_mode === "hide" ? "selected" : ""}>手动隐藏本地光标</option></select></div></div><div class="remote-quality-setting"><div class="remote-quality-heading"><label for="remote_quality">画质</label><output id="remote_quality_value" for="remote_quality">${quality}</output></div><input id="remote_quality" type="range" min="0" max="9" step="1" value="${quality}" oninput="syncRemoteQualityValue(this)"><div class="remote-quality-scale"><span>0 · 更省流量</span><span>9 · 更清晰</span></div></div><div class="remote-display-help">画质控制 JPEG 压缩质量，与分辨率不是同一项；两者越高通常越占带宽。VNC 由服务器按变化发送画面，没有通用且可靠的固定帧率设置。</div><div class="check-grid"><label class="checkline"><input id="remote_shared" type="checkbox" ${options.shared !== false ? "checked" : ""}>共享会话</label><label class="checkline"><input id="remote_view_only" type="checkbox" ${options.view_only ? "checked" : ""}>仅查看</label></div>${remoteDesktopProtocolGuideMarkup("vnc")}<div class="grid"><div><label>SSH 剪贴板辅助</label><select id="remote_vnc_ssh_connection"><option value="0">自动匹配同主机</option>${xdmcpManagementConnectionOptions(options.source_ssh_connection_id)}</select></div><div class="connection-test-status">用于可靠传输中文剪贴板；Linux 还需 xclip/xsel 或 wl-clipboard。</div></div>`;
  }
  if (protocol === "xdmcp") {
    const windowMode = normalizedXdmcpWindowMode(options);
    return `<div class="grid3 remote-display-grid"><div><label>连接方式</label><select id="remote_xdmcp_mode"><option value="query" ${options.mode !== "indirect" && options.mode !== "broadcast" ? "selected" : ""}>直接查询</option><option value="indirect" ${options.mode === "indirect" ? "selected" : ""}>间接查询</option><option value="broadcast" ${options.mode === "broadcast" ? "selected" : ""}>局域网广播</option></select></div><div><label>显示方式</label><select id="remote_xdmcp_window_mode" onchange="syncRemoteResolutionFields('remote_xdmcp','remote_xdmcp_window_mode')"><option value="resizable" ${windowMode === "resizable" ? "selected" : ""}>可调整窗口（支持时）</option><option value="fullscreen" ${windowMode === "fullscreen" ? "selected" : ""}>全屏</option><option value="fixed" ${windowMode === "fixed" ? "selected" : ""}>固定分辨率</option></select></div><div><label>SSH 管理连接</label><select id="remote_xdmcp_ssh_connection"><option value="0">自动匹配同主机</option>${xdmcpManagementConnectionOptions(options.ssh_connection_id)}</select></div></div>${remoteResolutionFieldsMarkup("remote_xdmcp", options, windowMode === "fixed")}<div class="grid"><div><label>本地地址</label><input id="remote_xdmcp_local_address" value="${escAttr(options.local_address || "")}" placeholder="自动选择"></div><div class="remote-display-help">Linux 和 macOS 的 Xephyr 可随窗口调整；Windows 会使用所选初始尺寸打开，不能可靠动态调整。XDMCP/X11 没有通用帧率限制。</div></div><div class="xdmcp-session-auto">${icon("sparkles")}<span>桌面会话由远端登录界面自动提供</span></div>${remoteDesktopProtocolGuideMarkup("xdmcp")}<div class="connection-test-status">SSH 管理连接可使用私钥、SSH Agent 或密码完成探测和配置；XDMCP 图形登录由远端显示管理器验证，通常仍需输入桌面账号和密码。</div><div class="connection-test-status warning">XDMCP 不加密，只应在可信局域网使用；跨公网请使用 SSH X11、RDP 或 VNC。</div>`;
  }
  if (protocol === "ftp") return `<div class="grid"><div><label>传输安全</label><select id="remote_ftp_secure"><option value="none" ${options.secure !== "explicit" && options.secure !== "implicit" ? "selected" : ""}>FTP（不加密）</option><option value="explicit" ${options.secure === "explicit" ? "selected" : ""}>显式 FTPS</option><option value="implicit" ${options.secure === "implicit" ? "selected" : ""}>隐式 FTPS</option></select></div><div><label>默认目录</label><input id="remote_base_path" value="${escAttr(options.base_path || "/")}" placeholder="/"></div></div><div class="check-grid"><span class="protocol-mode-note">FTP 固定使用被动模式，兼容常见 NAT 和防火墙环境。</span><label class="checkline"><input id="remote_reject_unauthorized" type="checkbox" ${options.reject_unauthorized !== false ? "checked" : ""}>验证 TLS 证书</label></div>`;
  if (protocol === "telnet") return `<div class="grid"><div><label>终端类型</label><input id="remote_terminal_type" value="${escAttr(options.terminal_type || "xterm-256color")}"></div><div><label>字符编码</label>${remoteEncodingSelect("remote_encoding", options.encoding || "utf8")}</div></div><div class="connection-test-status warning">Telnet 不加密用户名、密码和终端内容，只应在可信内网或加密隧道中使用。</div>`;
  return `<div class="grid"><div><label>串口设备</label><div class="upload-line"><input id="remote_serial_path" list="remoteSerialPorts" value="${escAttr(options.path || "")}" placeholder="COM3 或 /dev/ttyUSB0"><button type="button" onclick="loadRemoteSerialPorts()">${icon("refresh-cw")}<span>扫描</span></button></div><datalist id="remoteSerialPorts"></datalist></div><div><label>波特率</label><input id="remote_baud_rate" type="number" min="50" max="4000000" value="${Number(options.baud_rate || 115200)}"></div></div><div class="grid3"><div><label>数据位</label><select id="remote_data_bits">${[8,7,6,5].map(value => `<option value="${value}" ${Number(options.data_bits || 8) === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div><label>停止位</label><select id="remote_stop_bits">${[1,1.5,2].map(value => `<option value="${value}" ${Number(options.stop_bits || 1) === value ? "selected" : ""}>${value}</option>`).join("")}</select></div><div><label>校验位</label><select id="remote_parity">${[["none","无"],["even","偶"],["odd","奇"],["mark","Mark"],["space","Space"]].map(([value,label]) => `<option value="${value}" ${String(options.parity || "none") === value ? "selected" : ""}>${label}</option>`).join("")}</select></div></div><div class="grid"><div><label>字符编码</label>${remoteEncodingSelect("remote_encoding", options.encoding || "utf8")}</div><div class="check-grid"><label class="checkline"><input id="remote_rts_cts" type="checkbox" ${options.rts_cts ? "checked" : ""}>RTS/CTS</label><label class="checkline"><input id="remote_xon" type="checkbox" ${options.xon ? "checked" : ""}>XON</label><label class="checkline"><input id="remote_xoff" type="checkbox" ${options.xoff ? "checked" : ""}>XOFF</label></div></div>`;
}

function xdmcpManagementConnectionOptions(selectedId=0) {
  const selected = Number(selectedId || 0);
  return (Array.isArray(connections) ? connections : []).map(connection => {
    const endpoint = `${connection.ssh_user}@${connection.ssh_host}:${connection.ssh_port || 22}`;
    return `<option value="${Number(connection.id)}" ${Number(connection.id) === selected ? "selected" : ""}>${esc(connection.name)} · ${esc(endpoint)}</option>`;
  }).join("");
}

function remoteEncodingSelect(id, selected) {
  const options = [["utf8","UTF-8"],["gb18030","GB18030"],["gbk","GBK"],["big5","Big5"],["shift_jis","Shift_JIS"],["euc-kr","EUC-KR"],["latin1","ISO-8859-1"]];
  return `<select id="${id}">${options.map(([value,label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`).join("")}</select>`;
}

function renderRemoteProfileForm(profile={}) {
  const protocol = profile.protocol || "rdp";
  const meta = REMOTE_PROTOCOL_META[protocol];
  const passwordHint = profile.has_password ? "留空表示保持已保存密码" : "可选";
  $("view-edit").innerHTML = `<div class="panel remote-profile-editor"><form id="remoteProfileForm">
    <input id="remote_id" type="hidden" value="${Number(profile.id || 0) || ""}">
    <input id="remote_source_ssh_connection_id" type="hidden" value="${Number(profile.options?.source_ssh_connection_id || 0)}">
    <div class="workspace-head"><div><h2>${profile.id ? `编辑 ${esc(meta.label)} 连接` : `添加 ${esc(meta.label)} 连接`}</h2><div class="subtitle">协议配置只显示实际需要的字段。</div></div><span class="protocol-badge protocol-${protocol}">${icon(meta.icon)} ${esc(meta.label)}</span></div>
    <div class="grid3"><div><label>协议</label><select id="remote_protocol" onchange="changeRemoteProfileProtocol()">${Object.entries(REMOTE_PROTOCOL_META).map(([value,item]) => `<option value="${value}" ${protocol === value ? "selected" : ""}>${item.label}</option>`).join("")}</select></div><div><label>名称</label><input id="remote_name" required value="${escAttr(profile.name || "")}" placeholder="${meta.label} 连接"></div><div><label>分组</label><select id="remote_group" onchange="handleRemoteGroupSelectChange(this)">${groupNames(profile.group_name || "默认分组", "remote").map(name => `<option value="${escAttr(name)}" ${name === (profile.group_name || "默认分组") ? "selected" : ""}>${esc(name)}</option>`).join("")}<option value="__new_group__">新增分组...</option></select></div></div>
    <div id="remoteNetworkFields" class="grid" ${protocol === "serial" ? "hidden" : ""}><div><label>目标主机</label><input id="remote_host" value="${escAttr(profile.host || "")}" placeholder="example.com"></div><div><label>端口</label><input id="remote_port" type="number" min="1" max="65535" value="${Number(profile.port || meta.port || 0) || ""}"></div></div>
    <div id="remoteCredentialFields" class="grid" ${["telnet","serial","xdmcp"].includes(protocol) ? "hidden" : ""}><div><label>用户名（可选）</label><input id="remote_username" value="${escAttr(profile.username || (protocol === "ftp" ? "anonymous" : ""))}" autocomplete="username"></div><div id="remotePasswordField"><label>密码（可选）</label><input id="remote_password" type="password" autocomplete="new-password" placeholder="${escAttr(passwordHint)}"><label class="checkline" ${profile.has_password ? "" : "hidden"}><input id="remote_clear_password" type="checkbox">清除已保存密码</label><label id="remoteRdpPasswordTransferField" class="checkline remote-password-transfer-warning" ${protocol === "rdp" ? "" : "hidden"}><input id="remote_rdp_password_transfer" type="checkbox" ${profile.options?.allow_password_transfer ? "checked" : ""}><span>我了解风险，允许 Terma 把已保存密码交给 RDP 客户端</span></label></div></div>
    <div id="remoteDesktopCredentialNote" class="connection-test-status" ${["rdp","vnc"].includes(protocol) ? "" : "hidden"}>${protocol === "vnc" ? "VNC 密码可选保存并加密存储；留空时会在连接时询问。" : "RDP 用户名和密码都可留空。默认由客户端询问；勾选警告后，Windows 使用临时凭据、FreeRDP 使用标准输入。macOS Windows App 不提供密码接口，Terma 会改用已安装的 FreeRDP。"}</div>
    <label>标签</label><input id="remote_tags" value="${escAttr(profile.tags || "")}" placeholder="例如：办公 内网 图形桌面">
    <fieldset><legend>${esc(meta.label)} 选项</legend><div id="remoteProtocolOptions">${remoteProtocolOptionsMarkup(protocol, profile.options || {})}</div></fieldset>
    <div class="actions"><button class="primary" type="submit">${icon("save")}<span>保存连接</span></button>${profile.id ? "" : `<button type="submit" data-clear-after-save="1">${icon("save-all")}<span>保存并清空</span></button>`}${profile.id ? `<button type="button" onclick="testRemoteProfile(${profile.id},this)">${icon("activity")}<span>测试连接</span></button>` : ""}<button type="button" onclick="closeTabsByKey([activeTabKey],activeTabKey)">关闭</button></div>
  </form></div>`;
  $("remoteProfileForm").addEventListener("submit", saveRemoteProfileForm);
  pendingRemoteGroupSelectValue = profile.group_name || "默认分组";
  if (protocol === "serial") loadRemoteSerialPorts().catch(() => {});
  refreshIcons();
}

function handleRemoteGroupSelectChange(select) {
  if (select.value !== "__new_group__") {
    pendingRemoteGroupSelectValue = select.value || "默认分组";
    return;
  }
  select.value = pendingRemoteGroupSelectValue || "默认分组";
  openGroupModal(name => {
    remoteGroupOpen.add(name);
    saveRemoteGroupState();
    const createOption = select.querySelector('option[value="__new_group__"]');
    createOption?.before(new Option(name, name));
    select.value = name;
    pendingRemoteGroupSelectValue = name;
  });
}

function newRemoteProfile(protocol="rdp", groupName="") {
  if (!requireConfigEncryptionUnlocked("新增远程连接")) return;
  selectedRemoteProfileId = null;
  const value = REMOTE_PROTOCOL_META[protocol] ? protocol : "rdp";
  setWorkspace(`添加 ${REMOTE_PROTOCOL_META[value].label}`, groupName ? `分组：${groupName}` : "新建远程连接", "edit", `remote-new-${value}`, true, true, {kind:"remote-edit", id:0, protocol:value});
  renderRemoteProfileForm({protocol:value, group_name:groupName || pendingGroup || "默认分组", options:{}});
}

function editRemoteProfile(id, updateTab=true) {
  if (!requireConfigEncryptionUnlocked("编辑远程连接")) return;
  const profile = remoteProfileById(id);
  if (!profile) return;
  selectedRemoteProfileId = profile.id;
  revealRemoteProfile(profile);
  setWorkspace(`${profile.name} · 编辑`, remoteProfileEndpoint(profile), "edit", `remote-edit-${profile.id}`, updateTab, true, {kind:"remote-edit", id:profile.id, protocol:profile.protocol});
  renderRemoteProfileForm(profile);
  renderConnections();
}

function changeRemoteProfileProtocol() {
  const protocol = $("remote_protocol").value;
  const meta = REMOTE_PROTOCOL_META[protocol];
  $("remoteNetworkFields").hidden = protocol === "serial";
  $("remoteCredentialFields").hidden = ["telnet","serial","xdmcp"].includes(protocol);
  $("remotePasswordField").hidden = ["telnet","serial","xdmcp"].includes(protocol);
  $("remoteDesktopCredentialNote").hidden = !["rdp","vnc"].includes(protocol);
  if (["rdp","vnc"].includes(protocol)) $("remoteDesktopCredentialNote").textContent = protocol === "vnc" ? "VNC 密码可选保存并加密存储；留空时会在连接时询问。" : "RDP 用户名和密码都可留空。默认由客户端询问；勾选警告后，Windows 使用临时凭据、FreeRDP 使用标准输入。macOS Windows App 不提供密码接口，Terma 会改用已安装的 FreeRDP。";
  if (protocol !== "serial") $("remote_port").value = meta.port;
  if (protocol === "ftp" && !$("remote_username").value) $("remote_username").value = "anonymous";
  $("remoteProtocolOptions").innerHTML = remoteProtocolOptionsMarkup(protocol, {});
  if (protocol === "serial") loadRemoteSerialPorts().catch(() => {});
  refreshIcons();
}

function remoteProfileFormOptions(protocol) {
  const sourceSshId = Number($("remote_source_ssh_connection_id")?.value || 0);
  const withSource = options => sourceSshId ? {...options, source_ssh_connection_id:sourceSshId} : options;
  if (protocol === "rdp") {
    const displayMode = $("remote_rdp_display_mode").value;
    return withSource({domain:$("remote_domain").value.trim(), display_mode:displayMode, fullscreen:displayMode === "fullscreen", width:Number($("remote_rdp_width").value), height:Number($("remote_rdp_height").value), admin_session:$("remote_admin_session").checked, clipboard:$("remote_clipboard").checked, audio:$("remote_audio").value, allow_password_transfer:Boolean($("remote_rdp_password_transfer")?.checked)});
  }
  if (protocol === "vnc") {
    const vncSourceId = Number($("remote_vnc_ssh_connection")?.value || 0);
    const existingOptions = remoteProfileById(Number($("remote_id")?.value || 0))?.options || {};
    const options = {client_mode:$("remote_vnc_client_mode").value, cursor_mode:$("remote_vnc_cursor_mode").value, display_mode:$("remote_vnc_display_mode").value, server_session_mode:existingOptions.server_session_mode || "auto", server_display:existingOptions.server_display || "", view_only:$("remote_view_only").checked, shared:$("remote_shared").checked, quality:Number($("remote_quality").value)};
    return vncSourceId ? {...options, source_ssh_connection_id:vncSourceId} : options;
  }
  if (protocol === "xdmcp") return withSource({mode:$("remote_xdmcp_mode").value, window_mode:$("remote_xdmcp_window_mode").value, width:Number($("remote_xdmcp_width").value), height:Number($("remote_xdmcp_height").value), local_address:$("remote_xdmcp_local_address").value.trim(), ssh_connection_id:Number($("remote_xdmcp_ssh_connection").value || 0)});
  if (protocol === "ftp") return withSource({secure:$("remote_ftp_secure").value, passive:true, reject_unauthorized:$("remote_reject_unauthorized").checked, base_path:$("remote_base_path").value.trim() || "/"});
  if (protocol === "telnet") return withSource({terminal_type:$("remote_terminal_type").value.trim(), encoding:$("remote_encoding").value});
  return withSource({path:$("remote_serial_path").value.trim(), baud_rate:Number($("remote_baud_rate").value), data_bits:Number($("remote_data_bits").value), stop_bits:Number($("remote_stop_bits").value), parity:$("remote_parity").value, rts_cts:$("remote_rts_cts").checked, xon:$("remote_xon").checked, xoff:$("remote_xoff").checked, encoding:$("remote_encoding").value});
}

async function saveRemoteProfileForm(event) {
  event.preventDefault();
  if (!requireConfigEncryptionUnlocked("保存远程连接")) return;
  const form = event.currentTarget;
  const clearAfterSave = event.submitter?.dataset.clearAfterSave === "1";
  const protocol = $("remote_protocol").value;
  const id = Number($("remote_id").value || 0);
  const payload = {
    protocol,
    name:$("remote_name").value.trim(),
    group_name:$("remote_group").value || "默认分组",
    host:protocol === "serial" ? "" : $("remote_host").value.trim(),
    port:protocol === "serial" ? null : Number($("remote_port").value),
    username:["telnet","serial","xdmcp"].includes(protocol) ? "" : $("remote_username").value.trim(),
    password:["rdp","ftp","vnc"].includes(protocol) ? $("remote_password").value : "",
    clear_password:Boolean($("remote_clear_password")?.checked),
    tags:$("remote_tags").value.trim(),
    options:remoteProfileFormOptions(protocol)
  };
  if (protocol === "rdp" && payload.options.allow_password_transfer && !$("remote_clear_password")?.checked && !payload.username && (payload.password || remoteProfileById(id)?.has_password)) {
    $("remote_username")?.focus();
    notify("允许传递 RDP 密码时必须填写用户名", "error");
    return;
  }
  form.dataset.saving = "1";
  try {
    if (id) await api(`/api/remote-profiles/${id}`, {method:"PUT", body:JSON.stringify(payload)});
    else await api("/api/remote-profiles", {method:"POST", body:JSON.stringify(payload)});
    remoteGroupOpen.add(payload.group_name);
    saveRemoteGroupState();
    await loadAll();
    renderConnections();
    if (clearAfterSave && !id) {
      renderRemoteProfileForm({protocol, group_name:payload.group_name, options:{}});
      $("remote_name")?.focus();
      notify("连接已保存，可以继续添加", "success");
    } else {
      notify("远程连接已保存", "success");
    }
  } finally {
    delete form.dataset.saving;
  }
}

async function loadRemoteSerialPorts() {
  const result = await api("/api/serial/ports");
  const list = $("remoteSerialPorts");
  if (list) list.innerHTML = (result.ports || []).map(port => `<option value="${escAttr(port.path)}">${esc(port.manufacturer || port.friendly_name || port.path)}</option>`).join("");
  if (!result.available) notify(result.error || "串口组件不可用", "error");
  else if (!result.ports?.length) notify("没有检测到串口设备", "info");
  return result;
}

async function openRemoteDesktop(id, updateTab=true, showManagement=false) {
  const profile = remoteProfileById(id);
  if (!profile || !["rdp","vnc","xdmcp"].includes(profile.protocol)) return;
  selectedRemoteProfileId = profile.id;
  revealRemoteProfile(profile);
  const meta = REMOTE_PROTOCOL_META[profile.protocol];
  const key = `remote-desktop-${profile.id}`;
  const embeddedVnc = profile.protocol === "vnc" && profile.options?.client_mode !== "system";
  const existingVncSession = embeddedVnc ? vncSessions.get(key) : null;
  const connectionStatus = existingVncSession?.connected || existingVncSession?.statusState === "connected"
    ? "connected"
    : existingVncSession?.connecting || existingVncSession?.statusState === "connecting"
      ? "connecting"
      : "disconnected";
  const tabMeta = {
    kind:"remote-desktop",
    id:profile.id,
    protocol:profile.protocol,
    connectionStatus:profile.protocol === "vnc" ? connectionStatus : undefined
  };
  setWorkspace(profile.name, remoteProfileEndpoint(profile), "remote-desktop", key, updateTab, true, tabMeta);
  if (!showManagement && existingVncSession?.workspace && (existingVncSession.connected || existingVncSession.connecting)) {
    if (existingVncSession.presentation === "management") return showVncManagement(profile.id, key, false);
    return renderEmbeddedVnc(profile, key);
  }
  const view = $("view-remote-desktop");
  if (!view) return;
  const renderScope = captureRemoteDesktopRenderScope(profile.id, key, view);
  const embeddedXdmcp = profile.protocol === "xdmcp";
  const managedRdp = profile.protocol === "rdp";
  const managedVnc = profile.protocol === "vnc";
  const managementConnectionId = linuxDesktopManagerConnectionIdForProfile(profile);
  const sharedVnc = embeddedXdmcp ? matchingRemoteProfile(profile, "vnc") : null;
  view.dataset.remoteClientAvailable = "0";
  const launchHandler = embeddedVnc
    ? `openEmbeddedVncDesktop(${profile.id},'${escAttr(key)}',this)`
    : `launchRemoteDesktop(${profile.id},'${escAttr(key)}',this)`;
  const launchIcon = embeddedXdmcp ? "panels-top-left" : embeddedVnc ? "monitor-play" : "external-link";
  const launchLabel = embeddedXdmcp ? "新建图形登录" : embeddedVnc ? "打开内置 VNC" : `打开 ${meta.label} 客户端`;
  const serverStateMarkup = embeddedXdmcp
    ? `<div id="xdmcpServerState" class="xdmcp-server-state"><div class="xdmcp-server-loading">${icon("loader-circle")}<span>正在探测远端图形登录服务</span></div></div>`
    : managedRdp
      ? `<div id="rdpServerState" class="rdp-server-state"><div class="xdmcp-server-loading">${icon("loader-circle")}<span>正在探测远端 RDP 服务</span></div></div>`
      : `<div id="vncServerState" class="vnc-server-state"><div class="xdmcp-server-loading">${icon("loader-circle")}<span>正在探测远端 VNC 服务</span></div></div>`;
  const inspectActions = embeddedXdmcp
    ? `<button onclick="inspectXdmcpServer(${profile.id},this)">${icon("scan-search")}<span>重新探测</span></button><button onclick="openXdmcpSetupGuide(${profile.id})">${icon("book-open-check")}<span>远端配置说明</span></button>`
    : managedRdp
      ? `<button onclick="inspectRdpServer(${profile.id},this)">${icon("scan-search")}<span>重新探测</span></button><button onclick="openRdpSetupGuide(${profile.id})">${icon("book-open-check")}<span>远端配置说明</span></button>`
      : `<button onclick="inspectVncServer(${profile.id},this)">${icon("scan-search")}<span>重新探测</span></button><button onclick="openVncSetupGuide(${profile.id})">${icon("book-open-check")}<span>远端配置说明</span></button>`;
  const helpText = embeddedXdmcp
    ? "Terma 负责启动本机 XDMCP 窗口；XDMCP 本身不依赖 SSH，关联 SSH 只用于探测和管理远端显示服务。需要共享当前桌面时请使用 VNC。"
    : managedRdp
      ? "Terma 会先检查本机客户端和目标 TCP 端口；SSH 只用于 Linux xrdp、桌面会话和安装管理，不会阻止 Windows 或独立 RDP 服务。"
      : `Terma 会先检查目标端口和 VNC 服务；SSH 只用于 Linux 服务与桌面管理，不会阻止独立${embeddedVnc ? "内置" : "系统"} VNC 连接。`;
  view.innerHTML = `<div class="remote-desktop-launch"><div class="remote-desktop-icon">${icon(meta.icon)}</div><h2>${esc(profile.name)}</h2><div class="cmd">${esc(remoteProfileEndpoint(profile))}</div><div id="remoteDesktopStatus" class="connection-test-status">正在检查本机 ${embeddedVnc ? "内置 VNC" : embeddedXdmcp ? "XDMCP" : `${meta.label}`} 客户端...</div><div id="remoteDesktopAuthorization"></div>${serverStateMarkup}<div class="actions"><button id="remoteDesktopLaunchButton" class="primary" disabled onclick="${launchHandler}">${icon(launchIcon)}<span>${launchLabel}</span></button>${embeddedVnc ? `<button id="remoteDesktopCloseButton" hidden onclick="closeEmbeddedVncDesktop(${profile.id},'${escAttr(key)}',this)" title="断开并关闭内置 VNC 桌面">${icon("monitor-off")}<span>关闭桌面</span></button>` : ""}<button id="remoteDesktopInstallButton" hidden onclick="installRemoteDesktopClient(${profile.id},'${profile.protocol}',this)">${icon("download")}<span>安装客户端</span></button><button id="remoteDesktopXServerButton" hidden onclick="openXServerManager()">${icon("monitor-up")}<span>安装 XQuartz</span></button>${sharedVnc ? `<button onclick="openRemoteDesktop(${sharedVnc.id})">${icon("monitor")}<span>共享当前桌面（VNC）</span></button>` : ""}${inspectActions}<button onclick="editRemoteProfile(${profile.id})">${icon("settings-2")}<span>连接设置</span></button></div><div class="muted">${esc(helpText)}</div></div>`;
  if (embeddedVnc && existingVncSession) {
    existingVncSession.managementNodes = Array.from(view.childNodes);
    existingVncSession.presentation = "management";
    syncEmbeddedVncManagementControls(existingVncSession, view);
  }
  refreshIcons();
  if (typeof remoteWorkspaceJumpButtonsHtml === "function") {
    const jumpButtons = remoteWorkspaceJumpButtonsHtml(profile);
    if (jumpButtons) view.querySelector(".remote-desktop-launch .actions")?.insertAdjacentHTML("afterbegin", jumpButtons);
  }
  try {
    const [diagnostics, serverState, desktopDiagnostics] = await Promise.all([
      embeddedVnc ? Promise.resolve({vnc:{available:true, launchable:true, client:"Terma 内置 VNC"}}) : api("/api/remote-clients/diagnostics"),
      embeddedXdmcp
        ? inspectXdmcpServer(profile.id).catch(error => ({management_available:Boolean(managementConnectionId), error:error.message || "XDMCP 服务探测失败", code:error.code || "", connectionId:Number(error.connectionId || managementConnectionId)}))
        : managedRdp
          ? inspectRdpServer(profile.id).catch(error => ({error:error.message || "RDP 服务探测失败", code:error.code || "", connectionId:Number(error.connectionId || 0)}))
          : inspectVncServer(profile.id).catch(error => ({error:error.message || "VNC 服务探测失败", code:error.code || "", connectionId:Number(error.connectionId || 0)})),
      managedVnc && managementConnectionId ? inspectLinuxDesktopForRemoteProfile(profile) : Promise.resolve(null)
    ]);
    const item = diagnostics[profile.protocol] || {};
    const clientLaunchable = Boolean(item.available || item.launchable);
    const vncStatus = String(serverState?.status || "").toLowerCase();
    const vncEndpointBlocked = managedVnc && serverState?.endpoint_probe?.supported && !serverState.endpoint_probe.ok;
    const vncServiceBlocked = vncEndpointBlocked || (managedVnc && serverState?.diagnostics_available !== false && !vncServerReady(serverState) && (serverState?.server_session_configurable === true || ["not-installed", "stopped", "not-listening", "blocked"].includes(vncStatus)));
    const rdpEndpointReady = !managedRdp || !serverState?.endpoint_probe?.supported || Boolean(serverState.endpoint_probe.ok);
    const vncReadyForLaunch = !managedVnc || serverState?.diagnostics_available === false || !vncServiceBlocked;
    await withRemoteDesktopRenderScope(renderScope, async activeView => {
      const status = activeView.querySelector("#remoteDesktopStatus");
      if (!status) return;
      const authorization = activeView.querySelector("#remoteDesktopAuthorization");
      if (authorization) {
        const scopes = embeddedXdmcp ? ["remote-client", "xserver"] : ["remote-client"];
        authorization.innerHTML = embeddedVnc ? "" : desktopIntegrationAuthorizationMarkup(diagnostics, scopes, {
          refreshTarget:"remote-profile",
          remoteProfileId:profile.id
        });
      }
      activeView.dataset.remoteClientAvailable = clientLaunchable ? "1" : "0";
      status.className = `connection-test-status ${item.available ? "success" : clientLaunchable ? "warning" : "error"}`;
      status.textContent = item.available ? `已检测到 ${item.client || meta.label} 客户端` : (item.reason || diagnostics.message || `未检测到 ${meta.label} 客户端`);
      const launchButton = activeView.querySelector("#remoteDesktopLaunchButton");
      const installButton = activeView.querySelector("#remoteDesktopInstallButton");
      const xServerButton = activeView.querySelector("#remoteDesktopXServerButton");
      if (installButton) {
        installButton.hidden = !item.can_install;
        const label = installButton.querySelector("span");
        if (label) label.textContent = item.install_label || `安装 ${meta.label} 客户端`;
      }
      if (xServerButton) {
        xServerButton.hidden = !item.requires_xserver;
        const label = xServerButton.querySelector("span");
        if (label) label.textContent = item.xserver_installed ? "启动 XQuartz" : "安装 XQuartz";
      }
      if (!embeddedXdmcp && launchButton) launchButton.disabled = !clientLaunchable || !rdpEndpointReady || vncServiceBlocked;
      if (embeddedXdmcp && serverState) {
        renderXdmcpServerState(serverState, profile.id, activeView.querySelector("#xdmcpServerState"));
        if ((serverState.management_available === false || serverState.error) && launchButton) {
          launchButton.disabled = !clientLaunchable;
          launchButton.title = clientLaunchable ? "未完成 SSH 深度探测，仍可直接尝试 XDMCP 图形登录" : "请先安装或授权本机 XDMCP 客户端";
        }
      }
      if (managedRdp && serverState) renderRdpServerState(serverState, profile.id, key, activeView.querySelector("#rdpServerState"));
      if (managedVnc && serverState) renderVncServerState(serverState, profile.id, key, activeView.querySelector("#vncServerState"));
      if (embeddedVnc && existingVncSession?.presentation === "management") syncEmbeddedVncManagementControls(existingVncSession, activeView);
      const xdmcpDirectReady = !embeddedXdmcp || serverState?.ready_for_login || serverState?.management_available === false || Boolean(serverState?.error) || Boolean(serverState?.endpoint_probe?.ok);
      if (updateTab && remoteDesktopQuickOpen && clientLaunchable && xdmcpDirectReady && rdpEndpointReady && vncReadyForLaunch) {
        if (embeddedVnc) await openEmbeddedVncDesktop(profile.id, key);
        else await launchRemoteDesktop(profile.id, key);
      }
    });
  } catch (error) {
    withRemoteDesktopRenderScope(renderScope, activeView => {
      const status = activeView.querySelector("#remoteDesktopStatus");
      if (!status) return;
      status.className = "connection-test-status error";
      status.textContent = error.message;
    });
  }
}

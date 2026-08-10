function ftpStateForKey(key, profile, path="") {
  if (!ftpProfileStates.has(key)) ftpProfileStates.set(key, {key, profileId:profile.id, path:path || profile.options?.base_path || "/", entries:[], loading:false});
  return ftpProfileStates.get(key);
}

function openFtpProfile(id, path="", updateTab=true, existingKey="") {
  const profile = remoteProfileById(id);
  if (!profile || profile.protocol !== "ftp") return;
  selectedRemoteProfileId = profile.id;
  revealRemoteProfile(profile);
  const key = existingKey || `ftp-${profile.id}`;
  const state = ftpStateForKey(key, profile, path);
  if (path) state.path = path;
  setWorkspace(profile.name, remoteProfileEndpoint(profile), "ftp", key, updateTab, true, {kind:"ftp", id:profile.id, path:state.path, protocol:"ftp"});
  const view = $("view-ftp");
  view.dataset.ftpTabKey = key;
  view.innerHTML = `<div class="ftp-toolbar"><button class="icon-button" onclick="ftpGoParent('${escAttr(key)}')" title="上一级" aria-label="上一级">${icon("corner-left-up")}</button><div class="ftp-path-field">${icon("folder-open")}<input id="ftpPathInput" value="${escAttr(state.path)}" onkeydown="if(event.key==='Enter')loadFtpDirectory('${escAttr(key)}',this.value)"></div><button class="icon-button" onclick="loadFtpDirectory('${escAttr(key)}',null,true)" title="刷新" aria-label="刷新">${icon("refresh-cw")}</button><button class="icon-button" onclick="createFtpDirectory('${escAttr(key)}')" title="新建文件夹" aria-label="新建文件夹">${icon("folder-plus")}</button><label class="icon-button ftp-upload-button" title="上传文件" aria-label="上传文件">${icon("upload")}<input id="ftpUploadInput" type="file" multiple onchange="uploadFtpFiles('${escAttr(key)}',this.files)"></label></div><div id="ftpList" class="ftp-list"></div>`;
  refreshIcons();
  loadFtpDirectory(key, state.path).catch(error => notify(error.message, "error"));
}

async function ftpRequestWithCredentialRepair(key, context, operation, options={}) {
  const state = ftpProfileStates.get(key);
  try {
    return await operation();
  } catch (error) {
    const profile = state ? remoteProfileById(state.profileId) : null;
    if (
      !options.skipCredentialRepair
      && profile
      && typeof remoteProfileAuthenticationFailure === "function"
      && remoteProfileAuthenticationFailure(error, "ftp")
    ) {
      const repaired = await repairRemoteProfileCredentials(profile.id, {
        context,
        error
      });
      if (repaired?.saved) return operation();
    }
    throw error;
  }
}

async function loadFtpDirectory(key, pathValue=null, refresh=false) {
  const state = ftpProfileStates.get(key);
  if (!state || state.loading) return;
  state.loading = true;
  const list = $("ftpList");
  if (list) list.innerHTML = stateView("loading", "正在读取 FTP 目录", "正在与服务器交换目录列表。", "");
  try {
    const target = pathValue === null ? state.path : String(pathValue || "/");
    const result = await ftpRequestWithCredentialRepair(key, "FTP 目录认证失败", () => api(`/api/remote-profiles/${state.profileId}/ftp?path=${encodeURIComponent(target)}${refresh ? "&refresh=1" : ""}`));
    state.path = result.path || target;
    state.entries = result.entries || [];
    const input = $("ftpPathInput");
    if (input) input.value = state.path;
    const tab = typeof workspaceTabByKey === "function" ? workspaceTabByKey(key) : tabs.find(item => item.key === key);
    if (tab) tab.path = state.path;
    renderFtpEntries(key);
    saveTabsState();
    return true;
  } finally {
    state.loading = false;
  }
}

function renderFtpEntries(key) {
  const state = ftpProfileStates.get(key);
  const list = $("ftpList");
  if (!state || !list) return;
  if (!state.entries.length) return void (list.innerHTML = stateView("empty", "目录为空", "可以上传文件或新建文件夹。", `<button class="primary" onclick="createFtpDirectory('${escAttr(key)}')">新建文件夹</button>`));
  list.innerHTML = `<div class="ftp-table" role="table"><div class="ftp-row ftp-head" role="row"><span>名称</span><span>大小</span><span>修改时间</span><span>操作</span></div>${state.entries.map(entry => `<div class="ftp-row" role="row" ondblclick="${entry.type === "directory" ? `loadFtpDirectory('${escAttr(key)}','${escAttr(`${state.path.replace(/\/$/, "")}/${entry.name}`)}')` : `downloadFtpEntry('${escAttr(key)}','${escAttr(entry.name)}')`}"><span class="ftp-name">${icon(entry.type === "directory" ? "folder" : entry.type === "link" ? "file-symlink" : "file")}<span>${esc(entry.name)}</span></span><span>${entry.type === "directory" ? "—" : formatBytes(entry.size)}</span><span>${entry.modified_at ? esc(new Date(entry.modified_at).toLocaleString()) : "—"}</span><span class="ftp-row-actions">${entry.type === "directory" ? `<button class="icon-button" onclick="loadFtpDirectory('${escAttr(key)}','${escAttr(`${state.path.replace(/\/$/, "")}/${entry.name}`)}')" title="打开" aria-label="打开">${icon("folder-open")}</button>` : `<button class="icon-button" onclick="downloadFtpEntry('${escAttr(key)}','${escAttr(entry.name)}')" title="下载" aria-label="下载">${icon("download")}</button>`}<button class="icon-button" onclick="renameFtpEntry('${escAttr(key)}','${escAttr(entry.name)}')" title="重命名" aria-label="重命名">${icon("pencil")}</button><button class="icon-button danger" onclick="deleteFtpEntry('${escAttr(key)}','${escAttr(entry.name)}','${entry.type}')" title="删除" aria-label="删除">${icon("trash-2")}</button></span></div>`).join("")}</div>`;
  refreshIcons();
}

function ftpGoParent(key) {
  const state = ftpProfileStates.get(key);
  if (!state || state.path === "/") return;
  const parts = state.path.split("/").filter(Boolean);
  parts.pop();
  loadFtpDirectory(key, `/${parts.join("/")}` || "/");
}

async function createFtpDirectory(key) {
  const state = ftpProfileStates.get(key);
  const name = await inputModal("新建 FTP 文件夹", "文件夹名称", "");
  if (!state || !name) return;
  await ftpRequestWithCredentialRepair(key, "新建 FTP 文件夹时认证失败", () => api(`/api/remote-profiles/${state.profileId}/ftp/mkdir`, {method:"POST", body:JSON.stringify({path:state.path,name})}));
  await loadFtpDirectory(key, null, true);
}

async function renameFtpEntry(key, name) {
  const state = ftpProfileStates.get(key);
  const newName = await inputModal("重命名 FTP 项目", "新名称", name);
  if (!state || !newName || newName === name) return;
  await ftpRequestWithCredentialRepair(key, "重命名 FTP 项目时认证失败", () => api(`/api/remote-profiles/${state.profileId}/ftp/rename`, {method:"POST", body:JSON.stringify({path:state.path,name,new_name:newName})}));
  await loadFtpDirectory(key, null, true);
}

async function deleteFtpEntry(key, name, type) {
  const state = ftpProfileStates.get(key);
  if (!state || !await confirmModal(`确定删除 ${name}${type === "directory" ? " 及其内容" : ""}？FTP 不支持 Terma 回收站。`, "删除 FTP 项目", "删除", "取消", true)) return;
  await ftpRequestWithCredentialRepair(key, "删除 FTP 项目时认证失败", () => api(`/api/remote-profiles/${state.profileId}/ftp/delete`, {method:"POST", body:JSON.stringify({path:state.path,name,type})}));
  await loadFtpDirectory(key, null, true);
}

async function uploadFtpFiles(key, files) {
  const state = ftpProfileStates.get(key);
  if (!state || !files?.length) return;
  for (const file of files) {
    await ftpRequestWithCredentialRepair(key, `上传 ${file.name} 时认证失败`, async () => {
      const body = new FormData();
      body.append("path", state.path);
      body.append("file", file, file.name);
      const response = await fetch(`/api/remote-profiles/${state.profileId}/ftp/upload`, {method:"POST", body});
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(result.error || `上传 ${file.name} 失败`);
        error.code = result.code || "";
        error.remoteProfileId = Number(result.remote_profile_id || state.profileId);
        throw error;
      }
      return result;
    });
  }
  $("ftpUploadInput").value = "";
  await loadFtpDirectory(key, null, true);
  notify(`已上传 ${files.length} 个文件`, "success");
}

async function downloadFtpEntry(key, name) {
  const state = ftpProfileStates.get(key);
  if (!state) return;
  try {
    await ftpRequestWithCredentialRepair(key, `下载 ${name} 时认证失败`, () => api(`/api/remote-profiles/${state.profileId}/ftp?path=${encodeURIComponent(state.path)}`));
  } catch (error) {
    notify(error.message || `下载 ${name} 失败`, "error");
    return;
  }
  const link = document.createElement("a");
  link.href = `/api/remote-profiles/${state.profileId}/ftp/download?path=${encodeURIComponent(state.path)}&name=${encodeURIComponent(name)}`;
  link.download = name;
  link.click();
}

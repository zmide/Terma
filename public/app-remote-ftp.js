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
  const parent = tr("sftp:ftp.toolbar.parent", {defaultValue:"Go to parent"});
  const refresh = tr("sftp:ftp.toolbar.refresh", {defaultValue:"Refresh"});
  const create = tr("sftp:ftp.toolbar.create_directory", {defaultValue:"New directory"});
  const upload = tr("sftp:ftp.toolbar.upload_file", {defaultValue:"Upload files"});
  view.innerHTML = `<div class="ftp-toolbar"><button class="icon-button" onclick="ftpGoParent('${escAttr(key)}')" title="${escAttr(parent)}" aria-label="${escAttr(parent)}">${icon("corner-left-up")}</button><div class="ftp-path-field">${icon("folder-open")}<input id="ftpPathInput" value="${escAttr(state.path)}" onkeydown="if(event.key==='Enter')loadFtpDirectory('${escAttr(key)}',this.value)"></div><button class="icon-button" onclick="loadFtpDirectory('${escAttr(key)}',null,true)" title="${escAttr(refresh)}" aria-label="${escAttr(refresh)}">${icon("refresh-cw")}</button><button class="icon-button" onclick="createFtpDirectory('${escAttr(key)}')" title="${escAttr(create)}" aria-label="${escAttr(create)}">${icon("folder-plus")}</button><label class="icon-button ftp-upload-button" title="${escAttr(upload)}" aria-label="${escAttr(upload)}">${icon("upload")}<input id="ftpUploadInput" type="file" multiple onchange="uploadFtpFiles('${escAttr(key)}',this.files)"></label></div><div id="ftpList" class="ftp-list"></div>`;
  refreshIcons();
  loadFtpDirectory(key, state.path).catch(error => notify(typeof localizedTermaUiPhrase === "function" ? localizedTermaUiPhrase(error.message) : error.message, "error"));
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
  if (list) list.innerHTML = stateView("loading", tr("sftp:ftp.loading.title", {defaultValue:"Reading FTP directory"}), tr("sftp:ftp.loading.detail", {defaultValue:"Exchanging the directory listing with the server."}), "");
  try {
    const target = pathValue === null ? state.path : String(pathValue || "/");
    const context = tr("sftp:ftp.auth.directory", {defaultValue:"FTP directory authentication failed"});
    const result = await ftpRequestWithCredentialRepair(key, context, () => api(`/api/remote-profiles/${state.profileId}/ftp?path=${encodeURIComponent(target)}${refresh ? "&refresh=1" : ""}`));
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
  const create = tr("sftp:ftp.toolbar.create_directory", {defaultValue:"New directory"});
  if (!state.entries.length) return void (list.innerHTML = stateView("empty", tr("sftp:ftp.empty.title", {defaultValue:"Directory is empty"}), tr("sftp:ftp.empty.detail", {defaultValue:"Upload files or create a new directory."}), `<button class="primary" onclick="createFtpDirectory('${escAttr(key)}')">${esc(create)}</button>`));
  const headers = [
    tr("sftp:ftp.table.name", {defaultValue:"Name"}),
    tr("sftp:ftp.table.size", {defaultValue:"Size"}),
    tr("sftp:ftp.table.modified", {defaultValue:"Modified"}),
    tr("sftp:ftp.table.actions", {defaultValue:"Actions"})
  ].map(label => `<span>${esc(label)}</span>`).join("");
  const open = tr("sftp:ftp.entry.open", {defaultValue:"Open"});
  const download = tr("sftp:ftp.entry.download", {defaultValue:"Download"});
  const rename = tr("sftp:ftp.entry.rename", {defaultValue:"Rename"});
  const remove = tr("sftp:ftp.entry.delete", {defaultValue:"Delete"});
  list.innerHTML = `<div class="ftp-table" role="table"><div class="ftp-row ftp-head" role="row">${headers}</div>${state.entries.map(entry => {
    const entryPath = `${state.path.replace(/\/$/, "")}/${entry.name}`;
    const openAction = entry.type === "directory" ? `loadFtpDirectory('${escAttr(key)}','${escAttr(entryPath)}')` : `downloadFtpEntry('${escAttr(key)}','${escAttr(entry.name)}')`;
    return `<div class="ftp-row" role="row" ondblclick="${openAction}"><span class="ftp-name">${icon(entry.type === "directory" ? "folder" : entry.type === "link" ? "file-symlink" : "file")}<span>${esc(entry.name)}</span></span><span>${entry.type === "directory" ? "—" : formatBytes(entry.size)}</span><span>${entry.modified_at ? esc(new Date(entry.modified_at).toLocaleString(document.documentElement.lang || undefined)) : "—"}</span><span class="ftp-row-actions">${entry.type === "directory" ? `<button class="icon-button" onclick="loadFtpDirectory('${escAttr(key)}','${escAttr(entryPath)}')" title="${escAttr(open)}" aria-label="${escAttr(open)}">${icon("folder-open")}</button>` : `<button class="icon-button" onclick="downloadFtpEntry('${escAttr(key)}','${escAttr(entry.name)}')" title="${escAttr(download)}" aria-label="${escAttr(download)}">${icon("download")}</button>`}<button class="icon-button" onclick="renameFtpEntry('${escAttr(key)}','${escAttr(entry.name)}')" title="${escAttr(rename)}" aria-label="${escAttr(rename)}">${icon("pencil")}</button><button class="icon-button danger" onclick="deleteFtpEntry('${escAttr(key)}','${escAttr(entry.name)}','${escAttr(entry.type)}')" title="${escAttr(remove)}" aria-label="${escAttr(remove)}">${icon("trash-2")}</button></span></div>`;
  }).join("")}</div>`;
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
  const name = await inputModal(tr("sftp:ftp.create.title", {defaultValue:"New FTP directory"}), tr("sftp:ftp.create.label", {defaultValue:"Directory name"}), "");
  if (!state || !name) return;
  const context = tr("sftp:ftp.auth.create", {defaultValue:"Authentication failed while creating an FTP directory"});
  await ftpRequestWithCredentialRepair(key, context, () => api(`/api/remote-profiles/${state.profileId}/ftp/mkdir`, {method:"POST", body:JSON.stringify({path:state.path,name})}));
  await loadFtpDirectory(key, null, true);
}

async function renameFtpEntry(key, name) {
  const state = ftpProfileStates.get(key);
  const newName = await inputModal(tr("sftp:ftp.dialogs.rename", {defaultValue:"Rename FTP item"}), tr("sftp:ftp.dialogs.new_name", {defaultValue:"New name"}), name);
  if (!state || !newName || newName === name) return;
  const context = tr("sftp:ftp.auth.rename", {defaultValue:"Authentication failed while renaming an FTP item"});
  await ftpRequestWithCredentialRepair(key, context, () => api(`/api/remote-profiles/${state.profileId}/ftp/rename`, {method:"POST", body:JSON.stringify({path:state.path,name,new_name:newName})}));
  await loadFtpDirectory(key, null, true);
}

async function deleteFtpEntry(key, name, type) {
  const state = ftpProfileStates.get(key);
  const suffix = type === "directory" ? tr("sftp:ftp.delete.with_contents", {defaultValue:" and its contents"}) : "";
  const message = tr("sftp:ftp.delete.confirm", {name, suffix, defaultValue:"Delete {{name}}{{suffix}}? FTP does not support the Terma recycle bin."});
  if (!state || !await confirmModal(message, tr("sftp:ftp.delete.title", {defaultValue:"Delete FTP item"}), tr("sftp:ftp.delete.action", {defaultValue:"Delete"}), tr("sftp:ftp.delete.cancel", {defaultValue:"Cancel"}), true)) return;
  const context = tr("sftp:ftp.auth.delete", {defaultValue:"Authentication failed while deleting an FTP item"});
  await ftpRequestWithCredentialRepair(key, context, () => api(`/api/remote-profiles/${state.profileId}/ftp/delete`, {method:"POST", body:JSON.stringify({path:state.path,name,type})}));
  await loadFtpDirectory(key, null, true);
}

async function uploadFtpFiles(key, files) {
  const state = ftpProfileStates.get(key);
  if (!state || !files?.length) return;
  for (const file of files) {
    const context = tr("sftp:ftp.auth.upload", {name:file.name, defaultValue:"Authentication failed while uploading {{name}}"});
    await ftpRequestWithCredentialRepair(key, context, async () => {
      const body = new FormData();
      body.append("path", state.path);
      body.append("file", file, file.name);
      const response = await fetch(`/api/remote-profiles/${state.profileId}/ftp/upload`, {method:"POST", body});
      if (!response.ok) {
        const error = await apiErrorFromResponse(response, tr("sftp:ftp.upload.failed_item", {name:file.name, defaultValue:"Upload failed for {{name}}"}));
        if (!error.remoteProfileId) error.remoteProfileId = Number(state.profileId);
        throw error;
      }
      const result = await response.json().catch(() => ({}));
      return result;
    });
  }
  $("ftpUploadInput").value = "";
  await loadFtpDirectory(key, null, true);
  notify(tr("sftp:ftp.upload.completed", {count:files.length, defaultValue:"Uploaded {{count}} files"}), "success");
}

async function downloadFtpEntry(key, name) {
  const state = ftpProfileStates.get(key);
  if (!state) return;
  try {
    const context = tr("sftp:ftp.auth.download", {name, defaultValue:"Authentication failed while downloading {{name}}"});
    await ftpRequestWithCredentialRepair(key, context, () => api(`/api/remote-profiles/${state.profileId}/ftp?path=${encodeURIComponent(state.path)}`));
  } catch (error) {
    const message = error.message || tr("sftp:ftp.download.failed", {name, defaultValue:"Download failed for {{name}}"});
    notify(typeof localizedTermaUiPhrase === "function" ? localizedTermaUiPhrase(message) : message, "error");
    return;
  }
  const link = document.createElement("a");
  link.href = `/api/remote-profiles/${state.profileId}/ftp/download?path=${encodeURIComponent(state.path)}&name=${encodeURIComponent(name)}`;
  link.download = name;
  link.click();
}

if (typeof registerTermaI18nRenderer === "function") {
  registerTermaI18nRenderer(() => {
    if (typeof activeView === "undefined" || activeView !== "ftp" || typeof tabs === "undefined") return;
    const tab = tabs.find(item => item.key === activeTabKey && item.kind === "ftp");
    if (tab) openFtpProfile(tab.id, tab.path || "/", false, tab.key);
  });
}

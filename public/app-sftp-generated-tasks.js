const SFTP_GENERATED_TASKS_STORAGE_KEY = "sftpGeneratedTasksV1";
const SFTP_GENERATED_TASK_LIMIT = 80;
const sftpGeneratedFileBlobs = new Map();
let sftpGeneratedTasks = loadSftpGeneratedTasks();

function loadSftpGeneratedTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(SFTP_GENERATED_TASKS_STORAGE_KEY) || "[]");
    return Array.isArray(saved)
      ? saved.filter(item => item && String(item.id || "").startsWith("local:") && item.type === "local-generated" && item.status === "done").slice(0, SFTP_GENERATED_TASK_LIMIT)
      : [];
  } catch {
    return [];
  }
}

function persistSftpGeneratedTasks() {
  try {
    localStorage.setItem(SFTP_GENERATED_TASKS_STORAGE_KEY, JSON.stringify(
      sftpGeneratedTasks.filter(item => item.delivery_status === "saved").slice(0, SFTP_GENERATED_TASK_LIMIT)
    ));
  } catch {}
}

function listSftpGeneratedTasks() {
  return [...sftpGeneratedTasks].sort((left, right) => Number(right.finished_at || right.created_at || 0) - Number(left.finished_at || left.created_at || 0));
}

function sftpGeneratedTaskById(id) {
  return sftpGeneratedTasks.find(item => String(item.id) === String(id)) || null;
}

function addSftpGeneratedTask(blob, filename, options = {}) {
  const id = `local:${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  const task = {
    id,
    type:"local-generated",
    label:String(options.label || tr("sftp:editor.generated_task", {name:filename})),
    connection_id:Number(options.connectionId || 0),
    connection_name:String(options.connectionName || ""),
    source_path:String(options.sourcePath || ""),
    filename:String(filename || "generated.pdf"),
    status:"done",
    phase:"",
    current:tr("sftp:editor.generated_ready", {defaultValue:"已生成"}),
    progress_unit:"percent",
    progress_known:true,
    size:Math.max(0, Number(blob?.size || options.size || 0)),
    transferred:Math.max(0, Number(blob?.size || options.size || 0)),
    progress:100,
    can_cancel:false,
    can_pause:false,
    can_resume:false,
    delivery_status:String(options.deliveryStatus || "browser"),
    saved_path:String(options.savedPath || ""),
    created_at:Date.now(),
    finished_at:Date.now(),
    inverted:Boolean(options.inverted),
    color_mode:String(options.colorMode || (options.inverted ? "invert-color" : "original"))
  };
  sftpGeneratedTasks = [task, ...sftpGeneratedTasks.filter(item => item.id !== task.id)].slice(0, SFTP_GENERATED_TASK_LIMIT);
  if (blob instanceof Blob) sftpGeneratedFileBlobs.set(id, blob);
  persistSftpGeneratedTasks();
  sftpLatestJobs = [...sftpLatestJobs.filter(item => item.type !== "local-generated"), ...listSftpGeneratedTasks()];
  if (typeof updateSftpTaskCenter === "function") updateSftpTaskCenter(sftpLatestJobs);
  return task;
}

async function saveSftpGeneratedFileTask(blob, filename, options = {}) {
  const settings = await api("/api/sftp/download-settings").catch(() => ({delivery_mode:"browser"}));
  // A desktop renderer can briefly receive a stale browser-mode response while
  // its authenticated cookie is being installed. Still try the protected
  // desktop save endpoint so generated files do not silently become browser-
  // only task records.
  if (window.termaDesktop && (settings?.delivery_mode === "desktop" || settings?.delivery_mode === "browser")) {
    try {
      const result = await api("/api/sftp/download-settings/save-generated", {
        method:"POST",
        headers:{
          "Content-Type":String(blob?.type || options.contentType || "application/octet-stream"),
          "X-Terma-Generated-Filename":encodeURIComponent(String(filename || "generated.pdf"))
        },
        body:blob,
        rawBody:true
      });
      if (!result?.path) throw new Error(tr("sftp:editor.pdf_save_failed", {defaultValue:"PDF 已生成，但保存到任务中心失败"}));
      return addSftpGeneratedTask(blob, result.filename || filename, {
        ...options,
        deliveryStatus:"saved",
        savedPath:result.path,
        size:result.size
      });
    } catch (error) {
      // Keep a generated PDF usable if the local desktop backend briefly reconnects.
      if (typeof triggerSftpGeneratedDownload === "function") triggerSftpGeneratedDownload(blob, filename);
      notify(tr("sftp:editor.generated_save_fallback", {
        reason:error?.message || tr("sftp:editor.generated_save_failed", {defaultValue:"生成文件保存失败"}),
        defaultValue:`生成文件未能保存到任务中心，已改用浏览器下载：${error?.message || "保存失败"}`
      }), "error");
      return addSftpGeneratedTask(blob, filename, {...options, deliveryStatus:"browser"});
    }
  }
  if (typeof triggerSftpGeneratedDownload === "function") triggerSftpGeneratedDownload(blob, filename);
  return addSftpGeneratedTask(blob, filename, {...options, deliveryStatus:"browser"});
}

const saveSftpGeneratedPdfTask = saveSftpGeneratedFileTask;

async function promoteSftpGeneratedTaskToDesktop(task, blob) {
  if (!task || !(blob instanceof Blob) || !window.termaDesktop) return false;
  const settings = await api("/api/sftp/download-settings").catch(() => null);
  if (settings?.delivery_mode !== "desktop") return false;
  try {
    const result = await api("/api/sftp/download-settings/save-generated", {
      method:"POST",
      headers:{
        "Content-Type":String(blob.type || "application/octet-stream"),
        "X-Terma-Generated-Filename":encodeURIComponent(String(task.filename || "generated.pdf"))
      },
      body:blob,
      rawBody:true
    });
    if (!result?.path) return false;
    Object.assign(task, {delivery_status:"saved", saved_path:String(result.path), filename:String(result.filename || task.filename), size:Number(result.size || blob.size), transferred:Number(result.size || blob.size)});
    persistSftpGeneratedTasks();
    sftpLatestJobs = [...sftpLatestJobs.filter(item => item.type !== "local-generated"), ...listSftpGeneratedTasks()];
    if (typeof updateSftpTaskCenter === "function") updateSftpTaskCenter(sftpLatestJobs);
    notify(tr("sftp:editor.generated_saved", {defaultValue:"生成文件已保存到任务中心"}), "success");
    return true;
  } catch { return false; }
}

function localGeneratedTaskParent(value) {
  const normalized = String(value || "").replace(/[\\/]+$/, "");
  const index = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  if (index < 0) return normalized;
  if (index === 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, index + 1);
  return normalized.slice(0, index) || normalized;
}

async function openSftpGeneratedTaskFile(id, button = null) {
  const task = sftpGeneratedTaskById(id);
  if (!task) return notify(tr("sftp:editor.generated_missing", {defaultValue:"生成文件记录不存在"}), "error");
  try {
    const blob = sftpGeneratedFileBlobs.get(task.id);
    if (task.delivery_status !== "saved") {
      if (!blob) throw new Error(tr("sftp:editor.generated_unavailable", {defaultValue:"浏览器下载内容已失效，请重新导出"}));
      if (await promoteSftpGeneratedTaskToDesktop(task, blob)) {
        await api("/api/local-files/open", {method:"POST", body:JSON.stringify({path:task.saved_path})});
        return;
      }
      triggerSftpGeneratedDownload(blob, task.filename);
      return;
    }
    await api("/api/local-files/open", {method:"POST", body:JSON.stringify({path:task.saved_path})});
  } catch (error) {
    notify(error.message || tr("sftp:settings.open_file_failed", {defaultValue:"打开生成文件失败"}), "error");
  }
}

async function openSftpGeneratedTaskDirectory(id) {
  const task = sftpGeneratedTaskById(id);
  if (!task?.saved_path) return notify(tr("sftp:editor.generated_unavailable", {defaultValue:"生成文件已不在本机记录中"}), "error");
  try {
    await api("/api/local-files/open", {method:"POST", body:JSON.stringify({path:localGeneratedTaskParent(task.saved_path)})});
  } catch (error) {
    notify(error.message || tr("sftp:settings.open_directory_failed", {defaultValue:"打开生成文件目录失败"}), "error");
  }
}

async function deleteSftpGeneratedTaskFile(id, button = null) {
  const task = sftpGeneratedTaskById(id);
  if (!task) return notify(tr("sftp:editor.generated_missing", {defaultValue:"生成文件记录不存在"}), "error");
  const actionKey = `sftp-task:delete-generated:${String(id || "")}`;
  if (typeof beginUiAction === "function" && !beginUiAction(actionKey, button)) return;
  try {
    if (typeof confirmModal === "function" && !await confirmModal(
      tr("sftp:editor.generated_delete_confirm", {defaultValue:"删除本机生成文件并移除任务记录？"}),
      tr("tasks:dialogs.delete_title", {defaultValue:"删除任务"}),
      tr("common:actions.delete", {defaultValue:"删除"}),
      tr("common:actions.cancel", {defaultValue:"取消"}),
      true
    )) return null;
    if (task.delivery_status === "saved" && task.saved_path && window.termaDesktop) {
      await api("/api/sftp/download-settings/delete-generated", {
        method:"POST",
        body:JSON.stringify({path:task.saved_path})
      });
    }
    deleteSftpGeneratedTask(id);
    sftpLatestJobs = sftpLatestJobs.filter(item => String(item.id) !== String(id));
    if (typeof updateSftpTaskCenter === "function") updateSftpTaskCenter(sftpLatestJobs);
    notify(tr("sftp:editor.generated_deleted", {defaultValue:"生成文件已删除"}), "success");
  } catch (error) {
    notify(error.message || tr("sftp:editor.generated_delete_failed", {defaultValue:"删除生成文件失败"}), "error");
  } finally {
    if (typeof endUiAction === "function") endUiAction(actionKey, button);
  }
}

function deleteSftpGeneratedTask(id) {
  const key = String(id || "");
  sftpGeneratedFileBlobs.delete(key);
  sftpGeneratedTasks = sftpGeneratedTasks.filter(item => String(item.id) !== key);
  persistSftpGeneratedTasks();
}

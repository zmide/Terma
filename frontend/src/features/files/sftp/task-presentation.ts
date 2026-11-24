export interface PresentationJob {
 type?:string;status?:string;phase?:string;label?:string;label_i18n?:boolean;label_i18n_key?:string;label_i18n_params?:Record<string,unknown>;
 label_component?:string;label_component_key?:string;label_action?:string;label_action_key?:string;
 remote_path?:string;remote_paths?:string[];local_path?:string;source_paths?:string[];item_count?:number;size?:number;transferred?:number;
 archive_download?:boolean;recycled?:boolean;source_connection_name?:string;connection_name?:string;speed_bps?:number;
 progress_estimated?:boolean;progress_unit?:string;current?:string;current_i18n_key?:string;
 error?:string;error_code?:string;error_params?:Record<string,unknown>;delivery_error?:string;delivery_error_code?:string;delivery_error_params?:Record<string,unknown>;
 warning?:string;warning_code?:string;warning_params?:Record<string,unknown>;
}
interface Port {
 tr(key:string,values?:Record<string,unknown>):string;localize(value:string):string;raw(value:string):string;
 normalizeCode(code:unknown):string;params(value:unknown):Record<string,unknown>;language():string;exists(key:string,language:string):boolean;
 bytes(value:number):string;progress(job:PresentationJob):{size:number;transferred:number;percent:number}|null;
}
export function createTaskPresentation(port:Port){
 const tr=port.tr;
function localizedSftpJobText(value:unknown, key="") {
  if (key) return tr(key);
  const source = String(value || "");
  return port.localize(source);
}
function localizedSftpTaskMessage(message:unknown, code:unknown="", params:unknown={}) {
  const source = String(message || "");
  const normalizedCode=port.normalizeCode(code);
  const safeParams=port.params(params);
  const language=port.language();
  const key = normalizedCode ? `tasks:job_issues.${normalizedCode}` : "";
  if (key && port.exists(key,language)) {
    return tr(key, {...safeParams, lng:language, fallbackLng:false, defaultValue:""});
  }
  if (normalizedCode && language === "en-US") {
    return tr("tasks:job_issues.unknown", {lng:"en-US", fallbackLng:false, defaultValue:"The task could not be completed."});
  }
  if (!source) return "";
  return port.raw(source);
}

function localizedSftpJobIssue(job:PresentationJob|undefined, field:'error'|'delivery_error'|'warning') {
  return localizedSftpTaskMessage(
    job?.[field],
    job?.[`${field}_code`],
    job?.[`${field}_params`]
  );
}


function sftpJobDisplayLabel(job:PresentationJob={}) {
  if (job.label_i18n_key) {
    const component = job.label_component || (job.label_component_key ? tr(job.label_component_key) : "");
    const action = job.label_action_key ? tr(job.label_action_key) : localizedSftpJobText(job.label_action);
    return tr(job.label_i18n_key, {...job.label_i18n_params, component, action});
  }
  if (job.label_i18n === true) return String(job.label || job.type || "");
  const source = String(job.label || job.type || "");
  const pathName = (value:unknown) => String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
  if (job.type === "download") {
    if (job.archive_download) {
      const count = Array.isArray(job.remote_paths) ? job.remote_paths.length : Number(job.item_count || 0);
      return tr("sftp:task_ui.archive_download", {count, defaultValue:`打包下载 ${count} 项`});
    }
    if (source === "批量下载到本机") return tr("sftp:task_ui.batch_download_local", {defaultValue:"批量下载到本机"});
    const name = pathName(job.remote_path) || source.match(/^下载\s+(.+)$/)?.[1] || "";
    return name ? tr("sftp:task_ui.download_file", {name, defaultValue:`下载 ${name}`}) : localizedSftpJobText(source);
  }
  if (job.type === "upload") {
    const name = pathName(job.remote_path || job.local_path) || source.match(/^上传\s+(.+)$/)?.[1] || "";
    return name ? tr("sftp:task_ui.upload_file", {name, defaultValue:`上传 ${name}`}) : localizedSftpJobText(source);
  }
  if (job.type === "delete") {
    const count = Math.max(1, Number(job.item_count || job.size || 1));
    const action = tr(job.recycled ? "sftp:operations.recycle_confirm" : "sftp:menu.delete", {defaultValue:job.recycled ? "移入回收站" : "删除"});
    const name = count === 1 ? source.match(/^(?:移入回收站|删除)\s+(.+)$/)?.[1] || "" : "";
    if (count === 1 && !name) return localizedSftpJobText(source);
    return name
      ? tr("sftp:task_ui.item_action", {action, name, defaultValue:`${action} ${name}`})
      : tr("sftp:task_ui.items_action", {action, count, defaultValue:`${action} ${count} 项`});
  }
  if (job.type === "cross-copy") {
    const count = Math.max(0, Number(job.source_paths?.length || job.item_count || job.size || 0));
    return job.source_connection_name
      ? tr("sftp:task_ui.copy_from_connection", {name:job.source_connection_name, count, defaultValue:`从 ${job.source_connection_name} 复制 ${count} 项`})
      : tr("sftp:task_ui.copy_items", {count, defaultValue:`复制 ${count} 项`});
  }
  return localizedSftpJobText(source);
}

function sftpJobProgressLabel(job:PresentationJob|undefined, progress:{percent:number}|null) {
  if (!progress) return "";
  return job?.progress_estimated
    ? tr("tasks:auto.estimated_percent", {percent:Math.round(progress.percent), defaultValue:`约 ${Math.round(progress.percent)}%`})
    : `${Math.round(progress.percent)}%`;
}


function sftpFloatingJobDetail(job:PresentationJob) {
  const progress = port.progress(job);
  const speed = job.status === "running" ? Number(job.speed_bps || 0) : 0;
  const transferred = Math.max(0, Number(job.transferred || 0));
  const size = Math.max(0, Number(job.size || 0));
  const amount = job.progress_unit === "percent"
    ? localizedSftpJobText(job.current, job.current_i18n_key)
    : job.progress_unit === "items" && size
      ? tr("tasks:auto.processed_items", {count:size, completed:Math.min(size, transferred), total:size, defaultValue:`已处理 ${Math.min(size, transferred)} / ${size} 项`})
      : progress
        ? `${port.bytes(progress.transferred)} / ${port.bytes(progress.size)}`
        : "";
  return [job.connection_name || "", sftpJobStatus(job.status||'', job.phase), amount, speed ? `${port.bytes(speed)}/s` : "", sftpJobProgressLabel(job, progress)]
    .filter(Boolean)
    .join(" · ");
}


function sftpJobStatus(status:string, phase="") {
  if (status === "running" && ["archiving", "committing", "downloading", "scanning", "transferring"].includes(phase)) {
    return tr(`tasks:phase.${phase}`, {defaultValue:phase});
  }
  if (status === "pending" && phase === "queued") return tr("tasks:phase.queued", {defaultValue:"排队中"});
  if (status === "running" && phase === "receiving") return tr("tasks:phase.receiving", {defaultValue:"正在准备上传"});
  if (status === "running" && phase === "uploading") return tr("tasks:phase.uploading", {defaultValue:"正在上传到远端"});
  if (status === "running" && phase === "committing") return tr("tasks:phase.completing", {defaultValue:"正在完成"});
  if (status === "running" && phase === "system-saving") return tr("tasks:phase.system_saving", {defaultValue:"正在保存到本机"});
  if (status === "running" && phase === "local-saving") return tr("tasks:phase.local_saving", {defaultValue:"正在下载到本机"});
  if (status === "running" && phase === "cancelling") return tr("tasks:phase.cancelling", {defaultValue:"正在停止"});
  if (status === "pending" && phase === "resuming") return tr("tasks:phase.resuming", {defaultValue:"正在继续"});
  return tr(`tasks:status.${status}`, {defaultValue:status});
}

return {bytes:port.bytes,text:localizedSftpJobText,message:localizedSftpTaskMessage,issue:localizedSftpJobIssue,label:sftpJobDisplayLabel,progressLabel:sftpJobProgressLabel,detail:sftpFloatingJobDetail,status:sftpJobStatus};
}

import {translate as tr} from '@/shared/i18n/runtime';
interface IdentityLabel {source?:unknown;path?:unknown;label?:unknown;source_label?:unknown;name?:unknown;permission_ok?:unknown}
export function localizedIdentitySourceLabel(identity:IdentityLabel={}) {
  const source = String(identity?.source || "").toLowerCase();
  if (source === "project") return tr("connections:identity.source_project", {defaultValue:"当前密钥目录"});
  if (source === "user") return tr("connections:identity.source_user", {defaultValue:"用户 ~/.ssh"});
  return tr("connections:identity.source_unknown", {defaultValue:"已识别私钥"});
}

export function localizedIdentityFileLabel(value:unknown={},options:{permission?:boolean;repair?:boolean}={}) {
  const identity:IdentityLabel=value&&typeof value==='object'?value:{};
  const pathValue = String(identity?.path || "");
  const rawLabel = String(identity?.label || "");
  const sourceLabel = String(identity?.source_label || "");
  const fallbackName = pathValue.split(/[\\/]/).filter(Boolean).pop() || rawLabel || pathValue;
  const name = String(identity?.name || rawLabel.replace(sourceLabel ? new RegExp(`\\s*(?:-|·)\\s*${sourceLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) : /$^/, "") || fallbackName);
  const label = tr("connections:identity.file_label", {
    name,
    source:localizedIdentitySourceLabel(identity),
    defaultValue:`${name} - ${localizedIdentitySourceLabel(identity)}`
  });
  if (options.permission === false || identity?.permission_ok !== false) return label;
  const suffixKey = options.repair ? "connections:identity.permission_repair" : "connections:identity.permission_check";
  return `${label}${tr(suffixKey, {defaultValue:options.repair ? "（权限需修复）" : "（需检查权限）"})}`;
}


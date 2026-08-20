function keyManagementTranslator() {
  return (key, fallback) => tr(`settings:key_management.${key}`, {defaultValue: fallback});
}

function managedKeyManagementHtml(settings = {}) {
  const enabled = settings.manage_user_ssh_keys_enabled === true;
  const t = keyManagementTranslator();
  return `<section class="ssh-key-management-panel" id="sshKeyManagementPanel">
    <div class="ssh-key-management-toolbar">
      <div class="ssh-key-management-title"><div class="ssh-key-management-mark">${icon('key-round')}</div><div><strong>${esc(t('project_title', 'Terma 密钥目录'))}</strong><span class="muted">${esc(t('project_hint', '私钥只在本机管理，列表不会显示私钥内容。'))}</span></div></div>
      <div class="actions"><button type="button" data-managed-action="generate">${icon('plus')}<span>${esc(t('generate', 'Generate key'))}</span></button><button type="button" data-managed-action="import">${icon('upload')}<span>${esc(t('import', 'Import key'))}</span></button><button type="button" class="icon-button" data-managed-action="refresh" title="${escAttr(t('refresh', 'Refresh'))}" aria-label="${escAttr(t('refresh', 'Refresh'))}">${icon('refresh-cw')}</button></div>
    </div>
    <div class="ssh-key-management-scope"><div><strong>${esc(t('user_scope', '用户 ~/.ssh'))}</strong><span class="muted">${esc(t('user_scope_hint', '开启后可查看、导入和部署用户目录中的密钥'))}</span></div><label class="switch-row"><input id="manageUserSshKeysEnabled" type="checkbox" ${enabled ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>${esc(enabled ? t('enabled', '已启用') : t('disabled', '默认关闭'))}</span></label></div>
    <div class="ssh-key-table-head"><span>${esc(t('key_column', '密钥'))}</span><span>${esc(t('type_column', '类型'))}</span><span>${esc(t('scope_column', '目录'))}</span><span>${esc(t('actions_column', '操作'))}</span></div>
    <div id="managedKeysList" class="ssh-key-management-list"><span class="muted">${esc(t('loading', '正在读取密钥...'))}</span></div>
  </section>`;
}
function sshKeyManagementHtml(settings = {}) { return managedKeyManagementHtml(settings); }

async function loadManagedKeys() {
  const list = document.querySelector('#managedKeysList');
  if (!list) return;
  const t = keyManagementTranslator();
  try {
    const result = await api('/api/managed-keys');
    const items = Array.isArray(result.items) ? result.items : [];
    list.innerHTML = items.length ? items.map(item => {
      const encrypted = item.has_passphrase === true;
      const scopeLabel = item.scope === 'user' ? t('user_scope_short', '用户 ~/.ssh') : t('project_scope', 'Terma 密钥目录');
      return `<div class="ssh-managed-key-row"><div class="ssh-key-cell ssh-key-name-cell"><div class="ssh-key-icon ${encrypted ? 'encrypted' : ''}">${icon(encrypted ? 'lock-keyhole' : 'key-round')}</div><div class="ssh-key-name-text"><strong title="${escAttr(item.name)}">${esc(item.name)}</strong><span>${esc(item.comment || t('no_comment', '无备注'))}</span></div></div><div class="ssh-key-cell ssh-key-type-cell"><span class="key-type-badge">${esc(item.type || item.key_type || t('unknown_type', '未知'))}</span><span class="muted">${esc(item.bits ? `${item.bits} bit` : '')}</span></div><div class="ssh-key-cell ssh-key-scope-cell"><span>${esc(scopeLabel)}</span><small>${esc(encrypted ? t('encrypted', '已加密') : t('not_encrypted', '未加密'))}</small></div><div class="ssh-managed-key-actions">${managedKeyButton('properties', item, 'sliders-horizontal', t('properties', '属性'))}${managedKeyButton('public', item, 'key', t('show_public', '查看公钥'))}${managedKeyButton('deploy', item, 'upload', t('deploy', '部署公钥'))}${managedKeyButton('delete', item, 'trash-2', t('delete', '删除'), true)}</div></div>`;
    }).join('') : `<div class="ui-state empty compact"><strong>${esc(t('empty', '暂无托管密钥'))}</strong><span>${esc(t('empty_hint', '可生成或导入 Terma 密钥。'))}</span></div>`;
    refreshIcons();
  } catch (error) {
    list.innerHTML = `<div class="warning">${esc(error.message || t('load_failed', '密钥列表加载失败'))}</div>`;
  }
}

function managedKeyButton(action, item, glyph, label, danger = false) {
  return `<button type="button" class="icon-button${danger ? ' danger' : ''}" data-managed-action="${action}" data-path="${escAttr(item.path)}" data-scope="${escAttr(item.scope)}" title="${escAttr(label)}" aria-label="${escAttr(label)}">${icon(glyph)}</button>`;
}

async function managedKeyScopeChanged(enabled) {
  securitySettings = await api('/api/security', {method:'PUT', body:JSON.stringify({manage_user_ssh_keys_enabled:Boolean(enabled)})});
  renderSettings(); showSettingsSection('settings-key-management', {moveToWorkspace:false}); await loadManagedKeys();
}
function bindManagedModal(modal) { modal.querySelectorAll('[data-managed-modal-close]').forEach(button => button.addEventListener('click', closeModal)); }

function showManagedPublicKey(value) {
  const modal = $('modal'); modal.hidden = false;
  modal.innerHTML = `<div class="modal-card wide ssh-key-public-modal"><div class="ssh-key-public-head"><div><span class="eyebrow">${esc(tr('settings:key_management.public_eyebrow', {defaultValue:'PUBLIC KEY'}))}</span><h2>${esc(tr('settings:key_management.public_title', {defaultValue:'SSH 公钥'}))}</h2></div><button class="icon-button" type="button" data-managed-modal-close="true">${icon('x')}</button></div><div class="ssh-key-public-preview"><div class="ssh-key-public-preview-icon">${icon('key-round')}</div><div><strong>${esc(tr('settings:key_management.public_hint', {defaultValue:'可安全复制到远端 authorized_keys'}))}</strong><span>${esc(tr('settings:key_management.public_readonly', {defaultValue:'公钥内容只读显示，不会泄露私钥。'}))}</span></div></div><textarea id="managedPublicKeyText" readonly>${esc(value || '')}</textarea><div class="ssh-key-modal-actions"><button type="button" data-managed-copy="true">${icon('copy')}<span>${esc(tr('settings:key_management.copy', {defaultValue:'复制公钥'}))}</span></button><button type="button" class="primary" data-managed-modal-close="true">${esc(tr('common:actions.close', {defaultValue:'关闭'}))}</button></div></div>`;
  refreshIcons(); bindManagedModal(modal); modal.querySelector('[data-managed-copy]')?.addEventListener('click', async () => {await navigator.clipboard.writeText($('managedPublicKeyText').value || ''); notify(tr('settings:key_management.copied', {defaultValue:'公钥已复制'}), 'success');});
}

function showManagedProperties(data) {
  const modal = $('modal'); modal.hidden = false; const t = keyManagementTranslator(); const encrypted = data.has_passphrase === true;
  const fingerprint = String(data.fingerprint || '').trim();
  modal.innerHTML = `<div class="modal-card wide ssh-key-properties-modal"><div class="ssh-key-public-head"><div><span class="eyebrow">${esc(t('properties_eyebrow', 'Key details'))}</span><h2>${esc(data.name || t('properties', 'Key properties'))}</h2></div><button class="icon-button" type="button" data-managed-modal-close="true">${icon('x')}</button></div><div class="ssh-key-properties-grid"><div><span>${esc(t('algorithm', 'Algorithm'))}</span><strong>${esc(data.type || data.key_type || 'SSH')}</strong></div><div><span>${esc(t('length', 'Length'))}</span><strong>${esc(data.bits ? `${data.bits} bit` : '-')}</strong></div><div><span>${esc(t('protection', 'Protection'))}</span><strong class="${encrypted ? 'is-encrypted' : 'is-open'}">${icon(encrypted ? 'lock-keyhole' : 'unlock-keyhole')}${esc(encrypted ? t('encrypted', 'Encrypted') : t('not_encrypted', 'Unencrypted'))}</strong></div><div><span>${esc(t('scope_column', 'Location'))}</span><strong>${esc(data.scope === 'user' ? t('user_scope_short', 'User ~/.ssh') : t('project_scope', 'Terma key directory'))}</strong></div></div><div class="ssh-key-property-fingerprint"><span>${esc(t('fingerprint', 'Fingerprint'))}</span><code>${esc(fingerprint || '-')}</code></div><div class="ssh-key-property-field"><label for="managedKeyComment">${esc(t('comment', 'Comment'))}</label><input id="managedKeyComment" value="${escAttr(data.comment || '')}" maxlength="120" placeholder="${escAttr(t('comment_placeholder', 'For example: production, office laptop'))}"></div><div class="ssh-key-passphrase-box"><div><strong>${esc(encrypted ? t('change_passphrase', 'Change private-key passphrase') : t('set_passphrase', 'Set private-key passphrase'))}</strong><span>${esc(t('passphrase_hint', 'The passphrase is used only for this change and is not saved in Terma settings.'))}</span></div><label>${esc(t('current_passphrase', 'Current passphrase'))}<input id="managedCurrentPassphrase" type="password" autocomplete="current-password" ${encrypted ? '' : 'disabled'}></label><label>${esc(t('new_passphrase', 'New passphrase'))}<input id="managedNewPassphrase" type="password" autocomplete="new-password" placeholder="${escAttr(t('empty_to_remove', 'Leave empty to remove the passphrase'))}"></label></div><div class="ssh-key-modal-actions"><button type="button" data-managed-properties-save="true" class="primary">${icon('save')}<span>${esc(t('save_changes', 'Save changes'))}</span></button><button type="button" data-managed-modal-close="true">${esc(tr('common:actions.cancel', {defaultValue:'Cancel'}))}</button></div></div>`;
  refreshIcons(); bindManagedModal(modal); modal.querySelector('[data-managed-properties-save]')?.addEventListener('click', async () => {const save = modal.querySelector('[data-managed-properties-save]'); save.disabled = true; try {await api('/api/managed-keys/properties', {method:'PUT', body:JSON.stringify({path:data.path, scope:data.scope, comment:$('managedKeyComment').value, current_passphrase:$('managedCurrentPassphrase')?.value || '', new_passphrase:$('managedNewPassphrase')?.value || '', change_passphrase:Boolean($('managedCurrentPassphrase')?.value || $('managedNewPassphrase')?.value)})}); closeModal(); await loadManagedKeys(); notify(t('saved', '密钥属性已更新'), 'success');} catch (error) {notify(error.message, 'error'); save.disabled = false;}});
}

function showManagedDeploy(path) {
  const modal = $('modal'); modal.hidden = false; const t = keyManagementTranslator(); const options = connections.map(connection => `<option value="${escAttr(connection.id)}">${esc(productivityConnectionLabel(connection))}</option>`).join('');
  modal.innerHTML = `<div class="modal-card ssh-key-deploy-modal"><div class="ssh-key-public-head"><h2>${esc(t('deploy_title', '部署公钥'))}</h2><button class="icon-button" type="button" data-managed-modal-close="true">${icon('x')}</button></div><p class="muted">${esc(t('deploy_hint', '选择一个 SSH 连接，将公钥追加到远端 authorized_keys。'))}</p><label>${esc(t('target', '目标连接'))}<select id="managedDeployConnection"><option value="">${esc(t('select_target', '选择 SSH 连接'))}</option>${options}</select></label><div class="actions"><button type="button" class="primary" data-managed-deploy-confirm="true">${icon('upload')}<span>${esc(t('deploy', '部署公钥'))}</span></button><button type="button" data-managed-modal-close="true">${esc(tr('common:actions.cancel', {defaultValue:'取消'}))}</button></div></div>`;
  refreshIcons(); bindManagedModal(modal); modal.querySelector('[data-managed-deploy-confirm]')?.addEventListener('click', async () => {const id = Number($('managedDeployConnection')?.value || 0); if (!id) return notify(t('select_target', '请选择 SSH 连接'), 'info'); await api(`/api/connections/${id}/ssh-key/deploy`, {method:'POST', body:JSON.stringify({public_path:path})}); closeModal(); notify(t('deployed', '公钥已部署'), 'success');});
}

async function managedKeyAction(action, el) {
  const path = el.dataset.path; const scope = el.dataset.scope || 'project';
  if (action === 'properties') return showManagedProperties(await api('/api/managed-keys/properties', {method:'POST', body:JSON.stringify({path, scope})}));
  if (action === 'public') return showManagedPublicKey((await api(`/api/managed-keys/public?scope=${encodeURIComponent(scope)}&path=${encodeURIComponent(path)}`)).public_key);
  if (action === 'deploy') return showManagedDeploy(`${path}.pub`);
  if (action === 'delete') {const name = String(path || '').replaceAll('\\', '/').split('/').filter(Boolean).pop() || String(path || ''); if (!await confirmModal(tr('settings:key_management.delete_confirm', {name}), tr('settings:key_management.delete', {defaultValue:'删除密钥'}), tr('common:actions.delete', {defaultValue:'删除'}), tr('common:actions.cancel', {defaultValue:'取消'}), true)) return; await api('/api/managed-keys', {method:'DELETE', body:JSON.stringify({path, scope})}); await loadManagedKeys(); notify(tr('settings:key_management.deleted', {defaultValue:'密钥已删除'}), 'success');}
}

async function importManagedKeyUi() {
  const enabled = securitySettings?.manage_user_ssh_keys_enabled === true; const t = keyManagementTranslator(); let scope = 'project';
  const openFile = () => {const input = document.createElement('input'); input.type = 'file'; input.onchange = async () => {const file = input.files && input.files[0]; if (!file) return; const form = new FormData(); form.append('key', file, file.name); await api(`/api/managed-keys/import?scope=${encodeURIComponent(scope)}`, {method:'POST', body:form}); await loadManagedKeys(); notify(t('imported', '密钥已导入'), 'success');}; input.click();};
  if (!enabled) return openFile();
  const modal = $('modal'); modal.hidden = false; modal.innerHTML = `<div class="modal-card ssh-key-deploy-modal"><div class="ssh-key-public-head"><h2>${esc(t('import_title', '导入 SSH 密钥'))}</h2><button class="icon-button" type="button" data-managed-modal-close="true">${icon('x')}</button></div><label>${esc(t('import_scope', '导入到'))}<select id="managedImportScope"><option value="project">${esc(t('project_scope', 'Terma 密钥目录'))}</option><option value="user">${esc(t('user_scope', '用户 ~/.ssh'))}</option></select></label><div class="actions"><button type="button" class="primary" data-managed-import-confirm="true">${icon('upload')}<span>${esc(t('choose_file', '选择私钥文件'))}</span></button><button type="button" data-managed-modal-close="true">${esc(tr('common:actions.cancel', {defaultValue:'取消'}))}</button></div></div>`; refreshIcons(); bindManagedModal(modal); modal.querySelector('[data-managed-import-confirm]')?.addEventListener('click', () => {scope = $('managedImportScope')?.value || 'project'; closeModal(); openFile();});
}

document.addEventListener('click', event => {const el = event.target.closest && event.target.closest('[data-managed-action]'); if (!el) return; const action = el.dataset.managedAction; if (action === 'generate') return openSshKeyWizard(); if (action === 'import') return importManagedKeyUi(); if (action === 'refresh') return loadManagedKeys(); managedKeyAction(action, el).catch(error => notify(error.message, 'error'));});
document.addEventListener('change', event => {if (event.target.id === 'manageUserSshKeysEnabled') managedKeyScopeChanged(event.target.checked).catch(error => notify(error.message, 'error'));});

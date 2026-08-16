function hideSftpContextMenu() {
  $("sftpContextMenu")?.remove();
}

function showSftpEntryMenu(event, id, path, name, type, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  const alreadySelected = selectedSftpPaths(tabKey).includes(path);
  selectSftpEntry({shiftKey:false, ctrlKey:false, metaKey:false, preserveSelection:alreadySelected, forceSingle:true}, id, path, name, type, tabKey);
  const isDir = type === "dir";
  const rect = event.currentTarget?.getBoundingClientRect?.();
  const menuEvent = {
    preventDefault: () => event.preventDefault(),
    stopPropagation: () => event.stopPropagation(),
    clientX: event.clientX || rect?.right || 8,
    clientY: event.clientY || rect?.bottom || 8
  };
  const peerTransferActions = typeof workspaceSftpPathTransferActions === "function"
    ? workspaceSftpPathTransferActions(tabKey, id, path, name, type)
    : [];
  showActionMenu(menuEvent, [
    isDir
      ? {label:tr("sftp:menu.open", {defaultValue:"打开"}), icon:"folder-open", run:()=>navigateSftpPath(path, tabKey)}
      : isSftpImageName(name)
        ? {label:tr("sftp:menu.preview_image", {defaultValue:"预览图片"}), icon:"image", run:()=>previewSftpImage(id, path)}
        : {label:tr("sftp:menu.open_as_text", {defaultValue:"以文本打开"}), icon:"file-text", run:()=>previewSftpText(id, path)},
    ...(!isDir && window.termaDesktop ? [{label:tr("sftp:menu.external_editor", {defaultValue:"用外部编辑器打开"}), icon:"external-link", run:()=>openSftpExternalEdit(id, path)}] : []),
    ...(isDir && window.termaDesktop ? [{label:tr("sftp:menu.compare_local", {defaultValue:"与本地目录比较同步"}), icon:"refresh-cw", run:()=>openSftpDirectorySync(id, path, tabKey)}] : []),
    {label:tr("sftp:menu.download", {defaultValue:"下载"}), icon:"download", run:()=>downloadSftp(id, path, isDir ? "dir" : "file")},
    ...(window.termaDesktop && typeof sendSftpPathsToDesktop === "function" ? [{label:tr("sftp:menu.send_desktop", {defaultValue:"发送到桌面"}), icon:"monitor-down", run:()=>sendSftpPathsToDesktop(id, [path])}] : []),
    ...(peerTransferActions.length ? [{label:tr("sftp:menu.send_peer", {defaultValue:"发送到对端"}), icon:"send", children:peerTransferActions}] : []),
    ...(!isDir && isArchiveName(name) ? [{label:tr("sftp:menu.extract", {defaultValue:"解压"}), icon:"archive-restore", run:()=>extractSingleSftp(id, path, tabKey)}] : []),
    {label:tr("sftp:menu.compress", {defaultValue:"压缩"}), icon:"archive", run:()=>compressSingleSftp(id, path, tabKey)},
    {separator:true},
    {label:tr("sftp:menu.copy_path", {defaultValue:"复制路径"}), icon:"clipboard", run:()=>copyText(path)},
    {label:tr("sftp:menu.copy", {defaultValue:"复制"}), icon:"copy", run:()=>copySingleSftp(path, "copy", tabKey)},
    {label:tr("sftp:menu.move", {defaultValue:"移动"}), icon:"folder-input", run:()=>copySingleSftp(path, "move", tabKey)},
    {label:tr("sftp:menu.rename", {defaultValue:"重命名"}), icon:"pencil", run:()=>renameSftp(id, path, name, tabKey)},
    {label:tr("sftp:menu.permissions", {defaultValue:"设置权限"}), icon:"key-round", run:()=>openSftpPermissionsForSelection([path], tabKey)},
    {separator:true},
    {label:tr("sftp:menu.new_file", {defaultValue:"新建文件"}), icon:"file-plus-2", run:()=>createSftpFile(tabKey)},
    {label:tr("sftp:menu.new_folder", {defaultValue:"新建文件夹"}), icon:"folder-plus", run:()=>mkdirSftp(tabKey)},
    {separator:true},
    {label:tr("sftp:menu.delete", {defaultValue:"删除"}), icon:"trash-2", danger:true, run:()=>deleteSftp(id, path, tabKey)}
  ]);
}

function showSftpDirectoryMenu(event, tabKey=sftpTabKeyFromNode(event?.currentTarget)) {
  if (event.target?.closest?.(".sftp-row, .sftp-head, .pager, button, input, select")) return;
  event.preventDefault();
  event.stopPropagation();
  showActionMenu(event, [
    {label:tr("sftp:menu.new_file", {defaultValue:"新建文件"}), icon:"file-plus-2", run:()=>createSftpFile(tabKey)},
    {label:tr("sftp:menu.new_folder", {defaultValue:"新建文件夹"}), icon:"folder-plus", run:()=>mkdirSftp(tabKey)},
    {label:tr("sftp:menu.upload_items", {defaultValue:"上传文件或文件夹"}), icon:"upload", run:()=>sftpElement("sftpUpload", tabKey)?.click()},
    ...(window.termaDesktop ? [{label:tr("sftp:menu.compare_local", {defaultValue:"与本地目录比较同步"}), icon:"refresh-cw", run:()=>{
      const runtime = sftpTabRuntimes.get(String(tabKey || ""));
      const tab = tabs.find(item => item.key === tabKey);
      return openSftpDirectorySync(tab?.id, runtime?.state.path || ".", tabKey);
    }}] : []),
    ...(sftpClipboard ? [{label:tr(sftpClipboard.mode === "move" ? "sftp:menu.move_here" : "sftp:menu.paste_here", {defaultValue:sftpClipboard.mode === "move" ? "移动到此处" : "粘贴到此处"}), icon:"clipboard-paste", run:()=>pasteSftpClipboard(tabKey)}] : []),
    {separator:true},
    {label:tr("sftp:menu.refresh", {defaultValue:"刷新"}), icon:"refresh-cw", run:()=>refreshSftp({refresh:true, tabKey})}
  ]);
}

let sftpInlineRenamePending = null;
let sftpInlineRenameEditor = null;
const sftpNameClickHistory = new Map();

function cancelSftpInlineRename() {
  if (sftpInlineRenamePending) clearTimeout(sftpInlineRenamePending.timer);
  sftpInlineRenamePending = null;
}

function beginSftpInlineRename(label,tabKey,connectionId,from,name,type) {
  cancelSftpInlineRename();
  if (!label.isConnected || isMobileLayout()) return;
  sftpInlineRenameEditor?.cancel();
  const row=label.closest('.sftp-row'), field=document.createElement('input');
  const rect=label.getBoundingClientRect(), parent=row.getBoundingClientRect();
  field.type='text';field.value=name;field.className='sftp-inline-rename-input';
  field.setAttribute('aria-label',tr('sftp:dialogs.new_name'));
  Object.assign(field.style,{position:'absolute',left:Math.max(0,rect.left-parent.left)+'px',top:Math.max(0,rect.top-parent.top-3)+'px',width:Math.min(parent.right-rect.left-8,Math.max(120,rect.width+28))+'px',zIndex:'5'});
  row.classList.add('sftp-inline-renaming');label.style.visibility='hidden';row.appendChild(field);
  let finished=false;
  const finish=()=>{if(finished)return;finished=true;label.style.visibility='';field.remove();row.classList.remove('sftp-inline-renaming');sftpInlineRenameEditor=null;};
  sftpInlineRenameEditor={cancel:finish};
  const save=async()=>{
    if(finished)return;
    const next=field.value;
    if(next===name){finish();return;}
    if(!next.trim() || next==='.' || next==='..' || /[\/\0\r\n]/.test(next)){notify(tr('sftp:inline_rename.invalid_name'),'error');field.focus();return;}
    field.disabled=true;
    try {
      await api(`/api/connections/${connectionId}/sftp/rename`,{method:'POST',body:JSON.stringify({from,to:joinRemotePath(parentRemotePath(from),next)})});
      finish();await refreshSftp({tabKey});
    }catch(error){field.disabled=false;notify(error.message,'error');field.focus();}
  };
  for(const event of ['click','dblclick','pointerdown'])field.addEventListener(event,event=>event.stopPropagation());
  field.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();finish();}else if(event.key==='Enter'){event.preventDefault();void save();}});
  field.addEventListener('blur',()=>{if(!field.disabled)void save();});
  field.focus();
  const dot=type==='file'?name.lastIndexOf('.'):-1;
  field.setSelectionRange(0,dot>0?dot:name.length);
}

function handleSftpNameClick(event) {
  if(event.target?.closest?.('.sftp-inline-rename-input'))return;
  const label=event.target?.closest?.('.sftp-file-name') || event.target?.closest?.('.sftp-name')?.querySelector('.sftp-file-name');
  if(!label || isMobileLayout())return cancelSftpInlineRename();
  const row=label.closest('.sftp-row'), checkbox=row?.querySelector('.sftp-check');
  if(!checkbox)return;
  const tabKey=sftpTabKeyFromNode(row),runtime=restoreSftpRuntimeForTab(tabKey),from=checkbox.value;
  if(!runtime)return;
  const previous=sftpNameClickHistory.get(tabKey),now=Date.now();
  const selected=runtime.state.selected?.path===from && checkbox.checked && sftpElements('.sftp-check',tabKey).filter(input=>input.checked).length===1;
  cancelSftpInlineRename();
  if(event.detail<2 && !event.ctrlKey && !event.metaKey && !event.shiftKey && selected && (!previous || previous.path!==from || now-previous.time>500)) {
    sftpInlineRenamePending={tabKey,timer:setTimeout(()=>{
      if(runtime.state.selected?.path!==from || !label.isConnected)return cancelSftpInlineRename();
      beginSftpInlineRename(label,tabKey,runtime.state.connectionId,from,label.textContent,checkbox.dataset.type || 'file');
    },550)};
  }
  sftpNameClickHistory.set(tabKey,{path:from,time:now});
}

if(typeof document !== 'undefined') {
  document.addEventListener('click',handleSftpNameClick,true);
  document.addEventListener('dblclick',cancelSftpInlineRename,true);
  document.addEventListener('dragstart',cancelSftpInlineRename,true);
  document.addEventListener('pointerdown',event=>{if(!event.target.closest?.('.sftp-file-name,.sftp-name'))cancelSftpInlineRename();},true);
  window.addEventListener('pagehide',()=>{cancelSftpInlineRename();sftpInlineRenameEditor?.cancel();});
}

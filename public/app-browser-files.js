// Browser-owned handles never leave this renderer or enter workspace storage.
class BrowserFileDirectory {
  constructor() { this.handle = null; this.files = []; this.name = ''; this.writable = false; }
  async choose(mode='auto') {
    if (mode !== 'readonly' && window.isSecureContext && typeof window.showDirectoryPicker === 'function') {
      let handle;
      try {handle = await window.showDirectoryPicker({mode:'readwrite',startIn:'documents'});}
      catch(error) {if(error.name==='SecurityError'||error.name==='NotAllowedError')throw new Error(webFilesTr('folder_restricted'));throw error;}
      this.handle = handle; this.name = handle.name; this.files = []; this.writable = true;
      return;
    }
    const files = await new Promise(resolve => {
      const input = document.createElement('input'); input.type = 'file'; input.webkitdirectory = true; input.multiple = true;
      input.hidden = true; document.body.appendChild(input);
      const finish = value => {input.remove();resolve(value);};
      input.addEventListener('change', () => finish([...input.files]), {once:true});
      input.addEventListener('cancel', () => finish(null), {once:true}); input.click();
    });
    if (!files) return;
    this.files = files; this.handle = null; this.writable = false;
    this.name = files[0]?.webkitRelativePath?.split('/')[0] || '';
  }
  parts(value) {
    const parts = String(value || '/browser').split('/');
    if (parts.shift() !== '' || parts.shift() !== 'browser' || parts.some(part => !part || part === '.' || part === '..' || /[\\\0]/.test(part))) throw new Error(webFilesTr('invalid_path'));
    return parts;
  }
  async directory(value) {
    let handle = this.handle;
    if (!handle) throw new Error(webFilesTr('choose_folder'));
    for (const part of this.parts(value)) handle = await handle.getDirectoryHandle(part);
    return handle;
  }
  async file(value) {
    const parts = this.parts(value);
    const name = parts.pop();
    if (!name) throw new Error(webFilesTr('invalid_path'));
    if (!this.handle) {
      const relative = [this.name,...parts,name].join('/');
      const file = this.files.find(item => item.webkitRelativePath === relative);
      if (!file) throw new Error(webFilesTr('invalid_path'));
      return file;
    }
    return (await (await this.directory('/browser'+(parts.length ? '/'+parts.join('/') : ''))).getFileHandle(name)).getFile();
  }
  async list(value='/browser') {
    const parts = this.parts(value);
    const entries = [];
    if (this.handle) {
      const handle = await this.directory(value);
      for await (const [name,item] of handle.entries()) {
        const file = item.kind === 'file' ? await item.getFile() : null;
        entries.push({name,path:value+'/'+name,type:item.kind === 'directory' ? 'dir' : 'file',size:file?.size || 0,mtime:Math.floor((file?.lastModified || 0)/1000)});
        if (entries.length > 10000) throw new Error(webFilesTr('entry_limit'));
      }
    } else {
      const prefix = [this.name,...parts].join('/')+'/';
      const seen = new Set();
      for (const file of this.files) {
        if (!file.webkitRelativePath.startsWith(prefix)) continue;
        const rest = file.webkitRelativePath.slice(prefix.length), name = rest.split('/')[0];
        if (!name || seen.has(name)) continue; seen.add(name);
        entries.push({name,path:value+'/'+name,type:rest.includes('/') ? 'dir' : 'file',size:rest.includes('/') ? 0 : file.size,mtime:Math.floor(file.lastModified/1000)});
      }
    }
    return {path:value,display_path:[this.name,...parts].join('/'),entries,parent:parts.length ? value.slice(0,value.lastIndexOf('/')) : '',kind:'directory'};
  }
  async writeAllowed() {
    if (!this.writable || !this.handle || (this.handle.queryPermission && await this.handle.queryPermission({mode:'readwrite'}) !== 'granted')) throw new Error(webFilesTr('readonly_hint'));
  }
  validateName(value) {
    const name = String(value || '');
    if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f]/.test(name)) throw new Error(webFilesTr('invalid_path'));
    return name;
  }
  receiveName(value,platform=typeof navigator==='undefined'?'':navigator.userAgentData?.platform || navigator.platform || navigator.userAgent) {
    const source=this.validateName(value);
    let name=source.normalize('NFC');
    if(/win/i.test(platform)) {
      name=name.replace(/[<>:"|?*]/g,'_').replace(/[. ]+$/g,'');
      if(/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))name='_'+name;
    }
    while(new TextEncoder().encode(name).length>240)name=Array.from(name).slice(0,-1).join('');
    return name && name!=='.' && name!=='..' ? name : 'download';
  }
  numberedName(name,number) {
    const dot=name.lastIndexOf('.');
    return dot>0 ? name.slice(0,dot)+' ('+number+')'+name.slice(dot) : name+' ('+number+')';
  }
  async mutate(action,data) {
    await this.writeAllowed();
    if (action === 'create') {
      const directory = await this.directory(data.directory), name = this.validateName(data.name);
      try { await directory.getFileHandle(name); throw new Error(webFilesTr('exists')); } catch (error) {if (error.name !== 'NotFoundError') throw error;}
      try { await directory.getDirectoryHandle(name); throw new Error(webFilesTr('exists')); } catch (error) {if (error.name !== 'NotFoundError') throw error;}
      if (data.type === 'dir') await directory.getDirectoryHandle(name,{create:true});
      else {const file = await directory.getFileHandle(name,{create:true}); const writer = await file.createWritable(); await writer.close();}
      return;
    }
    if (action === 'delete') {
      for (const value of data.paths) {
        const parts = this.parts(value), name = parts.pop();
        if (!name) throw new Error(webFilesTr('invalid_path'));
        await (await this.directory('/browser'+(parts.length ? '/'+parts.join('/') : ''))).removeEntry(name,{recursive:true});
      }
      return;
    }
    if (action === 'rename') {
      const file = await this.file(data.path), parts = this.parts(data.path), oldName = parts.pop();
      const directoryPath = '/browser'+(parts.length ? '/'+parts.join('/') : '');
      const newName = this.validateName(data.new_name);
      await this.mutate('create',{directory:directoryPath,name:newName,type:'file'});
      const directory = await this.directory(directoryPath);
      try {
        const writer = await (await directory.getFileHandle(newName)).createWritable();
        try {await writer.write(file); await writer.close();} catch (error) {await writer.abort().catch(()=>{}); throw error;}
      } catch (error) {await directory.removeEntry(newName).catch(()=>{}); throw error;}
      await directory.removeEntry(oldName);
    }
  }
  async write(value,content) {
    await this.writeAllowed();
    const parts = this.parts(value), name = parts.pop();
    if (!name) throw new Error(webFilesTr('invalid_path'));
    const directory = await this.directory('/browser'+(parts.length ? '/'+parts.join('/') : ''));
    const writer = await (await directory.getFileHandle(name)).createWritable();
    try {await writer.write(content); await writer.close();} catch (error) {await writer.abort().catch(()=>{}); throw error;}
  }
  async collect(entries) {
    const result = [], roots = entries || [];
    result.directories = [];
    let count = 0;
    const walk = async (entry,relative) => {
      if (++count > 1000) throw new Error(webFilesTr('transfer_limit'));
      if (entry.type === 'dir') {result.directories.push(relative);for (const child of (await this.list(entry.path)).entries) await walk(child,relative+'/'+child.name);}
      else result.push({file:await this.file(entry.path),relativePath:relative});
    };
    for (const entry of roots) await walk(entry,entry.name);
    return result;
  }
}

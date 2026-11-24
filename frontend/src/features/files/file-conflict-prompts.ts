export interface FileCollision {name?:string;filename?:string;type?:string;existing_type?:string}
interface ConflictPromptPort {
  text(key:string,values?:Record<string,unknown>):string;
  choose(title:()=>string,message:()=>string,actions:Array<{label:()=>string;value:string;className?:string}>):Promise<string>;
}

/** Keeps conflict policy and live text together; never performs a file mutation. */
export function createFileConflictPrompts(port:ConflictPromptPort) {
  const text=(key:string,values?:Record<string,unknown>)=>()=>port.text(key,values);
  function receive(input:FileCollision[],source:'native'|'web') {
    if(!input.length)return Promise.resolve('rename');
    const items=input.map(item=>({...item}));
    const native=source==='native',filesOnly=items.every(item=>item.type==='file'&&item.existing_type==='file');
    return port.choose(text('navigation:transfer.local_conflict_title'),()=>{
      if(native)return items.slice(0,6).map(item=>item.name||'').join(port.text('navigation:transfer.item_separator'))+(items.length>6?port.text('navigation:transfer.more_items',{count:items.length}):'');
      return port.text('sftp:web_files.receive_conflicts',{count:items.length})+'\n'+items.slice(0,6).map(item=>item.name||'').join('\n')+(filesOnly?'':'\n'+port.text('sftp:web_files.folder_conflict_hint'));
    },[
      ...(native||filesOnly?[{label:text('common:auto.overwrite'),value:'overwrite',className:'danger'}]:[]),
      {label:text('common:auto.auto_rename'),value:'rename',className:'primary'},
      {label:text('common:actions.cancel'),value:'cancel'}
    ]);
  }
  function upload(input:FileCollision[]) {
    if(!input.length)return Promise.resolve('error');
    const items=input.map(item=>({...item}));
    return port.choose(text('sftp:transfer.same_name_title'),()=>{
      const names=items.slice(0,6).map(item=>item.name||item.filename||port.text('sftp:transfer.unnamed_item')).join('\n');
      return names+(items.length>6?'\n'+port.text('sftp:transfer.same_name_extra',{count:items.length}):'')+'\n\n'+port.text('sftp:transfer.choose_upload_behavior');
    },[
      {label:text('sftp:transfer.overwrite_same_name'),value:'overwrite',className:'danger'},
      {label:text('sftp:transfer.auto_rename'),value:'rename'},
      {label:text('sftp:transfer.cancel_upload'),value:''}
    ]);
  }
  return {receive,upload};
}

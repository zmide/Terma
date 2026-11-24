import type { EditorOptions, EditorResult, EditorSaved, EditorSave } from './editor-runtime-types';
import type { EditorVersion } from './editor-document';
import type { OpenProgress } from './file-open-service';
import type { PreviewOptions, PreviewEditorOptions } from './image-preview';
import type { GeneratedFileTask, GeneratedFileOptions } from './generated-file-service';
import type { createSvgExportService } from './svg-export';
interface TextRead {
  content:string;size:number;limit:number;encoding:string;preferred_encoding:string;line_ending?:string;final_newline?:boolean;
  bom?:boolean;line_count?:number;editor_kind?:string;needs_format_repair?:boolean;initial_modified?:boolean;progress?:OpenProgress;is_cancelled?:()=>boolean;
}
interface PreviewServicePort {
  tr(key:string,values?:Record<string,unknown>):string;bytes(size:number):string;
  notify(message:string,level:string,options?:{action:{generated_task_id:string;can_open_file:boolean;can_open_directory:boolean;can_delete_file:boolean}}):void;
  connection(id:number):{name?:string;sftp_text_encoding?:string}|null;
  readText(id:number,path:string,encoding:string):Promise<TextRead|null>;
  image(id:number,path:string):Promise<Blob|null>;
  previewImage(id:number,path:string,options:PreviewOptions):Promise<void>;
  openKey(id:number,path:string):string;activate(key:string):boolean;
  editor(title:string,content:string,size:number,limit:number,encoding:string,preferred:string,options:EditorOptions):Promise<EditorResult>;
  write(id:number,path:string,payload:EditorSave):Promise<EditorSaved>;
  versions(id:number,path:string):Promise<{versions?:EditorVersion[]}>;
  refresh(id:number):void;
  encodingLabel(value:string):string;lineEndingLabel(value:string):string;
  svg:ReturnType<typeof createSvgExportService>;
  generated(blob:Blob,name:string,options:GeneratedFileOptions):Promise<GeneratedFileTask>;
  download(id:number,path:string):unknown;
}
export function triggerGeneratedDownload(blob:Blob,filename:string){
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download=filename;document.body.append(link);
  try{link.click();}finally{setTimeout(()=>{URL.revokeObjectURL(url);link.remove();},1000);}
}
export function createFilePreviewService(port:PreviewServicePort){
  const {tr}=port;
  async function text(id:number,path:string,options:PreviewEditorOptions={}){
    const editorKey=port.openKey(id,path);if(!options.forceNewEditor&&editorKey&&port.activate(editorKey))return;
    let opening:OpenProgress|undefined;
    try{
      const connection=port.connection(id);let encoding=options.initialEncoding||'';
      let pending:TextRead|null=Object.hasOwn(options,'initialContent')?{content:String(options.initialContent||''),size:Number(options.initialSize||String(options.initialContent||'').length),limit:Number(options.initialLimit||50*1024*1024),encoding:encoding||'utf8',preferred_encoding:options.initialPreferredEncoding||'auto',line_ending:options.initialLineEnding,final_newline:options.initialFinalNewline,needs_format_repair:options.initialNeedsFormatRepair===true,initial_modified:options.initialModified===true}:null;
      while(true){
        const data=pending||await port.readText(id,path,encoding);pending=null;if(!data)return;
        opening=data.progress;
        await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
        if(data.is_cancelled?.())return;
        const opened=port.editor(path,data.content||'',data.size||0,data.limit||50*1024*1024,data.encoding||'utf8',data.preferred_encoding||'auto',{
          editorKey,editorKind:data.editor_kind||'ace',lineCount:data.line_count,lineEnding:data.line_ending,finalNewline:data.final_newline,bom:data.bom,
          needsFormatRepair:data.needs_format_repair===true,initialModified:data.initial_modified===true,forceNewEditor:options.forceNewEditor===true,
          svgMode:/\.svg$/i.test(path)?options.svgMode||'edit':'',serverName:connection?.name||String(id),sourceLabel:`${connection?.name||id} · ${path}`,
          onSave:next=>port.write(id,path,next),
          onSaved:(saved,next)=>{
            const savedEncoding=saved.encoding||next.encoding;
            if(connection&&next.persist_default)connection.sftp_text_encoding=savedEncoding;
            port.refresh(id);
            const lineEnding=saved.line_ending||next.line_ending;
            port.notify(tr((saved.normalized_script||next.normalized_script)&&lineEnding==='lf'?'sftp:editor.saved_shell_script':'sftp:editor.saved_with_encoding_and_line_ending',{encoding:port.encodingLabel(savedEncoding),lineEnding:port.lineEndingLabel(lineEnding)}),'success');
          },
          loadVersions:()=>port.versions(id,path).catch(()=>({versions:[]})),
          onReady:()=>data.progress?.complete(),
          loadVersion:async(version,versionEncoding)=>{
            if(typeof version.path!=='string')return null;
            const loaded=await port.readText(id,version.path,versionEncoding);
            loaded?.progress?.complete();return loaded;
          }
        });
        data.content='';
        const next=await opened;
        opening?.complete();opening=undefined;
        if(!next)return;
        if(next.action==='encoding'){encoding=next.encoding;continue;}
        if(next.action==='preview'&&/\.svg$/i.test(path))await port.previewImage(id,path,{content:next.content,limit:next.limit,encoding:next.encoding,preferredEncoding:next.preferredEncoding,lineEnding:next.lineEnding,finalNewline:next.finalNewline,needsFormatRepair:next.needsFormatRepair,modified:next.modified,preserveUnsaved:true});
        return;
      }
    }catch(error){
      opening?.complete();opening=undefined;
      port.notify(error instanceof Error?error.message:tr('sftp:editor.remote_read_failed'),'error');
    }
    finally{opening?.complete();}
  }
  async function exportSvg(kind:'pdf'|'svg',id:number,path:string,source:Blob|null,options:{colorMode?:string}={}){
    const colorMode=port.svg.sftpSvgColorMode(options);
    if(kind==='svg'&&colorMode==='original')return port.download(id,path);
    try{
      const blob=source||await port.image(id,path);if(!blob)return false;
      port.notify(tr(kind==='pdf'?'sftp:editor.exporting_pdf':'sftp:editor.exporting_svg'),'info');
      const output=kind==='pdf'?await port.svg.createSftpSvgPdfBlob(blob,{colorMode}):await port.svg.createSftpSvgDownloadBlob(blob,{colorMode});
      const name=(path.split(/[\\/]/).pop()||'svg').replace(/\.svg$/i,'')+port.svg.sftpSvgColorModeSuffix(colorMode)+'.'+kind;
      const task=await port.generated(output,name,{label:tr(kind==='pdf'?'sftp:editor.generated_task':'sftp:editor.generated_svg_task',{name}),connectionId:id,connectionName:port.connection(id)?.name||'',sourcePath:path,inverted:colorMode!=='original',colorMode});
      const saved=task.delivery_status==='saved'&&task.saved_path;
      port.notify(tr(kind==='pdf'?(saved?'sftp:editor.pdf_exported_to_tasks':'sftp:editor.pdf_exported'):(saved?'sftp:editor.svg_exported_to_tasks':'sftp:editor.svg_exported'))+(saved?'\n'+tr('tasks:notifications.saved_to',{path:task.saved_path}):''),'success',saved?{action:{generated_task_id:task.id,can_open_file:true,can_open_directory:true,can_delete_file:true}}:undefined);
      return task;
    }catch(error){port.notify(error instanceof Error?error.message:tr(kind==='pdf'?'sftp:editor.pdf_export_failed':'sftp:editor.svg_export_failed'),'error');return false;}
  }
  return {text,pdf:(id:number,path:string,source:Blob|null=null,options:{colorMode?:string}={})=>exportSvg('pdf',id,path,source,options),svg:(id:number,path:string,source:Blob,colorMode:string)=>exportSvg('svg',id,path,source,{colorMode})};
}

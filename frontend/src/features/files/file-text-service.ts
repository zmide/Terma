import type {FileTextOptions} from './sftp/sftp-dialog-types';
export interface FileTextContext {
  name:string;path:string;writable:boolean;
  valid():boolean;read():Promise<string>;write(content:string):Promise<void>;refresh():Promise<void>;
}
export interface FileTextPort {
  context(key:string,path:string):FileTextContext|null;
  show(options:FileTextOptions):void;
  text(key:string):string;
  error(error:unknown):string;
  notify(message:string):void;
}
export function createFileTextService(port:FileTextPort){
  let revision=0;
  class TextLimitError extends Error {}
  const errorText=(error:unknown)=>error instanceof TextLimitError?port.text('sftp:web_files.text_limit'):port.error(error);
  const validate=(content:unknown):content is string=>typeof content==='string'&&!content.includes('\0')&&new TextEncoder().encode(content).byteLength<=1024*1024;
  async function open(key:string,path:string){
    const context=port.context(key,path);if(!context||!context.valid())return false;
    const token=++revision,current=()=>revision===token&&context.valid();
    try{
      const content=await context.read();if(!current())return false;
      if(!validate(content))throw new TextLimitError();
      let saving=false;
      port.show({tr:name=>port.text(name),name:context.name,path:context.path,content,writable:context.writable,valid:current,
        dispose:()=>{if(revision===token)revision++;},errorText,
        async save(next){
          if(saving||!current()||!context.writable)return;
          if(!validate(next))throw new TextLimitError();
          saving=true;
          try{await context.write(next);if(current())await context.refresh();}finally{saving=false;}
        }
      });
      return true;
    }catch(error){if(current())port.notify(errorText(error)||port.text('sftp:web_files.text_limit'));return false;}
  }
  return {open};
}

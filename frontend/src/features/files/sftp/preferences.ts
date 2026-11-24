export const filenameEncodingOptions=[['utf8','UTF-8'],['gb18030','GB18030'],['gbk','GBK'],['big5','Big5'],['shift_jis','Shift_JIS'],['euc-kr','EUC-KR'],['latin1','ISO-8859-1']] as const;
export interface SftpFavorite {connectionId:number;path:string;name:string}
interface Connection {id:number;sftp_filename_encoding?:string}
interface Directory {id:number;path:string;valid():boolean}
interface PreferencesPort {
 storage:Pick<Storage,'getItem'|'setItem'>;
 directory(key:string):Directory|null;connection(id:number):Connection|undefined;keys(id:number):string[];
 encoding(id:number,value:string):Promise<Partial<Connection>>;reloadDirectory(key:string,id:number):Promise<unknown>;
 changed(key:string):void;prompt(title:string,label:string,value:string):Promise<string|null|undefined>;
 text(key:string,values?:Record<string,unknown>):string;notify(message:string):void;
}
const validText=(value:unknown,max:number):value is string=>typeof value==='string'&&value.length>0&&value.length<=max&&!value.includes('\0');
function favoritesFrom(value:unknown):SftpFavorite[]{
 if(!Array.isArray(value))return [];
 const seen=new Set<string>();return value.slice(0,80).flatMap(item=>{if(!item||!Number.isSafeInteger(Number(item.connectionId))||!Number(item.connectionId)||!validText(item.path,16384)||!validText(item.name,4000))return [];const key=Number(item.connectionId)+'\0'+item.path;if(seen.has(key))return [];seen.add(key);return [{connectionId:Number(item.connectionId),path:item.path,name:item.name}];});
}
export function createSftpPreferences(port:PreferencesPort){
 let favorites:SftpFavorite[]=[];const pendingFavorites=new Set<string>(),pendingEncodings=new Set<number>();
 function reload(){try{favorites=favoritesFrom(JSON.parse(port.storage.getItem('sftpFavorites')||'[]'));}catch{favorites=[];}return snapshot();}
 function snapshot(id?:number){return favorites.filter(item=>id===undefined||item.connectionId===Number(id)).map(item=>({...item}));}
 const has=(id:number,path:string)=>favorites.some(item=>item.connectionId===Number(id)&&item.path===path);
 function save(){port.storage.setItem('sftpFavorites',JSON.stringify(favorites.slice(0,80)));}
 async function toggle(key:string){
  const directory=port.directory(key);if(!directory||!directory.valid())return false;
  const identity=directory.id+'\0'+directory.path;if(pendingFavorites.has(identity))return false;pendingFavorites.add(identity);
  try{
   if(has(directory.id,directory.path)){favorites=favorites.filter(item=>item.connectionId!==directory.id||item.path!==directory.path);save();port.notify(port.text('common:notifications.sftp_favorite_cancelled'));}
   else{const name=await port.prompt('sftp:auto.favorite_dialog_title','sftp:auto.favorite_name',directory.path.split('/').filter(Boolean).pop()||directory.path);if(!directory.valid()||!validText(name,4000))return false;if(!has(directory.id,directory.path))favorites.unshift({connectionId:directory.id,path:directory.path,name});favorites=favorites.slice(0,80);save();port.notify(port.text('common:notifications.sftp_favorite_added'));}
   for(const tab of port.keys(directory.id))port.changed(tab);return true;
  }finally{pendingFavorites.delete(identity);}
 }
 const label=(connection?:Connection)=>filenameEncodingOptions.find(([value])=>value===(connection?.sftp_filename_encoding||'utf8'))?.[1]||'UTF-8';
 async function encoding(id:number,value:string){
  const connection=port.connection(id),option=filenameEncodingOptions.find(([key])=>key===value);
  if(!connection||!option||pendingEncodings.has(id))return false;
  pendingEncodings.add(id);
  try{const result=await port.encoding(id,value);if(port.connection(id)!==connection)return false;Object.assign(connection,result);const keys=port.keys(id);for(const key of keys)port.changed(key);port.notify(port.text('common:notifications.exact.sftp_filename_encoding_switched',{encoding:option[1]}));await Promise.all(keys.map(key=>port.reloadDirectory(key,id)));return true;}
  finally{pendingEncodings.delete(id);}
 }
 reload();
 return {reload,snapshot,has,toggle,encoding,label,options:filenameEncodingOptions,mobileExpanded:()=>port.storage.getItem('sftpMobileToolbarExpanded')==='1',toggleMobile(key:string){port.storage.setItem('sftpMobileToolbarExpanded',port.storage.getItem('sftpMobileToolbarExpanded')==='1'?'0':'1');port.changed(key);}};
}


export interface InstalledFeaturesFilesSftpPreferencesServices {
  termaSftpPreferences: ReturnType<typeof createSftpPreferences>
}

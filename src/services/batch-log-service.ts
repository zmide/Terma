import {StringDecoder} from 'node:string_decoder';
import {renderTerminalTranscript} from '../log-reader';
interface Source {id:number;name:string;ssh_user:string;ssh_host:string;ssh_port:number}
type Stream='stdout'|'stderr';
const clean=(value:unknown)=>String(value??'').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ').trim();
/** Bound each physical log line to its source before workers enter the shared write queue. */
export function createBatchLogStream(source:Source,append:(text:string)=>void){
  const owner=`${source.id}:${clean(source.name)} (${clean(source.ssh_user)}@${clean(source.ssh_host)}:${source.ssh_port})`;
  const streams={stdout:{decoder:new StringDecoder('utf8'),pending:''},stderr:{decoder:new StringDecoder('utf8'),pending:''}};let ended=false;
  function flush(kind:Stream,final=false){const state=streams[kind];let match:RegExpExecArray|null;
    const emit=(line:string)=>append(`[${owner}][${kind}] ${renderTerminalTranscript(line).replace(/\n/g,'\n['+owner+']['+kind+'] ')}\n`);
    while((match=/\r\n|\n|\r(?=.)/.exec(state.pending))){emit(state.pending.slice(0,match.index));state.pending=state.pending.slice(match.index+match[0].length);}
    // A command without line breaks cannot grow the per-source buffer without bound.
    while(state.pending.length>65536){let end=65536;if(/[\uD800-\uDBFF]/.test(state.pending[end-1]))end--;emit(state.pending.slice(0,end));state.pending=state.pending.slice(end);}
    if(final&&state.pending){emit(state.pending.replace(/\r$/,''));state.pending='';}
  }
  return {start(){append(`\n[${owner}][start]\n`);},data(kind:Stream,chunk:Buffer){if(ended)return '';const text=streams[kind].decoder.write(chunk);streams[kind].pending+=text;flush(kind);return text;},finish(status:string){if(ended)return [] as {stream:Stream;data:string}[];ended=true;const tail:{stream:Stream;data:string}[]=[];for(const kind of ['stdout','stderr'] as const){const text=streams[kind].decoder.end();if(text)tail.push({stream:kind,data:text});streams[kind].pending+=text;flush(kind,true);}append(`[${owner}][end] ${clean(status)}\n`);return tail;}};
}

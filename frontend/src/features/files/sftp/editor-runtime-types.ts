import type { Ace } from 'ace-builds';
import type { EditorVersion } from './editor-document';
import type { SftpEditorModel } from './SftpEditorShell';
export interface AceRuntime {
  edit(host:HTMLElement):Ace.Editor;
  config:{set(key:string,value:string|boolean):void};
  require(name:'ace/range'):{Range:new (a:number,b:number,c:number,d:number)=>Ace.Range};
}
export interface EditorSave { action:'save';content:string;changed:boolean;backup:boolean;encoding:string;line_ending:string;normalized_script:boolean;persist_default:boolean }
export interface EditorSaved {encoding?:string;line_ending?:string;normalized_script?:boolean}
export interface EditorPreview { action:'preview';content:string;size:number;limit:number;encoding:string;preferredEncoding:string;lineEnding:string;finalNewline:boolean;needsFormatRepair:boolean;modified:boolean }
export type EditorResult=EditorSave|EditorPreview|{action:'encoding';encoding:string}|null;
export interface EditorOptions {
  editorKey?:string;forceNewEditor?:boolean;serverName?:string;sourceLabel?:string;needsFormatRepair?:boolean;bom?:boolean;
  finalNewline?:boolean;lineEnding?:string;versions?:EditorVersion[];lineCount?:number;svgMode?:string;editorKind?:string;initialModified?:boolean;
  loadVersions?:()=>Promise<{versions?:EditorVersion[]}>;loadVersion?:(version:EditorVersion,encoding:string)=>Promise<{content?:string}|null>;
  onSave?:(value:EditorSave)=>Promise<EditorSaved>;onSaved?:(saved:EditorSaved,next:EditorSave)=>Promise<void>|void;onReady?:()=>void;
}
export interface EditorViewInput {fileName:string;sourceLabel:string;fileLimit:string;encoding:string;initialLineEnding:string;detectedLanguage:string;wrapEnabled:boolean;preferredEncoding:string;versions:EditorVersion[];historyLoading:boolean;isSvgDocument?:boolean;initialSvgMode?:string}
export interface EditorRuntimePort {
  tr(key:string,values?:Record<string,unknown>):string;
  bytes(size:number):string;
  icon(name:string):string;
  refreshIcons():void;
  escape(value:unknown):string;
  notify(message:string,level?:string):void;
  confirm(message:string|(()=>string),title:string|(()=>string),ok:string|(()=>string),cancel:string|(()=>string),danger:boolean):Promise<boolean>;
  ace():AceRuntime|null;
  localizeAce():void;
  mount(modal:HTMLElement,model:SftpEditorModel,refresh:()=>SftpEditorModel):void;
  release(modal:HTMLElement):void;
  diffLines: Parameters<typeof import('./editor-document').editorDiff>[3]['diffLines'];
}
type EditorInputs='#sftpEditorReplaceInput'|'#sftpEditorSearchInput'|'#sftpEditorWordWrap'|'#sftpBackupBeforeSave'|'#sftpPersistEncoding';
type EditorSelects='#sftpTextEncoding'|'#sftpLineEnding'|'#sftpEditorLanguage'|'#sftpDiffHistory';
type EditorButtons='#sftpEditorReplaceToggle'|'#sftpEditorReplaceOne'|'#sftpEditorReplaceAll'|'#sftpTextSave'|'#sftpTextDiff'|'#sftpEditorMinimize'|'#sftpEditorFullscreen'|'#sftpTextFormatJson'|'#sftpTextClose'|'#sftpEditorCloseTop'|'#sftpEditorSearchToggle'|'#sftpEditorSearchPrevious'|'#sftpEditorSearchNext'|'#sftpEditorSearchClose';
export type EditorControl<S extends string>=S extends '#sftpSvgEditorMode'?HTMLSelectElement|null:S extends EditorInputs?HTMLInputElement:S extends EditorSelects?HTMLSelectElement:S extends EditorButtons?HTMLButtonElement:HTMLElement;
export type EditorHost=HTMLElement & {__termaAceEditor?:Ace.Editor};

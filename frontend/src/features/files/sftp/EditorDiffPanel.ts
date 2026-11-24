import {h,render} from 'vue';
import {TermaButton} from '@/shared/ui/TermaButton';
import {settingsIcon} from '@/features/settings/settings-icon';
import type {EditorDiff} from './editor-document';
interface Panel { heading:string;closeLabel:string;loading:boolean;error:string;model:EditorDiff|null;close():void }
export function editorDiffView(model:EditorDiff){
  if(model.unavailable)return h('div',{class:'sftp-diff-unavailable'},model.message);
  return h('div',{class:['sftp-side-diff',!model.hasChanges?'no-changes':'']},[
    h('div',{class:'sftp-diff-columns'},[h('strong',null,model.oldLabel),h('strong',null,model.newLabel)]),
    model.hasChanges?model.rows.map((row,index)=>'collapsed'in row?h('div',{class:'sftp-diff-collapsed',key:index},h('span',null,row.collapsed)):
      h('div',{class:['sftp-diff-row',row.changed?'changed':''],key:index},row.cells.map((cell,i)=>h('div',{class:['sftp-diff-cell',cell.kind,cell.kind==='blank'?'empty':''],key:i},[h('span',null,cell.number),h('code',null,cell.text || ' ')])))):
      h('div',{class:'sftp-diff-unavailable'},model.message)
  ]);
}
export function renderEditorDiff(host:HTMLElement|null,panel:Panel|null){
  if(!host)return;
  render(panel?h('div',{class:'terma-vue-root terma-sftp-root'},[
    h('div',{class:'sftp-diff-preview-head'},[h('strong',null,panel.heading),h(TermaButton,{id:'sftpDiffClose',onClick:panel.close},()=>panel.closeLabel)]),
    h('div',{class:'sftp-diff-preview-body'},[panel.loading?h('div',{class:'sftp-diff-unavailable'},[settingsIcon('loader-circle'),panel.heading]):panel.error?h('div',{class:'sftp-diff-unavailable error'},panel.error):panel.model?editorDiffView(panel.model):null])
  ]):null,host);
}

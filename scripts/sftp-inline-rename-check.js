const assert = require('node:assert/strict');
const {loadFrontendService} = require('./frontend-service-test-helper');
let nextTimer=0, timers=new Map(), selected=false, mobile=false, lang='zh', request=null, calls=0, notices=[];
const languageListeners=new Set();
class Node {
  constructor(tag='span'){this.tag=tag;this.isConnected=true;this.children=[];this.style={};this.attributes={};this.listeners=new Map();this.classList={add(){},remove(){}};}
  setAttribute(k,v){this.attributes[k]=v;} removeAttribute(k){delete this.attributes[k];}
  addEventListener(k,f){this.listeners.set(k,f);} appendChild(n){this.children.push(n);n.parent=this;}
  remove(){this.isConnected=false;this.parent.children=this.parent.children.filter(n=>n!==this);}
  focus(){this.focused=true;} setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}
  getBoundingClientRect(){return {left:0,top:0,right:500,width:150};}
  closest(){return row;}
  fire(name,extra={}){return this.listeners.get(name)?.({stopPropagation(){},preventDefault(){},...extra});}
}
const row=new Node('div'), label=new Node();
const {createSftpInlineRenameController,sftpInlineRenameTarget}=loadFrontendService('frontend/src/features/files/sftp/SftpInlineRename.ts',{
 document:{createElement:tag=>new Node(tag)},window:{addEventListener:(_,fn)=>languageListeners.add(fn),removeEventListener:(_,fn)=>languageListeners.delete(fn)},
 setTimeout:fn=>{const id=++nextTimer;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id)
});
const clock=()=>{const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const entry={path:'/folder/a.txt',name:'a.txt',type:'file'};
const controller=createSftpInlineRenameController({mobile:()=>mobile,isSelected:()=>selected,hasSingleSelection:()=>selected,
 rename:async(item,next)=>{calls++;return request?.(item,next);},notify:text=>notices.push(text),invalidName:()=>lang+' invalid',ariaLabel:()=>lang+' name',conflictName:()=>lang+' exists'});
const input=()=>row.children.find(node=>node.tag==='input');
(async()=>{
 controller.click(label,entry);selected=true;clock();assert.equal(input(),undefined,'First click only selects');
 controller.click(label,entry);clock();assert.equal(input().selectionEnd,1,'Second click edits only the filename stem');
 input().value='cancel.txt';input().fire('keydown',{key:'Escape'});assert.equal(input(),undefined);assert.equal(calls,0);
 controller.click(label,entry);controller.click(label,entry);controller.cancel();clock();assert.equal(input(),undefined,'Double-click cancellation cannot later rename');
 selected=false;controller.begin(label,entry);assert.equal(input(),undefined,'Explicit rename requires selection');
 selected=true;mobile=true;controller.begin(label,entry);assert.equal(input(),undefined);mobile=false;
 controller.begin(label,entry);input().value='../invalid';input().fire('keydown',{key:'Enter'});await flush();assert.equal(calls,0);assert.equal(notices.length,1);
 let reject;request=()=>new Promise((_,no)=>reject=no);input().value='existing.txt';input().fire('keydown',{key:'Enter'});input().fire('keydown',{key:'Enter'});input().fire('blur');assert.equal(calls,1,'Busy rename cannot submit twice');
 reject(Object.assign(new Error('backend text'),{publicCode:'sftp_rename_exists'}));await flush();
 assert.equal(input().value,'existing.txt');assert.equal(input().attributes['aria-invalid'],'true');assert.equal(row.children[1].textContent,'zh exists');
 lang='en';languageListeners.forEach(fn=>fn());assert.equal(row.children[1].textContent,'en exists');assert.equal(input().attributes['aria-label'],'en name');
 request=async(item,next)=>{assert.equal(sftpInlineRenameTarget(item,next),'/folder/new.txt');};input().value='new.txt';input().fire('keydown',{key:'Enter'});await flush();assert.equal(input(),undefined);assert.equal(languageListeners.size,0);
 controller.begin(label,{path:'/folder/dir',name:'folder',type:'dir'});assert.equal(input().selectionEnd,6);input().fire('blur');await flush();assert.equal(input(),undefined,'Unchanged blur cancels');
 controller.begin(label,entry);controller.dispose();assert.equal(input(),undefined);assert.equal(languageListeners.size,0);clock();assert.equal(input(),undefined);
 assert.equal(sftpInlineRenameTarget({path:'file',name:'file',type:'file'},'next'),'./next');
 console.log('SFTP rename lifecycle passed: selection/click/double-click, validation, conflicts, language, busy and disposal');
})().catch(error=>{console.error(error);process.exitCode=1;});

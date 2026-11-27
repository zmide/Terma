"use strict";
const assert = require("node:assert/strict");
const {EventEmitter} = require("node:events");
const crypto = require("node:crypto");
const net = require("node:net");
const {createLocalTerminals,size} = require("../desktop/local-terminal");
const {shellProfile,startLocalProcess,detectedShellProfiles} = require("../desktop/local-terminal-process");
const {loadFrontendService} = require("./frontend-service-test-helper");
const {terminalDirectoryFromPrompt,createTerminalDirectoryService} =
  loadFrontendService("frontend/src/features/terminal/terminal-directory-service.ts");

async function main() {
  const handles=new Map(), calls=[], events=[];
  const sender=new EventEmitter();sender.isDestroyed=()=>false;sender.send=(channel,value)=>events.push({channel,...value});
  const other=new EventEmitter();other.isDestroyed=()=>false;
  const trusted={sender}, otherTrusted={sender:other}, denied={sender:other};
  const ipcMain={handle:(key,callback)=>handles.set(key,callback)};
  const service=createLocalTerminals({ipcMain,allowed:event=>event===trusted||event===otherTrusted,
    launch:(profile,dimensions,emit)=>{
      const entry={profile,dimensions,emit,closed:0,writes:[],resizes:[]};calls.push(entry);
      return {pty:true,write:value=>entry.writes.push(value),resize:(...value)=>entry.resizes.push(value),close:()=>entry.closed++};
    }});
  const invoke=(action,event,value)=>handles.get("terma:local-terminal-"+action)(event,value);
  const options=()=>({id:crypto.randomUUID(),profile:process.platform==="win32"?"powershell":"shell",elevated:false,cols:90,rows:20});
  assert.throws(()=>invoke("start",denied,options()),/SOURCE_DENIED/);
  assert.throws(()=>invoke("profiles",denied),/SOURCE_DENIED/);
  const detected=invoke("profiles",trusted);
  assert.ok(detected.every(item=>Object.keys(item).sort().join(",")==="id,label"),"profiles never expose executable paths or arguments");
  assert.ok(detectedShellProfiles().every(item=>require("node:fs").existsSync(item.file)));
  for(const profile of ["cmd & calc","../../bin/sh","bash -c id"])
    assert.throws(()=>invoke("start",trusted,{...options(),profile}),/INVALID_SHELL/);
  assert.throws(()=>invoke("start",trusted,{...options(),id:"bad"}),/INVALID/);
  assert.throws(()=>invoke("start",trusted,{...options(),elevated:"true"}),/INVALID/);
  const first=options();invoke("start",trusted,first);
  assert.equal(service.count(),1);assert.equal(events[0].type,"ready");
  assert.throws(()=>invoke("write",denied,{id:first.id,data:"whoami\r"}),/SOURCE_DENIED/);
  assert.throws(()=>invoke("write",otherTrusted,{id:first.id,data:"whoami\r"}),/NOT_FOUND/);
  assert.throws(()=>invoke("resize",otherTrusted,{id:first.id,cols:80,rows:24}),/NOT_FOUND/);
  assert.throws(()=>invoke("close",otherTrusted,{id:first.id}),/NOT_FOUND/);
  assert.throws(()=>invoke("write",trusted,{id:crypto.randomUUID(),data:"id\r"}),/NOT_FOUND/);
  assert.throws(()=>invoke("write",trusted,{id:first.id,data:"x".repeat(65537)}),/INVALID/);
  invoke("write",trusted,{id:first.id,data:"whoami\r"});assert.deepEqual(calls[0].writes,["whoami\r"]);
  invoke("resize",trusted,{id:first.id,cols:Infinity,rows:-500});assert.deepEqual(calls[0].resizes,[[500,1]]);
  const text="界".repeat(150000);calls[0].emit({type:"data",data:text});
  assert.equal(events.filter(e=>e.type==="data").map(e=>e.data).join(""),text,"large output is split without loss");
  calls[0].emit({type:"exit",code:0});assert.equal(service.count(),0);assert.equal(calls[0].closed,1);
  for(let i=0;i<15;i++){
    const restarted=options();invoke("start",trusted,restarted);invoke("close",trusted,{id:restarted.id});
  }
  assert.equal(sender.listenerCount("destroyed"),1,"restarting cannot accumulate cleanup listeners");
  assert.equal(sender.listenerCount("did-start-navigation"),1);
  const owned=options();invoke("start",trusted,owned);
  sender.emit("did-start-navigation",{},"http://untrusted.invalid",false,false);
  sender.emit("did-start-navigation",{},"http://trusted.invalid#pane",true,true);
  assert.equal(service.count(),1,"subframes and in-page navigation retain the shell");
  sender.emit("did-start-navigation",{},"http://untrusted.invalid",false,true);
  assert.equal(service.count(),0,"navigation closes local processes");
  for(let i=0;i<12;i++)invoke("start",trusted,options());
  assert.throws(()=>invoke("start",trusted,options()),/INVALID/);
  sender.emit("destroyed");assert.equal(service.count(),0);
  if(process.platform==="win32"){
    let helperSocket,helperBuffer="",helperMessages=[],launcher;
    const elevatedService=createLocalTerminals({ipcMain:{handle:(key,callback)=>handles.set(key,callback)},allowed:event=>event===trusted,
      spawnProcess:(file,args,settings)=>{
        assert.match(file,/powershell\.exe$/i);assert.equal(settings.windowsHide,true);
        const script=Buffer.from(args.at(-1),"base64").toString("utf16le");
        assert.match(script,/-Verb RunAs -WindowStyle Hidden/);
        const argumentList=script.match(/-ArgumentList '((?:[^']|'')*)' -Verb/)[1].replace(/''/g,"'");
        const [,pipe,token,profile]=[...argumentList.matchAll(/"([^"]*)"/g)].map(match=>match[1]);
        assert.equal(profile,"cmd");
        launcher=new EventEmitter();
        helperSocket=net.connect(pipe);helperSocket.setEncoding("utf8");
        helperSocket.on("error",()=>{});
        helperSocket.on("connect",()=>helperSocket.write(JSON.stringify({type:"auth",token})+"\n"+JSON.stringify({type:"ready",pty:true})+"\n"));
        helperSocket.on("data",data=>{
          helperBuffer+=data;let end;
          while((end=helperBuffer.indexOf("\n"))>=0){const value=JSON.parse(helperBuffer.slice(0,end));helperBuffer=helperBuffer.slice(end+1);helperMessages.push(value);}
        });
        return launcher;
      }});
    const elevated={...options(),profile:"cmd",elevated:true},before=events.length;
    invoke("start",trusted,elevated);
    const deadline=Date.now()+3000;
    while(events.length===before&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(events.at(-1).type,"ready","authenticated helper becomes ready");
    invoke("write",trusted,{id:elevated.id,data:"echo test\r"});
    await new Promise(resolve=>setTimeout(resolve,30));
    assert.deepEqual(helperMessages[0],{type:"resize",cols:elevated.cols,rows:elevated.rows},
      "an elevated shell receives the actual panel dimensions before input");
    assert.deepEqual(helperMessages.at(-1),{type:"write",data:"echo test\r"});
    launcher.emit("exit",1);assert.equal(elevatedService.count(),0,"denied UAC releases pending terminal");
    helperSocket.destroy();elevatedService.dispose();
    let launches=0;
    const pendingService=createLocalTerminals({ipcMain:{handle:(key,callback)=>handles.set(key,callback)},allowed:event=>event===trusted,
      spawnProcess:()=>{launches++;return new EventEmitter();}});
    const cancelled={...options(),profile:"cmd",elevated:true};
    invoke("start",trusted,cancelled);invoke("close",trusted,{id:cancelled.id});
    await new Promise(resolve=>setTimeout(resolve,40));
    assert.equal(launches,0,"closing before pipe listen cannot launch UAC afterwards");
    pendingService.dispose();
  }
  service.dispose();
  assert.deepEqual(size({cols:-1,rows:9999}),{cols:2,rows:300});
  assert.equal(shellProfile("cmd","win32",{SystemRoot:"C:\\Windows"}).args[0],"/Q");
  assert.equal(shellProfile("shell","linux",{SHELL:"/bin/bash"}).file,"/bin/bash");
  assert.equal(shellProfile("shell","linux",{SHELL:"relative"}).file,"/bin/sh");

  // A missing native PTY must still provide a usable local shell, without private service environment.
  const streams=()=>Object.assign(new EventEmitter(),{setEncoding(){}});
  const fake=Object.assign(new EventEmitter(),{stdout:streams(),stderr:streams(),stdin:{write:value=>calls.push(value)},kill(){}});
  const fallback=startLocalProcess(process.platform==="win32"?"cmd":"shell",{cols:80,rows:24},()=>{},
    {loadPty:()=>null,spawn:(file,args,settings)=>{
      assert.ok(file);assert.ok(args.length);assert.equal(settings.windowsHide,true);
      assert.equal(Object.keys(settings.env).some(key=>/^(TERMA_|ELECTRON_)/.test(key)),false);return fake;
    }});
  assert.equal(fallback.pty,false);fallback.write("echo ok\r");assert.equal(calls.at(-1),"echo ok\n");

  assert.equal(terminalDirectoryFromPrompt("root@AstrBot:~/Napcat# "),"~/Napcat");
  assert.equal(terminalDirectoryFromPrompt("root@host:/tmp/my folder# "),"/tmp/my folder");
  for(const line of ["root@host:~# cd /tmp","random output /tmp","root@host:…/hidden#","root@host:~# cat file"])
    assert.equal(terminalDirectoryFromPrompt(line),"");
  let parsed,line="root@host:~# ", resolveHome;
  const session={id:1,key:"test",connected:true,socket:{},connectionAttempt:1,
    term:{onWriteParsed:callback=>(parsed=callback,{dispose(){}}),buffer:{active:{type:"normal",baseY:0,cursorY:0,getLine:()=>({translateToString:()=>line})}}}};
  const directory=createTerminalDirectoryService({current:()=>true,resolve:async(_id,path)=>path==="."?new Promise(resolve=>resolveHome=resolve):{path},
    remember(){},startup:()=>({}),clean:text=>text,text:key=>key});
  directory.register(session);parsed();
  line="root@host:/tmp# ";parsed();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(directory.confirmed(session),"/tmp");
  resolveHome({path:"/root"});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(directory.confirmed(session),"/tmp","slow home resolution cannot restore an older prompt");
  session.homeDirectory="/root";line="root@host:~/Napcat# ";parsed();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(directory.confirmed(session),"/root/Napcat");
  line="root@host:~/Napcat# cd /missing";parsed();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(directory.confirmed(session),"/root/Napcat","typing cannot advance SFTP");
  line="root@host:~/Napcat# ";parsed();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(directory.confirmed(session),"/root/Napcat","failed cd keeps current prompt");
  session.term.buffer.active.type="alternate";line="root@host:/etc# ";parsed();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(directory.confirmed(session),"/root/Napcat","editor content is not shell evidence");
  let startupProbes=0;
  const delayedDirectory=createTerminalDirectoryService({current:()=>true,resolve:async()=>{startupProbes++;return {path:"/old-startup"};},
    remember(){},startup:()=>({terminal_working_directory:"/old-startup"}),clean:text=>text,text:key=>key});
  const delayedSession={id:2,key:"delayed",connected:true,socket:{},connectionAttempt:1};
  delayedDirectory.schedule(delayedSession,{id:2},"delayed",20);
  delayedDirectory.set(delayedSession,"/confirmed-shell","prompt");
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(startupProbes,0,"a delayed startup probe must not overwrite a newly confirmed shell directory");
  assert.equal(delayedDirectory.confirmed(delayedSession),"/confirmed-shell");
  let pendingParsed, finishPrompt, pendingStartupProbes=0;
  const pendingSession={id:3,key:"pending",connected:true,socket:{},connectionAttempt:1,
    term:{onWriteParsed:callback=>(pendingParsed=callback,{dispose(){}}),
      buffer:{active:{type:"normal",baseY:0,cursorY:0,getLine:()=>({translateToString:()=>"root@host:/new-directory# "})}}}};
  const pendingDirectory=createTerminalDirectoryService({current:()=>true,resolve:async(_id,path)=>{
    if(path==="/new-directory")return new Promise(resolve=>finishPrompt=resolve);
    pendingStartupProbes++;return {path:"/old-startup"};
  },remember(){},startup:()=>({terminal_working_directory:"/old-startup"}),clean:text=>text,text:key=>key});
  pendingDirectory.register(pendingSession);pendingDirectory.schedule(pendingSession,{id:3},"pending",20);pendingParsed();
  await new Promise(resolve=>setTimeout(resolve,40));
  assert.equal(pendingStartupProbes,0,"recognizing a prompt cancels startup work while its directory is still resolving");
  finishPrompt({path:"/new-directory"});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(pendingDirectory.confirmed(pendingSession),"/new-directory");
  console.log("Local terminal IPC, ownership, fixed profiles, lifecycle, output, fallback and prompt-directory checks passed.");
}
main().catch(error=>{console.error(error);process.exitCode=1;});

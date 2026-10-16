"use strict";

async function pageScenario(options) {
  const previous = {api, fetch:window.fetch, refreshSftpJobs, startSftpJobsTimer, runtimeSettings, language:document.documentElement.lang, theme:document.documentElement.dataset.theme};
  const key = "web-delivery-" + options.width;
  let received = 0;
  let receivedConflict = '';
  let listed = ["sample.txt"];
  let pendingListing = null;
  // Hidden Electron windows do not guarantee animation frames. A new task
  // flushes modal promises and mutation observers without depending on paint.
  const frame = () => new Promise(resolve => setTimeout(resolve, 0));
  const acceptDialog = async (pending, choice) => {
    await frame();
    const modal = $("modal");
    if (!modal.textContent.includes(webFilesTr("receive_conflicts", {count:1})) || !modal.textContent.includes("sample.txt")) throw new Error("Missing conflict preview: "+JSON.stringify({options,expected:webFilesTr('receive_conflicts',{count:1}),language:document.documentElement.lang,modal:modal.textContent.slice(0,500)}));
    const buttons = [...modal.querySelectorAll("button")];
    for(const label of ['common:auto.overwrite','common:auto.auto_rename','common:actions.cancel'])if(!buttons.some(button=>button.textContent.trim()===tr(label)))throw new Error('Missing overwrite, rename or cancel choice');
    if (options.language === "en-US" && /[\u3400-\u9fff]/.test(modal.textContent)) throw new Error("Conflict dialog not translated");
    const button = buttons.find(button => button.textContent.trim() === tr(choice==='overwrite'?'common:auto.overwrite':choice==='rename'?'common:auto.auto_rename':'common:actions.cancel'));
    if (!button) throw new Error("Missing conflict action");
    button.click();
    await pending;
  };
  try {
    document.documentElement.dataset.theme = options.theme;
    runtimeSettings={...runtimeSettings,saved:{...runtimeSettings?.saved,language:options.language}};
    refreshSftpJobs = async () => [];
    startSftpJobsTimer = () => {};
    api = async (url, request = {}) => {
      if (url === '/api/runtime-settings')return runtimeSettings;
      if (url === "/api/server-files/receive-plan") return {items:[{name:"sample.txt",exists:true,type:'file'}]};
      if (url === "/api/server-files/receive") {received++;receivedConflict=JSON.parse(request.body).conflict;return {id:"web-delivery-job",type:"local-delivery",status:"pending"};}
      if (url.startsWith("/api/server-files?")) {
        const requested = new URL(url, "http://fixture.invalid").searchParams.get("path");
        if (requested === "/old") return await new Promise(resolve => {pendingListing = resolve;});
        return {path:requested || "/fixture",display_path:"C:\\Files",kind:"directory",entries:listed.map(name=>({name,path:(requested || "/fixture")+"/"+name,type:"file",size:12,mtime:1000}))};
      }
      return previous.api(url, request);
    };
    await setTermaLanguage(options.language, {render:false, emit:false});
    await openWebFiles("/fixture", true, key, "server");
    const drag = {connectionId:9,entries:[{name:"sample.txt",path:"/sample.txt",type:"file"}]};
    await acceptDialog(receiveSftpInWebFiles(drag,{key}), 'cancel');
    if (received) throw new Error("Cancelled transfer was submitted");
    await acceptDialog(receiveSftpInWebFiles(drag,{key}), 'rename');
    if (received !== 1 || receivedConflict!=='rename') throw new Error("Confirmed rename was not submitted");
    await acceptDialog(receiveSftpInWebFiles(drag,{key}), 'overwrite');
    if(received!==2 || receivedConflict!=='overwrite')throw new Error('Confirmed overwrite was not submitted');
    listed.push("sample (1).txt");
    refreshLocalFilesForDeliveryJob({id:"web-delivery-job",type:"local-delivery",status:"done",target_directory:"C:\\Files",saved_path:"C:\\Files"});
    await frame();
    if (!localFilesRoot(key).textContent.includes("sample (1).txt")) throw new Error("Completed transfer did not refresh visible directory");
    const old = loadWebFiles(key,"/old");
    await frame();
    await loadWebFiles(key,"/new");
    pendingListing({path:"/old",display_path:"old",kind:"directory",entries:[]});
    await old;
    if (webFilesRuntime(key).path !== "/new") throw new Error("Stale refresh replaced newer navigation");

    await openWebFiles("",true,key,"browser");
    const runtime = webFilesRuntime(key);
    const files = new Map([["sample.txt","keep existing"]]);
    const missing = () => {throw Object.assign(new Error("missing"),{name:"NotFoundError"});};
    const handle = {
      async getDirectoryHandle() {return missing();},
      async getFileHandle(name, settings={}) {
        if (!files.has(name) && !settings.create) return missing();
        return {async createWritable() {
          const chunks = [];
          return new WritableStream({write(chunk){chunks.push(chunk);},async close(){files.set(name,await new Blob(chunks).text());}});
        }};
      }
    };
    runtime.browserDirectory.name = "Files";
    runtime.browserDirectory.writable = true;
    runtime.browserDirectory.writeAllowed = async () => {};
    runtime.browserDirectory.directory = async () => handle;
    runtime.browserDirectory.list = async () => ({path:"/browser",display_path:"Files",kind:"directory",entries:[...files.keys()].map(name=>({name,path:"/browser/"+name,type:"file",size:12,mtime:1000}))});
    window.fetch = async () => new Response("received bytes");
    await loadWebFiles(key,"/browser");
    await acceptDialog(receiveSftpInWebFiles(drag,{key}),'cancel');
    if (files.size !== 1) throw new Error("Cancelled browser receive wrote a file");
    await acceptDialog(receiveSftpInWebFiles(drag,{key}),'rename');
    if (files.get("sample.txt") !== "keep existing" || files.get("sample (1).txt") !== "received bytes") throw new Error("Browser receive did not keep both files");
    const root = localFilesRoot(key);
    if (!root.querySelector(".local-files-list").textContent.includes("sample (1).txt")) throw new Error("Browser receive did not refresh its file list");
    const status = root.querySelector(".web-files-status").textContent;
    if (!status.includes(webFilesTr("received_renamed",{count:1,renamed:1})) || !status.includes("sample.txt") || !status.includes("sample (1).txt")) throw new Error("Rename summary or actual filename is missing");
    window.fetch=async()=>new Response('overwritten bytes');
    await acceptDialog(receiveSftpInWebFiles(drag,{key}),'overwrite');
    if(files.get('sample.txt')!=='overwritten bytes' || files.size!==2 || files.get('sample (1).txt')!=='received bytes')throw new Error('Overwrite did not replace only the chosen file');
    window.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('partial'));controller.error(new Error('interrupted fixture'));}}));
    let interrupted=false;
    const failure=receiveSftpInWebFiles(drag,{key}).then(()=>{throw new Error('Interrupted download unexpectedly succeeded');},()=>{interrupted=true;});
    await acceptDialog(failure,'overwrite');
    if(!interrupted || files.get('sample.txt')!=='overwritten bytes')throw new Error('Failed overwrite damaged the existing file');
    if (options.language === "en-US" && /[\u3400-\u9fff]/.test(root.textContent)) throw new Error("Receive result not translated");
    const history = document.createElement("div");
    history.innerHTML = renderSftpJob({id:"rename-history",type:"local-delivery",status:"done",label:"History",saved_path:"/files",renamed_files:[{source:"<img src=x>.txt",target:"safe (1).txt"}]});
    if(history.querySelector("img") || !history.textContent.includes("<img src=x>.txt") || !history.textContent.includes("safe (1).txt")) throw new Error("Task history rename metadata is missing or is not escaped");
    if (root.scrollWidth > root.clientWidth + 1) throw new Error("Receive result overflows the file pane: "+JSON.stringify({options,width:root.clientWidth,scroll:root.scrollWidth,children:[...root.querySelectorAll('.web-files-shell,.web-files-status,.local-files-list')].map(node=>({class:node.className,width:node.clientWidth,scroll:node.scrollWidth}))}));
    return {...options,refresh:true,conflicts:true,renamed:true,overwrite:true,interrupted:true,navigation:true};
  } finally {
    closeModal();
    api=previous.api;window.fetch=previous.fetch;refreshSftpJobs=previous.refreshSftpJobs;startSftpJobsTimer=previous.startSftpJobsTimer;
    runtimeSettings=previous.runtimeSettings;
    closeTabsByKey([key]);localDeliveryJobTargets.delete("web-delivery-job");sftpKnownJobStatuses.delete("web-delivery-job");
    document.documentElement.dataset.theme=previous.theme;
    await setTermaLanguage(previous.language || "zh-CN",{render:false, emit:false});
  }
}

async function runWebFilesDeliveryUiScenario(window) {
  const results=[];
  for(const width of [1200,392]) {
    window.setSize(width,850);
    for(const language of ["zh-CN","en-US"]) for(const theme of ["light","dark"]) {
      results.push(await window.webContents.executeJavaScript("("+pageScenario.toString()+")("+JSON.stringify({width,language,theme})+")"));
    }
  }
  window.setSize(1200,800);
  console.log("[ui-smoke] local delivery completion",JSON.stringify(results));
}
module.exports={runWebFilesDeliveryUiScenario};

"use strict";

async function runPanelPerformanceMatrix(driver) {
  const {execute, wait, check, click, shot, prefix, delay} = driver;
  await execute(`const f=window.__panelFixture;
    f.performanceApi=api;f.performanceRequests=[];f.performanceMode='normal';
    for(const s of window.termaTerminalState.terminalSessions.values())if(s.key.startsWith('terminal-panel-review-'))s.connected=true;
    activeTabKey='terminal-panel-review-0';window.dispatchEvent(new CustomEvent('terma:workspace-target-changed'));
    api=async(url,options={})=>{
      if(/\\/host-performance$/.test(url)){
        f.performanceRequests.push({url,signal:options.signal});
        if(f.performanceMode==='slow')await new Promise((resolve,reject)=>{
          const timer=setTimeout(resolve,500);
          options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});
        });
        if(f.performanceMode==='error')throw Error('Private diagnostic must not appear');
        return {supported:f.performanceMode!=='unsupported',sampledAt:Date.now(),cpuPercent:25.5,
          memory:{totalBytes:4294967296,usedBytes:1073741824},load:[0.1,0.2,0.3],
          processes:[{pid:11,name:'worker',cpu:5.5,memoryBytes:1048576},{pid:22,name:'service',cpu:1.5,memoryBytes:2097152}]};
      }
      return f.performanceApi(url,options);
    };
    const p=window.termaEfficiency.panel;p.dispose();p.install();
    const m=p.model;m.restore({});m.current().height=390;f.performanceTab=m.add('performance');m.publish();`);
  try {
    await wait("document.querySelector('[data-panel-process]')");
    await check(prefix+" performance starts automatically without pause controls", "window.__panelFixture.performanceRequests.length>0&&!document.querySelector('[data-panel-performance-toggle]')");
    await check(prefix+" cpu process sort", "document.querySelector('[data-panel-process]').dataset.panelProcess==='11'");
    await check(prefix+" compact process rows", "[...document.querySelectorAll('.panel-performance tbody tr')].every(n=>n.getBoundingClientRect().height<=30)");
    await click('[data-panel-process-sort="memoryBytes"]');
    await check(prefix+" memory process sort", "document.querySelector('[data-panel-process]').dataset.panelProcess==='22'");
    await shot(prefix+"-performance-live");
    await click('[data-panel-action="split_horizontal"]');
    await wait("document.querySelectorAll('[data-panel-pane]').length===2");
    await execute(`const f=window.__panelFixture,m=window.termaEfficiency.panel.model;
      f.performanceSecond=m.pane().activeTabKey;f.performanceBefore=f.performanceRequests.length;`);
    await delay(100);
    await check(prefix+" splitting retains one performance tool and cached sample", "window.__panelFixture.performanceRequests.length===window.__panelFixture.performanceBefore&&document.querySelectorAll('[data-panel-process=\"11\"]').length===1");
    await shot(prefix+"-performance-shared");
    await execute(`window.termaEfficiency.panel.toggle();window.__panelFixture.performanceBefore=window.__panelFixture.performanceRequests.length;`);
    await delay(2100);
    await check(prefix+" hidden performance sends no requests", "window.__panelFixture.performanceRequests.length===window.__panelFixture.performanceBefore");
    await execute(`window.termaEfficiency.panel.toggle();`);
    await wait("window.__panelFixture.performanceRequests.length>window.__panelFixture.performanceBefore");
    await execute(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
      document.dispatchEvent(new Event('visibilitychange'));
      window.__panelFixture.performanceBefore=window.__panelFixture.performanceRequests.length;`);
    await delay(2100);
    await check(prefix+" background document stops sampling", "window.__panelFixture.performanceRequests.length===window.__panelFixture.performanceBefore");
    await execute("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))");
    await execute(`const s=window.termaTerminalState.terminalSessions.get('terminal-panel-review-0');
      s.connected=false;window.dispatchEvent(new CustomEvent('terma:terminal-toolbar-ready'));`);
    await wait("document.querySelector('.terminal-panel-pane.focused [data-panel-performance-status]').textContent===tr('terminal:panel.performance_disconnected')");
    await check(prefix+" disconnect retains last timestamp", "!!document.querySelector('.terminal-panel-pane.focused .panel-performance time')");
    await shot(prefix+"-performance-disconnected");
    await execute(`const f=window.__panelFixture,s=window.termaTerminalState.terminalSessions.get('terminal-panel-review-0');
      s.connected=true;f.performanceMode='error';window.dispatchEvent(new CustomEvent('terma:terminal-toolbar-ready'));`);
    await wait("document.querySelector('.terminal-panel-pane.focused [data-panel-performance-status]').textContent===tr('terminal:panel.performance_failed')");
    await check(prefix+" errors do not expose remote details", "!document.querySelector('#terminalPanel').textContent.includes('Private diagnostic')");
    await shot(prefix+"-performance-error");
    await execute(`window.__panelFixture.performanceMode='unsupported';`);
    await wait("document.querySelector('.terminal-panel-pane.focused .panel-performance').textContent.includes(tr('terminal:panel.performance_unsupported'))");
    await check(prefix+" unsupported status never claims live sampling", "document.querySelector('.terminal-panel-pane.focused [data-panel-performance-status]').textContent===tr('terminal:panel.sampling_unavailable')");
    await shot(prefix+"-performance-unsupported");
    await execute(`window.__panelFixture.performanceBefore=window.__panelFixture.performanceRequests.length;`);
    await delay(2100);
    await check(prefix+" unsupported target stops sampling", "window.__panelFixture.performanceRequests.length===window.__panelFixture.performanceBefore");
    await execute(`window.__panelFixture.performanceMode='slow';activeTabKey='terminal-panel-review-1';window.dispatchEvent(new CustomEvent('terma:workspace-target-changed'));`);
    await wait("window.__panelFixture.performanceRequests.at(-1)?.url.includes('/9972/')");
    await shot(prefix+"-performance-loading");
    await execute(`window.termaEfficiency.panel.toggle();`);
    await wait("window.__panelFixture.performanceRequests.at(-1).signal.aborted");
    await check(prefix+" hiding cancels in-flight sample", "window.__panelFixture.performanceRequests.at(-1).signal.aborted");
    await execute(`window.termaEfficiency.panel.toggle();`);
    await execute(`const f=window.__panelFixture,m=window.termaEfficiency.panel.model;
      const s=window.termaTerminalState.terminalSessions.get('terminal-panel-review-0');
      f.savedPerformanceSessionId=s.id;s.id=-9971;
      activeTabKey='terminal-panel-review-0';
      window.dispatchEvent(new CustomEvent('terma:workspace-target-changed'));`);
    await wait("document.querySelector('.terminal-panel-pane.focused [data-panel-performance-status]').textContent===tr('terminal:panel.performance_saved_target')");
    await check(prefix+" unsaved targets explain unavailable sampling without requests",
      "!document.querySelector('[data-panel-performance-toggle]')&&!window.__panelFixture.performanceRequests.some(r=>r.url.includes('/-9971/'))");
    await shot(prefix+"-performance-unsaved");
  } finally {
    await execute(`const f=window.__panelFixture,s=window.termaTerminalState.terminalSessions.get('terminal-panel-review-0');
      if(s&&f.savedPerformanceSessionId!==undefined)s.id=f.savedPerformanceSessionId;
      delete f.savedPerformanceSessionId;window.termaEfficiency.panel.model.restore({});api=f.performanceApi;`);
  }
}
module.exports = {runPanelPerformanceMatrix};

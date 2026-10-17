"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const net = require("node:net");
const {spawn} = require("node:child_process");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "terma-origin-policy-"));
process.env.TERMA_DATA_DIR = path.join(root, "data");
process.env.TERMA_SSH_DIR = path.join(root, "ssh");
delete process.env.TERMA_DISTRIBUTION;
const security = require("../dist/security");
const file = path.join(process.env.TERMA_DATA_DIR, "security.json");
const password = "Origin-Policy-Test-Only-2026";
const mock = (origin, host="terma.example.test", headers={}) => ({headers:{host,origin,...headers},
  socket:{remoteAddress:"192.0.2.20",localAddress:"127.0.0.1",localPort:8088}});

function request(port, pathname, {method="GET", host="terma.example.test", origin="https://terma.example.test", cookie, body, headers={}}={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request({host:"127.0.0.1",port,path:pathname,method,headers:{host,
      ...(origin===null?{}:{origin}),...(cookie?{cookie}:{}),...headers,
      ...(body?{"content-type":"application/json"}:{})}},res=>{
      let text="";res.setEncoding("utf8");res.on("data",chunk=>text+=chunk);
      res.on("end",()=>resolve({status:res.statusCode,headers:res.headers,text,json:()=>JSON.parse(text)}));
    });req.on("error",reject);if(body)req.write(JSON.stringify(body));req.end();
  });
}

// No SSH target or commands are opened: this endpoint sends a ready frame only.
function websocketAccepted(port,cookie,origin="https://terma.example.test") {
  return new Promise((resolve,reject)=>{
    const socket=net.connect(port,"127.0.0.1");let response="";let settled=false;
    const finish=value=>{if(settled)return;settled=true;socket.destroy();resolve(value);};
    socket.setTimeout(3000,()=>{socket.destroy();reject(new Error('WebSocket acceptance timed out'));});
    socket.on('connect',()=>socket.write([
      'GET /ws/batch-command HTTP/1.1','Host: terma.example.test','Upgrade: websocket','Connection: Upgrade',
      'Sec-WebSocket-Version: 13','Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',`Origin: ${origin}`,
      ...(cookie?[`Cookie: ${cookie}`]:[]),'',''
    ].join('\r\n')));
    socket.on('data',chunk=>{response+=chunk.toString();if(response.includes('\r\n\r\n'))finish(response.startsWith('HTTP/1.1 101 '));});
    socket.on('error',error=>{if(error.code==='ECONNRESET')finish(false);else reject(error);});
    socket.on('close',()=>finish(false));
  });
}

async function main() {
  assert.equal(security.readSecuritySettings().origin_protocol_check_enabled,true);
  for (const value of [undefined,null,"false",0,[],{}]) {
    fs.writeFileSync(file,JSON.stringify({origin_protocol_check_enabled:value}));
    assert.equal(security.readSecuritySettings().origin_protocol_check_enabled,true,"Old or damaged settings must remain strict");
  }
  security.updateSecurityOptions({auth_mode:"always",allowed_hosts:["terma.example.test"]});
  security.setPassword(password);
  assert.equal(security.originRejectionCode(mock("https://terma.example.test")),"request_origin_protocol_mismatch");
  assert.equal(security.webSocketOriginAllowed(mock("https://terma.example.test")),false);
  for(const invalid of ["false",null,0,[],{}]) {
    assert.throws(()=>security.updateSecurityOptions({origin_protocol_check_enabled:invalid}),/must be enabled or disabled/);
  }
  security.updateSecurityOptions({origin_protocol_check_enabled:false});
  const compatible=mock("https://terma.example.test");
  assert.equal(security.sameOrigin(compatible),true);
  assert.equal(security.webSocketOriginAllowed(compatible),true);
  assert.equal(security.isRequestSecure(compatible),true);
  assert.equal(security.authRequired(compatible),true);
  assert.equal(security.isAuthenticated(compatible),false);
  assert.equal(security.isDesktopCapabilityRequest(compatible),false);
  assert.equal(security.requestSourceAddress(mock("https://terma.example.test",undefined,{"x-forwarded-for":"127.0.0.1"})),"192.0.2.20");
  assert.equal(security.sameOrigin(mock("https://terma.example.test:8443","terma.example.test:8443")),true);
  for(const origin of ["null","file://terma.example.test","https://evil.example.test","https://terma.example.test:8443",
    "https://user@terma.example.test","https://terma.example.test/path","https://terma.example.test?x=1",
    "https://terma.example.test#x",["https://terma.example.test"],"bad origin"]) {
    assert.equal(security.sameOrigin(mock(origin)),false,JSON.stringify(origin));
    assert.equal(security.webSocketOriginAllowed(mock(origin)),false,JSON.stringify(origin));
  }
  assert.equal(security.sameOrigin(mock("https://unapproved.example","unapproved.example")),false);
  assert.equal(security.webSocketOriginAllowed(mock(undefined)),false,"No-Origin remote WebSockets still require explicit credentials");
  assert.equal(security.sameOrigin(mock("https://terma.example.test","terma.example.test:80")),false);
  assert.equal(security.isRequestSecure(mock("http://terma.example.test")),false);
  assert.equal(security.isRequestSecure(mock("https://evil.example.test")),false);
  security.updateSecurityOptions({secure_cookie_mode:"never"});
  assert.equal(security.isRequestSecure(compatible),false);
  security.updateSecurityOptions({secure_cookie_mode:"auto",origin_protocol_check_enabled:true});

  const listener=http.createServer();
  await new Promise(resolve=>listener.listen(0,"127.0.0.1",resolve));
  const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const child=spawn(process.execPath,["dist/server.js","--host","127.0.0.1","--port",String(port)],
    {cwd:path.resolve(__dirname,".."),env:{...process.env,TERMA_DISABLE_UPDATE_CHECK:"1"},windowsHide:true,stdio:["ignore","pipe","pipe"]});
  let output="";child.stdout.on("data",chunk=>output+=chunk);child.stderr.on("data",chunk=>output+=chunk);
  try {
    let ready=false;
    for(let index=0;index<150;index++){
      if(child.exitCode!==null)throw new Error(output);
      try {ready=(await request(port,"/api/auth/status",{origin:null})).status===200;}catch{}
      if(ready)break;await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(ready,true,output);
    const blocked=await request(port,"/api/auth/login",{method:"POST",body:{password}});
    assert.equal(blocked.status,403);assert.equal(blocked.json().error_code,"request_origin_protocol_mismatch");
    for(let attempt=0;attempt<6;attempt++)assert.equal((await request(port,"/api/auth/login",{method:"POST",body:{password:"wrong-test-password"}})).status,403);
    const lan={host:`127.0.0.1:${port}`,origin:`http://127.0.0.1:${port}`};
    const localLogin=await request(port,"/api/auth/login",{...lan,method:"POST",body:{password}});
    assert.equal(localLogin.status,200);
    const localCookie=localLogin.headers["set-cookie"][0].split(";")[0];
    assert.equal((await request(port,"/api/security",{...lan,method:"PUT",cookie:localCookie,body:{origin_protocol_check_enabled:false}})).status,200);
    const login=await request(port,"/api/auth/login",{method:"POST",body:{password}});
    assert.equal(login.status,200);
    const cookies=login.headers["set-cookie"][0];assert.match(cookies,/; Secure/);assert.match(cookies,/HttpOnly/);assert.match(cookies,/SameSite=Lax/);
    const cookie=cookies.split(";")[0];
    assert.equal(await websocketAccepted(port,cookie),true,"Compatible HTTPS origin must reach the WebSocket upgrade");
    assert.equal(await websocketAccepted(port,null),false,"WebSockets still require login");
    assert.equal(await websocketAccepted(port,cookie,'https://evil.example.test'),false,"WebSockets still require the same host");
    assert.equal(await websocketAccepted(port,cookie,'https://terma.example.test:8443'),false,"WebSockets still require the same port");
    assert.equal((await request(port,"/api/connections",{cookie})).status,200);
    assert.equal((await request(port,"/api/connections")).status,401);
    for(const origin of ["https://evil.example.test","null","https://terma.example.test:8443"]){
      const rejected=await request(port,"/api/security",{cookie,origin,method:"PUT",body:{origin_protocol_check_enabled:true}});
      assert.equal(rejected.status,403);assert.equal(rejected.json().error_code,"request_origin_forbidden");
    }
    assert.equal((await request(port,"/api/security",{cookie,method:"PUT",body:{origin_protocol_check_enabled:"false"}})).status,400);
    const logout=await request(port,"/api/auth/logout",{cookie,method:"POST",body:{}});
    assert.equal(logout.status,200);assert.match(logout.headers["set-cookie"][0],/Max-Age=0/);assert.match(logout.headers["set-cookie"][0],/; Secure/);
    assert.equal((await request(port,"/api/connections",{cookie})).status,401);
    assert.equal((await request(port,"/api/security",{...lan,method:"PUT",cookie:localCookie,body:{origin_protocol_check_enabled:true}})).status,200);
    assert.equal((await request(port,"/api/auth/login",{method:"POST",body:{password}})).status,403);
    assert.equal(await websocketAccepted(port,localCookie),false,"Restoring strict checking must reject mismatched WebSocket protocols");
    assert.equal((await request(port,"/api/auth/login",{...lan,method:"POST",body:{password}})).status,200);
  } catch(error) {
    if(output)console.error(output.slice(-4000));
    throw error;
  } finally {
    child.kill("SIGTERM");await new Promise(resolve=>child.exitCode!==null?resolve():child.once("close",resolve));
  }
  security.resetWebAccessSecurity();assert.equal(security.readSecuritySettings().origin_protocol_check_enabled,true);
  console.log("Origin protocol checks passed: legacy defaults, no-proxy HTTPS-to-HTTP login, Secure cookies, logout, domain/port/auth/native boundaries, HTTP and WebSocket policy");
}

main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>fs.rmSync(root,{recursive:true,force:true,maxRetries:8,retryDelay:150}));

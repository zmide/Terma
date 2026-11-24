export interface McpTool {
  serverId:string;
  serverName:string;
  name:string;
  description:string;
  risk:string;
  inputSchema:Record<string,unknown>;
  requiresApproval:boolean;
}
export interface McpContext {source:'mcp-tools';title:string;text:string}
export interface McpCatalog {contexts:McpContext[];tools:McpTool[];expiresAt:number}
export interface McpCall {server:string;tool:string;arguments:Record<string,unknown>;requiresApproval?:boolean;key?:string}
export interface McpResult {called:boolean;unsupported?:boolean;denied?:boolean;output:string;server:string;tool:string}
export interface McpPort {
  request(path:string,options?:Record<string,unknown>,signal?:AbortSignal):Promise<any>;
  now():number;
}
const text=(value:unknown,max=16000)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').slice(0,max);
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const toolName=(value:unknown)=>text(value,160).trim();
function searchIntent(prompt:unknown){const source=String(prompt??'').trim();return !!source&&/(?:网页|在线|联网|互联网|网上|网络上|搜索网页|在线搜索|联网搜索|查一下|查找|检索|搜索|web\s+search|search\s+online|look\s*up|browse|research)/i.test(source);}
function searchTopic(prompt:unknown){const source=String(prompt??'').trim();let query=source.replace(/^(?:请|帮我|麻烦|你)?\s*/i,'').replace(/^(?:在\s*)?(?:github|git\s*hub)(?:上|中)?\s*(?:搜索一下|搜索|查找|查询|检索|搜一下|查一下)?[:：]?/i,'').replace(/^(?:在网上|在线|联网|网页上|网络上)?\s*(?:搜索一下|搜索|查找|查询|检索|查一下)[:：]?/i,'').trim();query=query.replace(/(?:帮我)?看看(?:它)?(?:是)?什么(?:东西)?[？?。！!]*$/i,'').trim()||query;return query||source;}
function projectLookup(prompt:unknown){return /^terma$/i.test(searchTopic(prompt));}
function searchQuery(prompt:unknown){const query=searchTopic(prompt);return projectLookup(prompt)?'"zmide/Terma" GitHub remote connection workspace SSH terminal SFTP':query;}
function projectContext(prompt:unknown){if(!projectLookup(prompt))return null;return {source:'application-identity',title:'Terma project identity',text:'The current application is the GitHub project zmide/Terma: a remote connection workspace for desktop and self-hosted Web environments with SSH, terminal, SFTP, remote desktop, port forwarding, and batch commands. Official source: https://github.com/zmide/Terma. Use this trusted identity to disambiguate web content from unrelated organizations also named Terma.'};}
function schemaProperties(tool:McpTool){const schema=object(tool?.inputSchema);return object(schema.properties);}
function searchCall(prompt:unknown,tools:McpTool[]):McpCall|null{
  if(!searchIntent(prompt))return null;const query=searchQuery(prompt);
  if(projectLookup(prompt)){
    const source=tools.find(tool=>{const haystack=`${tool.name} ${tool.description}`;const props=schemaProperties(tool);return /(?:search|query|lookup|browse|web)/i.test(haystack)&&!/(?:extract|fetch)/i.test(haystack)&&(['query','q','search_query'].some(key=>Object.prototype.hasOwnProperty.call(props,key)));})||tools.find(tool=>{const props=schemaProperties(tool);return /(?:extract|fetch)/i.test(`${tool.name} ${tool.description}`)&&(['urls','url'].some(key=>Object.prototype.hasOwnProperty.call(props,key)));});
    if(source){const props=schemaProperties(source),args:Record<string,unknown>={},url='https://github.com/zmide/Terma',extracts=Object.prototype.hasOwnProperty.call(props,'urls')||Object.prototype.hasOwnProperty.call(props,'url');if(Object.prototype.hasOwnProperty.call(props,'urls'))args.urls=[url];else if(Object.prototype.hasOwnProperty.call(props,'url'))args.url=url;else{const key=['query','q','search_query'].find(item=>Object.prototype.hasOwnProperty.call(props,item));if(key)args[key]=query;}if(extracts&&Object.prototype.hasOwnProperty.call(props,'query'))args.query='remote connection workspace SSH terminal SFTP';return {server:source.serverId,tool:source.name,arguments:args,requiresApproval:source.requiresApproval,key:`${source.serverId}\u0000${source.name}\u0000${JSON.stringify(args)}`};}
  }
  const selected=tools.map(tool=>{const haystack=`${tool.name} ${tool.description}`.toLowerCase();let score=0;if(/(?:tavily|brave|bing|google|serp|web[_ -]?search|search[_ -]?web)/i.test(haystack))score+=5;if(/(?:search|query|lookup|browse|web)/i.test(haystack))score+=3;if(!tool.requiresApproval)score+=1;return {tool,score};}).filter(item=>item.score>0).sort((a,b)=>b.score-a.score)[0]?.tool;if(!selected)return null;const props=schemaProperties(selected),args:Record<string,unknown>={},key=['query','q','search_query','keyword','keywords','text','input'].find(item=>Object.prototype.hasOwnProperty.call(props,item));if(key)args[key]=query;const schema=object(selected.inputSchema);for(const required of Array.isArray(schema.required)?schema.required:[]){const name=String(required);if(Object.prototype.hasOwnProperty.call(args,name))continue;const definition=object(props[name]);if(definition.default!==undefined)args[name]=definition.default;else if(Array.isArray(definition.enum)&&definition.enum.length)args[name]=definition.enum[0];else if(definition.type==='string')args[name]=query;}if(!Object.keys(args).length)args.query=query;return {key:`${selected.serverId}\u0000${selected.name}\u0000${JSON.stringify(args)}`,server:selected.serverId,tool:selected.name,arguments:args};
}
function normalizeTool(server:any,tool:any):McpTool|null {
  const name=toolName(tool?.name); if(!name || tool?.enabled === false)return null;
  return {serverId:text(server?.id,160),serverName:text(server?.name||server?.id,160),name,description:text(tool?.description,2000),risk:text(tool?.risk||'read',40),inputSchema:object(tool?.inputSchema),requiresApproval:tool?.requires_approval!==false};
}
export function createMcpService(port:McpPort){
  let catalog:McpCatalog={contexts:[],tools:[],expiresAt:0};
  async function discover(signal?:AbortSignal):Promise<McpCatalog>{
    if(catalog.expiresAt>port.now())return catalog;
    const result=await port.request('/api/ai/mcp/servers',{},signal);
    const servers=(Array.isArray(result?.servers)?result.servers:[]).filter((server:any)=>server?.enabled===true).slice(0,8);
    const contexts:McpContext[]=[];const tools:McpTool[]=[];
    for(const server of servers){
      if(signal?.aborted)throw new DOMException('Aborted','AbortError');
      try{
        let discovered=Array.isArray(server.tools)?server.tools.slice(0,64):[];
        if(!discovered.length){const response=await port.request(`/api/ai/mcp/servers/${encodeURIComponent(text(server.id,160))}/discover`,{method:'POST',body:'{}'},signal);discovered=Array.isArray(response?.tools)?response.tools.slice(0,64):[];}
        const normalized:McpTool[]=[];for(const raw of discovered){const tool=normalizeTool(server,raw);if(tool&&normalized.every(item=>item.name!==tool.name))normalized.push(tool);}
        if(!normalized.length)continue;
        tools.push(...normalized);
        const lines=normalized.map(tool=>`- ${tool.name}: ${tool.description}\n  risk: ${tool.risk}\n  inputSchema: ${JSON.stringify(tool.inputSchema)}`);
        contexts.push({source:'mcp-tools',title:`MCP ${text(server.name||server.id,160)} (${text(server.id,160)})`,text:text(`Server ID: ${text(server.id,160)}\nAvailable tools:\n${lines.join('\n')}`,16000)});
      }catch(error){if(signal?.aborted)throw error;}
    }
    catalog={contexts,tools,expiresAt:port.now()+60000};return catalog;
  }
  async function call(call:McpCall,signal?:AbortSignal):Promise<McpResult>{
    const server=text(call?.server,160).trim(),tool=toolName(call?.tool),args=object(call?.arguments);
    if(!server||!tool)return {called:false,unsupported:true,output:'',server,tool};
    const result=await port.request('/api/ai/mcp/call',{method:'POST',body:JSON.stringify({server_id:server,tool,arguments:args})},signal);
    return {called:result?.called===true,unsupported:result?.unsupported===true,denied:result?.denied===true,output:text(result?.output,100000),server,tool};
  }
  function clear(){catalog={contexts:[],tools:[],expiresAt:0};}
  return {catalog:discover,contexts:async(signal?:AbortSignal)=>(await discover(signal)).contexts,tools:()=>catalog.tools.slice(),searchIntent,searchTopic,projectLookup,searchQuery,projectContext,searchCall:(prompt:unknown)=>searchCall(prompt,catalog.tools),call,clear,dispose:clear};
}

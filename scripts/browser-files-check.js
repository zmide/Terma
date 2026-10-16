const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const context=vm.createContext({window:{},webFilesTr:key=>key,TextDecoder,TextEncoder});
vm.runInContext(fs.readFileSync('public/app-browser-files.js','utf8')+'\n globalThis.Directory=BrowserFileDirectory;',context);
function missing(){const error=new Error('missing');error.name='NotFoundError';throw error;}
function mismatch(){const error=new Error('wrong kind');error.name='TypeMismatchError';throw error;}
function directory(name,items=new Map()) {
  return {name,kind:'directory',items,async queryPermission(){return 'granted';},async *entries(){yield*items;},
    async getDirectoryHandle(name,options={}){if(items.has(name)){if(items.get(name).kind!=='directory')return mismatch();return items.get(name);}if(!options.create)return missing();const item=directory(name);items.set(name,item);return item;},
    async getFileHandle(name,options={}){if(items.has(name)){if(items.get(name).kind!=='file')return mismatch();return items.get(name);}if(!options.create)return missing();const item=file(name,'');items.set(name,item);return item;},
    async removeEntry(name){if(!items.has(name))return missing();items.delete(name);}};
}
function file(name,content){let data=content;return {name,kind:'file',async getFile(){return {name,size:Buffer.byteLength(data),lastModified:1000,async arrayBuffer(){return Uint8Array.from(Buffer.from(data)).buffer;},data};},async createWritable(){let staged;return {async write(value){staged=typeof value==='string'?value:value.data;},async close(){data=staged;},async abort(){}};}};}
(async()=>{
  const fixture=new context.Directory();fixture.handle=directory('fixture');fixture.name='fixture';fixture.writable=true;
  assert.equal(fixture.receiveName('report 21:38:27?.txt','Win32'),'report 21_38_27_.txt');
  assert.equal(fixture.receiveName('CON.txt','Win32'),'_CON.txt');
  assert.equal(fixture.receiveName('LPT¹.log','Win32'),'_LPT¹.log');
  assert.equal(fixture.receiveName('name. ','Win32'),'name');
  assert.equal(fixture.receiveName('report:21.txt','Linux'),'report:21.txt');
  assert.equal(fixture.numberedName('report.txt',2),'report (2).txt');
  assert(new TextEncoder().encode(fixture.receiveName('文'.repeat(200),'Win32')).length<=240);
  for(const value of ['../x','x/y','x\\y','\0'])assert.throws(()=>fixture.receiveName(value,'Win32'));
  await fixture.mutate('create',{directory:'/browser',name:'测试',type:'dir'});
  await fixture.mutate('create',{directory:'/browser/测试',name:'a.txt',type:'file'});
  await fixture.write('/browser/测试/a.txt','中文 content');
  assert.equal((await fixture.list('/browser')).entries[0].name,'测试');
  assert.equal((await fixture.file('/browser/测试/a.txt')).data,'中文 content');
  await fixture.mutate('rename',{path:'/browser/测试/a.txt',new_name:'b.txt'});
  await fixture.mutate('create',{directory:'/browser/测试',name:'empty',type:'dir'});
  const collected=await fixture.collect([{path:'/browser/测试',name:'测试',type:'dir'}]);
  assert(collected.directories.includes('测试/empty'),'Empty directories must be retained for upload');
  assert.equal((await fixture.collect([{path:'/browser/测试',name:'测试',type:'dir'}]))[0].relativePath,'测试/b.txt');
  await assert.rejects(fixture.mutate('create',{directory:'/browser/测试',name:'b.txt',type:'file'}));
  for(const value of ['/browser/..','/other/a','/browser//a','/browser/a\\b'])assert.throws(()=>fixture.parts(value));
  fixture.writable=false;await assert.rejects(fixture.write('/browser/测试/b.txt','bad'));
  fixture.writable=true;await fixture.mutate('delete',{paths:['/browser/测试']});assert.equal((await fixture.list('/browser')).entries.length,0);
  fixture.handle=null;fixture.writable=false;fixture.files=[{name:'read.txt',webkitRelativePath:'fixture/sub/read.txt',size:3,lastModified:1000}];
  assert.equal((await fixture.list('/browser')).entries[0].type,'dir');assert.equal((await fixture.list('/browser/sub')).entries[0].name,'read.txt');
  assert.equal((await fixture.file('/browser/sub/read.txt')).name,'read.txt');await assert.rejects(fixture.mutate('delete',{paths:['/browser/sub/read.txt']}));
  console.log('Browser files passed: authorized handles, CRUD, Unicode, uploads, file conflicts, invalid paths, revoked write access and HTTP read-only fallback');
})().catch(error=>{console.error(error);process.exitCode=1;});

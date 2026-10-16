const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'terma-web-files-check-'));
process.env.TERMA_DATA_DIR=path.join(temporary,'private');
process.env.TERMA_SSH_DIR=path.join(temporary,'keys');
const authorized=path.join(temporary,'authorized');fs.mkdirSync(authorized);
process.env.TERMA_FILE_ROOTS=JSON.stringify([authorized,process.env.TERMA_DATA_DIR,process.env.TERMA_SSH_DIR]);
const files=require('../dist/services/server-files-service');
try {
  const roots=files.serverFileRoots();
  const root=roots.find(item=>item.directory===fs.realpathSync(authorized));
  assert(root);assert.equal(roots.length,2);
  const prefix='/'+root.id;
  assert.equal(files.listServerFiles('').entries.length,2);
  assert.equal(files.resolveServerDirectory(authorized),prefix);
  assert.equal(files.listServerFiles(prefix).display_path,fs.realpathSync(authorized));
  assert.throws(()=>files.resolveServerDirectory(process.env.TERMA_DATA_DIR));
  assert.throws(()=>files.resolveServerDirectory(os.homedir()));
  files.mutateServerFiles('create',{directory:prefix,name:'中文目录',type:'dir'});
  files.mutateServerFiles('create',{directory:prefix+'/中文目录',name:'test.txt',type:'file'});
  const file=prefix+'/中文目录/test.txt';
  files.writeServerText(file,'test 中文\n');assert.equal(files.readServerText(file),'test 中文\n');
  const stagedFile=path.join(temporary,'staged.txt');fs.writeFileSync(stagedFile,'new incoming');
  files.validateServerReceiveTarget(prefix+'/中文目录',stagedFile,files.serverFilePath(file),true);
  assert.throws(()=>files.validateServerReceiveTarget(prefix,stagedFile,authorized+'-outside',true));
  assert.throws(()=>files.validateServerReceiveTarget(prefix,stagedFile,path.join(authorized,'中文目录'),true),/覆盖仅适用于同名文件/);
  assert.throws(()=>files.validateServerReceiveTarget(prefix+'/中文目录',authorized,files.serverFilePath(file),true),/覆盖仅适用于同名文件/);
  assert.equal(files.listServerFiles(prefix+'/中文目录').entries[0].path,file);
  assert.equal(files.listServerFiles(prefix).parent_kind,'computer');
  files.mutateServerFiles('rename',{path:file,new_name:'renamed.txt'});
  assert.equal(files.readServerText(prefix+'/中文目录/renamed.txt'),'test 中文\n');
  assert.throws(()=>files.writeServerText(prefix+'/中文目录/renamed.txt','x'.repeat(1024*1024+1)));
  assert.equal(files.readServerText(prefix+'/中文目录/renamed.txt'),'test 中文\n');
  for(const bad of ['/','/'+root.id+'/../private','/'+root.id+'//test','/'+root.id+'/C:','/'+root.id+'/x\\y','/'+root.id+'/.terma-upload-active'])assert.throws(()=>files.serverFilePath(bad));
  assert.throws(()=>files.mutateServerFiles('delete',{paths:[prefix]}));
  assert.throws(()=>files.mutateServerFiles('rename',{path:prefix,new_name:'other'}));
  assert.throws(()=>files.mutateServerFiles('create',{directory:prefix,name:'../outside',type:'file'}));
  const outside=path.join(temporary,'outside.txt');fs.writeFileSync(outside,'retained');
  try {
    fs.symlinkSync(outside,path.join(authorized,'link'));
    assert.throws(()=>files.serverFilePath(prefix+'/link'));
    assert.throws(()=>files.writeServerText(prefix+'/link','bad'));
    assert.throws(()=>files.validateServerReceiveTarget(prefix,stagedFile,path.join(authorized,'link'),true));
    assert.equal(files.listServerFiles(prefix).entries.some(item=>item.name==='link'),false);
  } catch(error) {if(error.code!=='EPERM')throw error;}
  fs.linkSync(outside,path.join(authorized,'hardlink'));
  assert.throws(()=>files.readServerText(prefix+'/hardlink'));
  assert.throws(()=>files.validateServerReceiveTarget(prefix,stagedFile,path.join(authorized,'hardlink'),true));
  assert.throws(()=>files.serverFileTree(prefix));
  fs.unlinkSync(path.join(authorized,'hardlink'));
  try{fs.unlinkSync(path.join(authorized,'link'));}catch{}
  assert.equal(fs.readFileSync(outside,'utf8'),'retained');
  files.mutateServerFiles('delete',{paths:[prefix+'/中文目录']});
  assert.equal(fs.existsSync(path.join(authorized,'中文目录')),false);
  assert.deepEqual(fs.readdirSync(authorized),[]);
  delete process.env.TERMA_FILE_ROOTS;
  const systemRoot=files.serverFileRoots().find(item=>item.root_kind==='system' && item.directory===fs.realpathSync(path.parse(temporary).root));
  assert(systemRoot,'Standard builds must show the device file system');
  const temporaryVirtual=files.resolveServerDirectory(temporary);
  assert.throws(()=>files.mutateServerFiles('rename',{path:temporaryVirtual,new_name:'must-not-move-private-data'}));
  assert.throws(()=>files.serverFilePath('/'+systemRoot.id,{mutable:true}));
  process.env.TERMA_DISTRIBUTION='fnos';
  assert.equal(files.serverFileRoots().some(item=>item.root_kind==='system'),false,'fnOS must retain platform folder authorization');
  assert.throws(()=>files.resolveServerDirectory(temporary));
  console.log('Server files passed: authorized roots, virtual paths, CRUD, Unicode, text limits, protected roots, root deletion, symlinks and hardlinks');
} finally {
  try{require('../dist/db').closeDatabase();}catch{}
  fs.rmSync(temporary,{recursive:true,force:true});
}

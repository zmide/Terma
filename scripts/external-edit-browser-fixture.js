const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');

// Run the production watcher against disposable local files and an in-memory
// remote. Never launch a host editor or access a saved connection/user file.
function createExternalEditBrowserFixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'terma-external-browser-'));
  const filename=path.join(__dirname,'../dist/sftp-external-edit.js');
  const compiled={exports:{}};let writes=0;
  const remote=Buffer.from('original fixture content\n');
  const sftp={decodeRemoteText:content=>({content:content.toString('utf8'),encoding:'UTF-8'}),invalidateRemoteDirectoryCache(){},readRemoteBinaryFile:async()=>({content:Buffer.from(remote)}),readRemoteFileMetadata:async()=>({size:remote.length,mtime:1}),writeRemoteFile:async()=>{writes++;throw Error('Browser confirmation test must not upload');}};
  const fixtureRequire=name=>{
    if(name==='./config')return {DATA_DIR:root};
    if(name==='./sftp')return sftp;
    if(name==='./sftp-session')return {getSftpConnection:()=>({id:7,name:'Review host'})};
    if(name.startsWith('node:'))return require(name);
    throw Error('Unexpected external edit fixture dependency: '+name);
  };
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module:compiled,exports:compiled.exports,require:fixtureRequire,Buffer,setTimeout,clearTimeout},{filename});
  const service=compiled.exports;
  return {
    open:()=>service.startExternalEdit(7,'/review/externally-saved.txt',{open:async()=>{},saveRule:'prompt'}),
    save(id,content){const session=service.getExternalEdit(id);const target=path.resolve(session.local_path);if(!target.startsWith(root+path.sep))throw Error('Fixture path escaped its temporary directory');fs.writeFileSync(target,content);},
    async modified(id){for(let attempt=0;attempt<100;attempt++){const session=service.getExternalEdit(id);if(session.status==='modified')return session;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('Production file watcher did not observe the external save');},
    postpone:id=>service.resolveExternalEdit(id,'cancel'),
    writes:()=>writes,
    dispose(){service.stopAllExternalEdits();if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir()))throw Error('Unexpected temporary cleanup path');fs.rmSync(root,{recursive:true,force:true});}
  };
}
module.exports={createExternalEditBrowserFixture};

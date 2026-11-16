import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,chmodSync,readFileSync,writeFileSync,lstatSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve,basename} from 'node:path';
import {initializeServiceStorage,verifyServiceStorage} from './service-storage.mjs';
const supported=process.platform==='linux'&&process.getuid?.()===0;
const binding={worker:'worker',bot:'bot',project:'project',desktop:'desktop',workspace:'workspace'};
function fixture(t){
  const root=mkdtempSync(join(tmpdir(),'omb-bound-volume-'));chmodSync(root,0o755);
  t.after(()=>{assert.equal(dirname(resolve(root)),resolve(tmpdir()));assert.ok(basename(root).startsWith('omb-bound-volume-'));rmSync(root,{recursive:true,force:true});});
  return{root,binding,uid:1000};
}

test('bound storage preserves initialized identity and refuses a foreign project',{skip:!supported},t=>{
  const options=fixture(t),paths=initializeServiceStorage(options),before=readFileSync(join(options.root,'.mausbot-worker.json'),'utf8');
  assert.equal(lstatSync(paths.cwd).uid,1000);assert.equal(lstatSync(join(options.root,'authority')).mode&0o777,0o700);
  assert.deepEqual(initializeServiceStorage(options),paths);
  assert.throws(()=>verifyServiceStorage({...options,binding:{...binding,project:'foreign'}}),/Foreign/);
  assert.equal(readFileSync(join(options.root,'.mausbot-worker.json'),'utf8'),before);
});

test('storage initialization refuses existing unbound data',{skip:!supported},t=>{
  const options=fixture(t);writeFileSync(join(options.root,'retain.txt'),'retain');
  assert.throws(()=>initializeServiceStorage(options),/nonempty/);assert.equal(readFileSync(join(options.root,'retain.txt'),'utf8'),'retain');
});

test('storage verification refuses unsafe ownership instead of repairing it',{skip:!supported},t=>{
  const options=fixture(t),paths=initializeServiceStorage(options);chmodSync(paths.cwd,0o777);
  assert.throws(()=>initializeServiceStorage(options),/ownership mismatch/);assert.equal(lstatSync(paths.cwd).mode&0o777,0o777);
});

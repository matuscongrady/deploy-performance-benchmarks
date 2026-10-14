import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {root} from './lib.mjs';

// Run the actual cache CLI in an isolated Git fixture. Hosted deploy commands
// have no local build cache; that must not be described as a clean remote build.
const directory=await mkdtemp(path.join(os.tmpdir(),'hosted-cli-cache-'));
function run(argv){return spawnSync(argv[0],argv.slice(1),{cwd:directory,encoding:'utf8'});}
try{
 await cp(path.join(root,'scripts'),path.join(directory,'scripts'),{recursive:true});
 await cp(path.join(root,'scenarios'),path.join(directory,'scenarios'),{recursive:true});
 await writeFile(path.join(directory,'package.json'),' {"type":"module"}\n');
 await writeFile(path.join(directory,'.gitignore'),'.work/\nresults/\n');
 await mkdir(path.join(directory,'.work'),{recursive:true});
 await writeFile(path.join(directory,'.work/qualification.json'),JSON.stringify({cacheControl:{localPaths:[]}}));
 assert.equal(run(['git','init','--quiet']).status,0);
 assert.equal(run(['git','add','.']).status,0);
 assert.equal(run(['git','-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Initialize native cache fixture']).status,0);
 const argv=[process.execPath,'scripts/cache.mjs','render','--scenario','deploy-node-cli','--app-id','remote-app','--run-id','remote-cli','--qualification','.work/qualification.json'];
 const cli=run([...argv,'--series','cli-existing-cache']);
 assert.equal(cli.status,0,cli.stderr);
 const proof=JSON.parse(await readFile(path.join(directory,'.work/evidence/remote-cli/render/cache-control.json'),'utf8'));
 assert.deepEqual(proof.paths,[]);
 assert.equal(proof.remoteCachesCleared,false);
 assert.equal(proof.reuseObserved,'unknown');
 for(const series of ['clean','cached-source-edit']){
  const result=run([...argv,'--series',series]);
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/cache paths\/native control/);
 }
}finally{await rm(directory,{recursive:true,force:true});}

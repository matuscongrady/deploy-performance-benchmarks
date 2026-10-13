import fs from 'node:fs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
const [repoRoot]=process.argv.slice(2);
if(!repoRoot)throw Error('Usage: node providers/package-sst.mjs REPO_ROOT');
const cache=path.resolve(repoRoot,'.work/sst-native');
const provenance=JSON.parse(await readFile(path.join(cache,'bridge.json'),'utf8'));
const body=await readFile(path.join(cache,'archive-body.js'),'utf8');
if(createHash('sha256').update(body).digest('hex')!==provenance.archiveBodySha)throw Error('Native archive body checksum mismatch');
if(createHash('sha256').update(await readFile(path.join(cache,'source/native-package'))).digest('hex')!==provenance.binarySha)throw Error('Compiled native runtime checksum mismatch');
const inputs=JSON.parse(await readFile('sst-build-inputs.json','utf8'));
const key=process.env.SST_PACKAGE_ENCRYPTION_KEY;
if(!key || Buffer.from(key,'base64').length!==32)throw Error('SST_PACKAGE_ENCRYPTION_KEY must provide the app encryption key for native artifact parity. For local checks only, a public test key can be used; it cannot qualify deployed byte parity.');
for(const input of inputs)input.encryptionKey=key;
const require=createRequire(path.resolve(repoRoot,'providers/tools/sst/package.json'));
const archiver=require('archiver');const {glob}=require('glob');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
// The code below is extracted verbatim from the checksum-verified release.
const nativeArchive=new AsyncFunction('fs','path','archiver','glob','bundle','zipPath','sourcemaps','dev','copyFiles','wrapper',body);
const capture=path.resolve('package-artifacts');await mkdir(capture,{recursive:true});
const child=spawn(path.join(cache,'source/native-package'),[],{cwd:process.cwd(),env:process.env,stdio:['pipe','pipe','inherit']});
const finished=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('Pinned SST native function runtime failed')));});
finished.catch(()=>{});
child.stdin.on('error',()=>{});
child.stdin.end(JSON.stringify(inputs));
const jobs=[],seen=new Set();
try{
 for await(const line of createInterface({input:child.stdout})){
  const {index,output}=JSON.parse(line);
  if(!Number.isInteger(index)||!inputs[index]||seen.has(index))throw Error('Unexpected native build output');
  seen.add(index);
  // Match the native dependency graph: archive each function immediately after its build completes.
  const job=(async()=>{
   const zipPath=path.join(capture,inputs[index].functionID+'.zip');
   await nativeArchive(fs,path,archiver,glob,output.out,zipPath,output.sourcemaps,false,[],undefined);
   const bytes=await readFile(zipPath);
   const name=inputs[index].functionID;
   const code={name,role:'function',handler:output.handler,module:output.handler.slice(0,output.handler.lastIndexOf('.'))+'.mjs',runtime:'nodejs22.x',path:zipPath,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
   const sourceMaps=[];
   for(const source of output.sourcemaps||[]) {
     const file=path.resolve(source),relative=path.relative(process.cwd(),file);
     if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Native source map is outside the generated project');
     const raw=await readFile(file);
     sourceMaps.push({name,role:'source-map',path:file,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex'),uploadedSeparately:true,nativeUpload:'SST Function createCode uploads each Runtime.BuildOutput.sourcemaps file outside the code ZIP'});
   }
   return [code,...sourceMaps];
  })();
  // Register a handler immediately so an archive failure is not an unhandled rejection.
  job.catch(()=>child.kill());jobs.push(job);
 }
 await finished;
 if(seen.size!==inputs.length)throw Error('Native SST build output count mismatch');
}catch(error){child.kill();await Promise.allSettled(jobs);await finished.catch(()=>{});throw error;}
const artifacts=(await Promise.all(jobs)).flat().sort((a,b)=>inputs.findIndex(i=>i.functionID===a.name)-inputs.findIndex(i=>i.functionID===b.name));
const codeBytes=artifacts.filter(a=>a.role!=='source-map').reduce((n,a)=>n+a.bytes,0),sourceMapBytes=artifacts.filter(a=>a.role==='source-map').reduce((n,a)=>n+a.bytes,0);
await writeFile(path.join(capture,'manifest.json'),JSON.stringify({provider:'sst',sourceRoot:path.dirname(path.dirname(inputs[0].handler)),method:'pinned upstream runtime Collection.Build plus verbatim native Function archive body; no deploy/publish',qualificationRequired:true,encryptionKeySource:'environment; value not recorded',provenance,artifacts,sourceCommit:process.env.BENCH_SOURCE_COMMIT,runId:process.env.BENCH_RUN_ID,totalCompressedBytes:codeBytes,codeBytes,sourceMapBytes,totalUploadBytes:codeBytes+sourceMapBytes},null,2)+'\n');
console.log(JSON.stringify({artifacts:artifacts.length,totalCompressedBytes:codeBytes,sourceMapBytes,totalUploadBytes:codeBytes+sourceMapBytes}));

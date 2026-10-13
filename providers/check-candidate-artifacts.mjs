import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,utimes,copyFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {observeCandidateArtifacts} from './candidate-artifacts.mjs';
import {collectArtifacts,verifyImportedLambda} from '../scripts/sizes.mjs';

const project=await mkdtemp(path.join(os.tmpdir(),'native-archive-binding-'));
const observer=new URL('./candidate-artifacts.mjs',import.meta.url).pathname;
const attempt={provider:'candidate',runId:'attempt-current',sourceCommit:'a'.repeat(40),startedAt:'2026-10-13T12:00:00.000Z',commandFinishedAt:'2026-10-13T12:00:02.000Z'};
const fresh=new Date('2026-10-13T12:00:01.000Z'),old=new Date('2026-10-13T11:59:59.000Z');
const nativeRoot='.native-output',invocation='current';
const zipPath=kind=>`${nativeRoot}/${invocation}/build/${kind==='layer'?'layers/layer-1.zip':'lambdas/productLookup-'+ 'b'.repeat(40)+'.zip'}`;
const spec={qualified:true,format:'lambda-zip',functionCount:1,files:[{name:'product-lookup',resourceName:'productLookup',role:'function',path:zipPath('function'),handler:'index.handler',module:'index.js'},{name:'layer-1',role:'layer',path:zipPath('layer')}]};
async function archive(relative,when=fresh){const absolute=path.join(project,relative);await mkdir(path.dirname(absolute),{recursive:true});const made=spawnSync('python3',['-c','import sys,zipfile; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("index.js","exports.handler=()=>({revision: \'current\'})"); z.close()',absolute],{encoding:'utf8'});assert.equal(made.status,0,made.stderr);await utimes(absolute,when,when);}
try {
 await mkdir(path.join(project,'app/handlers'),{recursive:true});await writeFile(path.join(project,'app/handlers/product-lookup.mjs'),'export function handler(){return {revision:"current"}}');
 await writeFile(path.join(project,'candidate.yml'),JSON.stringify({resources:{productLookup:{type:'function',properties:{packaging:{type:'js-bundle',properties:{entryfilePath:'app/handlers/product-lookup.mjs'}}}}}}));
 await writeFile(path.join(project,'qualification.json'),JSON.stringify(spec));
 await archive(zipPath('function'));await archive(zipPath('layer'));
 const options={project,qualifiedFile:path.join(project,'qualification.json'),attempt};
 const observed=await observeCandidateArtifacts(options);assert.equal(observed.files.length,2);assert.equal(observed.files[0].name,'product-lookup');assert.equal(observed.files[0].resourceName,'productLookup');assert.equal(observed.inputs[0].entry,'app/handlers/product-lookup.mjs');assert.equal(observed.files[0].bytes,(await stat(path.join(project,zipPath('function')))).size);
 const contract={...spec,nativeManifest:{argv:[process.execPath,observer,'--qualified','qualification.json']}};
 const collected=await collectArtifacts(contract,project,attempt);assert.equal(collected.proofs.length,1);assert.equal(collected.bytes,collected.files.reduce((n,f)=>n+f.bytes,0));assert.deepEqual(JSON.parse(await readFile(path.join(project,collected.proofs[0].path),'utf8')),collected.nativeManifest);
 // A real CLI producer must reject stale files, omitted layers and another current invocation.
 await utimes(path.join(project,zipPath('function')),old,old);await assert.rejects(collectArtifacts(contract,project,attempt),/observer failed/);await utimes(path.join(project,zipPath('function')),fresh,fresh);
 await rm(path.join(project,zipPath('layer')));await assert.rejects(observeCandidateArtifacts(options),/archive count/);await archive(zipPath('layer'));
 await archive(`${nativeRoot}/other/build/lambdas/productLookup-${'c'.repeat(40)}.zip`);await assert.rejects(observeCandidateArtifacts(options),/exactly one/);await rm(path.join(project,nativeRoot,'other'),{recursive:true});
 await writeFile(path.join(project,'qualification.json'),JSON.stringify({...spec,files:[{...spec.files[0],resourceName:'wrong'},spec.files[1]]}));await assert.rejects(observeCandidateArtifacts(options),/resource key/);await writeFile(path.join(project,'qualification.json'),JSON.stringify(spec));
 const fake=async()=>({exitCode:0,stdout:JSON.stringify({...observed,runId:'previous'})});await assert.rejects(collectArtifacts(contract,project,{...attempt,runCommand:fake}),/runId/);
 const omitted=async()=>({exitCode:0,stdout:JSON.stringify({...observed,files:[observed.files[0]]})});await assert.rejects(collectArtifacts(contract,project,{...attempt,runCommand:omitted}),/name\/role\/handler/);
 const evidence=[];for(const file of [...collected.files,...collected.proofs]){file.evidenceFile='retained/'+path.basename(file.path);await mkdir(path.join(project,'retained'),{recursive:true});await copyFile(path.join(project,file.path),path.join(project,file.evidenceFile));evidence.push({file:file.evidenceFile,sha256:file.sha256});}
 const record={...attempt,kind:'package',status:'passed',artifacts:collected,evidence};assert.equal((await verifyImportedLambda(record,{base:project})).bytes,collected.bytes);
 await assert.rejects(verifyImportedLambda({...record,runId:'forged-current'},{base:project}),/current runId/);
 await assert.rejects(verifyImportedLambda({...record,artifacts:{...collected,proofs:[]}},{base:project}),/exactly one retained/);
 console.log('Current native ZIP/layer bindings, CLI observation, stale/ambiguous/missing archive rejection and immutable import proof checks passed. No cloud calls.');
} finally {await rm(project,{recursive:true,force:true});}

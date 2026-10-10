import {readdir,readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {root,scenarios,json,validateRecord} from './lib.mjs';
import {targets} from './revision.mjs';
import {probe} from './probe.mjs';
import {waitForPipeline} from './pipeline-completion.mjs';
import {compressedImage} from './oci-size.mjs';
import {checkQualification} from './qualification.mjs';
import {compareUnchanged} from './component-state.mjs';
import {collectArtifacts} from './sizes.mjs';
const m=await json(path.join(root,'fixtures/manifest.json'));
if(m.lambda)assert.equal(new Set(m.lambda.functions.map(f=>f.name)).size,m.lambda.functions.length);
for(const s of await scenarios()) { const files=await targets(s);assert.equal(files.length,s.functions|| (s.fixture==='five-services'?3:1));for(const f of files)assert.ok((await readFile(path.join(root,f),'utf8')).toLowerCase().includes('revision'));}
assert.throws(()=>validateRecord({schemaVersion:1,kind:'deploy',status:'passed'}));
const attempted={schemaVersion:1,kind:'deploy',status:'passed',scenario:'deploy-five-services-cli',provider:'candidate',runId:'fake-run',sourceCommit:'a'.repeat(40),startedAt:'2026-10-10T12:00:00.000Z',finishedAt:'2026-10-10T12:00:01.000Z',durationMs:1000,toolVersion:'test',environment:{},cacheEvidence:{},evidence:[{file:'fake',sha256:'b'.repeat(64)}],readiness:{verified:true,observations:[]}};
assert.throws(()=>validateRecord(attempted),/unchanged native component|observations/);
if((await scenarios()).some(s=>s.id==='package-lambda-25'))await assert.rejects(checkQualification({scenario:'package-lambda-25',provider:'cdk',approved:true,toolVersion:{reported:'test'},environment:{region:'eu-west-1'},cacheEvidence:{series:'clean'},qualificationEvidence:[{}],artifacts:{qualified:true,format:'lambda-zip',functionCount:1,files:[{name:'report',path:'report.zip'}]}},await (await import('./lib.mjs')).scenarioById('package-lambda-25'),'cdk'),/every selected/);
const old=[{name:'inventory',deploymentId:'same',configurationHash:'same',artifactIds:['digest']},{name:'webhooks',deploymentId:'same',configurationHash:'same',artifactIds:['digest']}];assert.equal(compareUnchanged(old,old).verified,true);assert.throws(()=>compareUnchanged(old,old.map(s=>({...s,deploymentId:'replaced'}))),/replaced/);
const blob=(n,size,mediaType)=>({digest:'sha256:'+String(n).repeat(64),size,mediaType});const manifest={config:blob(1,100,'application/vnd.oci.image.config.v1+json'),layers:[blob(2,1000,'application/vnd.oci.image.layer.v1.tar+gzip')]};assert.equal(compressedImage(manifest,JSON.stringify(manifest)).bytes,1100);assert.throws(()=>compressedImage({...manifest,layers:[blob(2,1000,'application/vnd.oci.image.layer.v1.tar')]},'raw'),/compressed/);

const pipelineState=status=>({argv:[process.execPath,'--input-type=module','-e','console.log(JSON.stringify('+JSON.stringify({sourceCommit:'a'.repeat(40),status,runId:'native-run-1'})+'))']});
assert.equal((await waitForPipeline(pipelineState('succeeded'),'a'.repeat(40),{timeoutMs:3000})).verified,true);
await assert.rejects(waitForPipeline(pipelineState('failed'),'a'.repeat(40),{timeoutMs:3000}),/pipeline failed/);
await assert.rejects(waitForPipeline(pipelineState('succeeded'),'b'.repeat(40),{timeoutMs:3000}),/different source commit/);
const temp=await mkdtemp(path.join(os.tmpdir(),'bench-check-'));
const server=createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.method==='POST'){let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>res.end(JSON.stringify({revision:JSON.parse(body).revision,total:'33.00',nested:{okay:true}})));}else res.end(JSON.stringify({revision:'old-version'}));});
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/business`;
  assert.equal((await probe([{name:'api',url,method:'POST',body:{revision:'trial-001'},expected:{revision:'trial-001',total:'33.00',nested:{okay:true}}}],{timeoutMs:3000})).verified,true);
  await assert.rejects(probe([{name:'api',url,expected:{revision:'trial-001'}}],{timeoutMs:20,intervalMs:1}),/not ready/);
  await writeFile(path.join(temp,'bundle.js'),'export const result = 1;');
  await assert.rejects(collectArtifacts({qualified:true,format:'lambda-zip',functionCount:1,files:[{path:'bundle.js'}]},temp),/actual ZIP/);
  await assert.rejects(collectArtifacts({qualified:true,format:'oci-compressed',files:[{path:'bundle.js'}]},temp),/qualified complete/);
} finally {await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
const check=spawnSync(process.execPath,['fixtures/check.mjs',...process.argv.slice(2)],{cwd:root,stdio:'inherit'});if(check.error)throw check.error;if(check.status!==0)process.exit(check.status||1);
console.log('Scenario edits, business readiness and artifact rejection checks passed. No cloud requests.');

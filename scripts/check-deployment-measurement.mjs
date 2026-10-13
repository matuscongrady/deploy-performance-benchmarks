import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {measureDeployment} from './deployment-timer.mjs';
import {probe} from './probe.mjs';
import {command,saveResult,sha256,validateRecord,root,json} from './lib.mjs';
import {checkQualification} from './qualification.mjs';
import {checkPredecessorRecord,readPredecessor,observeCurrentPredecessor,bindPredecessor,verifyImportedPredecessor} from './git-predecessor.mjs';

const temp=await mkdtemp(path.join(os.tmpdir(),'deployment-measurement-'));
let deployed='old';
const server=createServer((_,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({revision:deployed,total:'33.00'}));});
try {
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const url=`http://127.0.0.1:${server.address().port}/business`;
 const specs=[{name:'api',url,expected:{revision:'new',total:'33.00'}}];
 const file=path.join(temp,'ready');
 const slow=await measureDeployment({
  runNative:async()=>{
   const result=await command([process.execPath,'-e',`const fs=require('fs');setTimeout(()=>fs.writeFileSync(${JSON.stringify(file)},'new'),40);setTimeout(()=>process.exit(0),550)`]);
   return {passed:result.exitCode===0,finishedAt:result.finishedAt,durationMs:result.durationMs};
  },
  probeReady:async signal=>{
   const timer=setInterval(async()=>{if(await readFile(file,'utf8').catch(()=>null)==='new')deployed='new';},5);
   try{return await probe(specs,{signal,timeoutMs:2000,intervalMs:5});}finally{clearInterval(timer);}
  }
 });
 assert.equal(slow.status,'passed');
 assert.ok(slow.durationMs<slow.completion.durationMs-250,'CLI cleanup/native wait extended the readiness timer');
 assert.ok(Date.parse(slow.finishedAt)<Date.parse(slow.completion.finishedAt));
 assert.equal(slow.readiness.observations[0].observed.revision,'new');
 // Readiness before a subsequent native failure remains an observed failed attempt, never an admitted success.
 const lateFailure=await measureDeployment({runNative:async()=>{await new Promise(r=>setTimeout(r,40));return {passed:false,failure:'late native failure'};},probeReady:signal=>probe(specs,{signal,timeoutMs:2000,intervalMs:5})});
 assert.equal(lateFailure.readiness.verified,true);assert.equal(lateFailure.status,'failed');assert.equal(lateFailure.failure,'late native failure');
 // A never-ready probe is stopped by native failure rather than waiting for its entire timeout.
 deployed='old';const failureStart=performance.now();
 const failed=await measureDeployment({runNative:async()=>{await new Promise(r=>setTimeout(r,20));return {passed:false,failure:'native failed'};},probeReady:signal=>probe(specs,{signal,timeoutMs:60000,intervalMs:5000})});
 assert.equal(failed.status,'failed');assert.equal(failed.readiness.verified,false);assert.ok(performance.now()-failureStart<500);
 // Command-based probes must also be interrupted without leaving their subprocess alive.
 const cancelled=await measureDeployment({runNative:async()=>{await new Promise(r=>setTimeout(r,30));throw Error('spawn/native failure');},probeReady:signal=>probe([{name:'worker',argv:[process.execPath,'-e','setInterval(()=>{},1000)'],expected:{revision:'new'}}],{signal,timeoutMs:60000,intervalMs:5000})});
 assert.equal(cancelled.status,'failed');assert.equal(cancelled.failure,'spawn/native failure');
 const manifest=await json(path.join(root,'fixtures/manifest.json'));
 const all=await json(path.join(root,'scenarios/index.json'));
 const selected=all.scenarios.find(s=>s.kind==='deploy')||{...all.scenarios[0],kind:'deploy',journey:'cli'};
 const sourceComponents=selected.fixture.startsWith('lambda-')?manifest.lambda.functions.filter(f=>manifest.lambda.workloads.find(w=>w.id===selected.fixture).functions.includes(f.name)):selected.fixture==='five-services'?manifest.fiveServices.services:[{name:'api',...manifest.containers.find(c=>c.id==='container-'+selected.fixture)}];
 const sourceProbes=await Promise.all(sourceComponents.map(async c=>({name:c.name,expected:{...(c.probe||c.businessProbe).expected,revision:(await readFile(path.join(root,c.revisionFile),'utf8')).match(/(?:revision|REVISION)\s*=\s*(['"])([a-z0-9-]+)\1/)[2]}})));
 const sourceQ={scenario:selected.id,provider:'cdk',approved:true,toolVersion:{reported:'test'},environment:{region:'eu-west-1'},cacheEvidence:{series:'cli-existing-cache'},qualificationEvidence:[{}],probes:sourceProbes,baselineProbes:sourceProbes.map(p=>({...p,expected:{...p.expected,revision:selected.fixture==='five-services'&&!manifest.fiveServices.changedServices.includes(p.name)?p.expected.revision:'previous-version'}})),componentSnapshots:Array.from({length:5},()=>({}))};
 await checkQualification(sourceQ,selected,'cdk',{sourceBound:true});
 const forgedSource=structuredClone(sourceQ);forgedSource.probes[0].expected.revision='forged-source-revision';
 await assert.rejects(checkQualification(forgedSource,selected,'cdk',{sourceBound:true}),/differs from the selected source/);
 // A later checkout must still be able to import historical, separately bound results.
 await checkQualification(forgedSource,selected,'cdk');
 const now=Date.now(),source='a'.repeat(40),next='b'.repeat(40),provider='render',appId='neutral-app',stage='bench',branch='trial/node-render-001';
 const completion={verified:true,status:'succeeded',sourceCommit:source,runId:'native-previous'};
 const identity={runId:'repeat-001',sourceCommit:next,scenario:'deploy-node-git-repeat',provider,appId};
 const oldIdentity={...identity,runId:'first-001',sourceCommit:source,scenario:'deploy-node-git-cold',series:'git-cold'};
 const native={status:'passed',...oldIdentity,nativeRunId:completion.runId,runner:{host:'native'},cache:{restored:false}};
 await saveResult(path.join(temp,'native.json'),native);
 const cache={schemaVersion:1,mode:'hosted',...oldIdentity,runner:native.runner,cache:native.cache,completion,nativeEvidence:{file:'native.json',sha256:await sha256(path.join(temp,'native.json'))}};
 await saveResult(path.join(temp,'cache.json'),cache);
 const cacheEvidence={...cache,proofFile:'cache.json',proofSHA:await sha256(path.join(temp,'cache.json'))};
 const readiness={verified:true,observations:[{name:'api',expected:{revision:'old',total:'33.00'},observed:{revision:'old',total:'33.00'},observedAt:new Date(now-1200000).toISOString()}]};
 const previous={schemaVersion:1,kind:'deploy',status:'passed',scenario:oldIdentity.scenario,provider,appId,stage,runId:oldIdentity.runId,sourceCommit:source,startedAt:new Date(now-1201000).toISOString(),finishedAt:new Date(now-1200000).toISOString(),admittedAt:new Date(now-1100000).toISOString(),durationMs:1000,toolVersion:{reported:'test'},environment:{region:'eu-west-1'},readiness,cacheEvidence,pipeline:{branch},pipelineCompletion:{...completion,verifiedAt:new Date(now-1150000).toISOString()},postCompletionReadiness:{verified:true,observations:readiness.observations.map(o=>({...o,observedAt:new Date(now-1120000).toISOString()}))},evidence:[{file:'cache.json',sha256:cacheEvidence.proofSHA}]};
 await saveResult(path.join(temp,'previous.json'),previous);
 const binding={file:'previous.json',sha256:await sha256(path.join(temp,'previous.json')),record:previous,sourceLineage:{verified:true,ancestorSourceCommit:source,sourceCommit:next}};
 const q={stage,environment:previous.environment,pipeline:{branch,engine:'hosted',currentDeployment:{argv:['native-read-only-observer']}},baselineProbes:readiness.observations.map(o=>({name:o.name,expected:o.expected})),predecessor:binding};
 const ancestry=async()=>({exitCode:0});
 assert.equal((await readPredecessor(q,identity,{base:temp,runCommand:ancestry,now})).record.runId,previous.runId);
 const latest=()=>({exitCode:0,stdout:JSON.stringify({latest:true,status:'succeeded',sourceCommit:source,runId:completion.runId,finishedAt:previous.admittedAt})});
 const current=await observeCurrentPredecessor(q,binding,{base:temp,runCommand:latest});
 for(const altered of [undefined,{...binding,sha256:'0'.repeat(64)},{...binding,record:{...previous,appId:'wrong-app'}},{...binding,record:{...previous,admittedAt:new Date(now-10000).toISOString()}}])assert.throws(()=>checkPredecessorRecord(altered,q,identity,now));
 await assert.rejects(readPredecessor({...q,predecessor:undefined,previousReadyAt:new Date(now-1200000).toISOString()},identity,{base:temp,runCommand:ancestry,now}),/predecessor/);
 await assert.rejects(readPredecessor(q,identity,{base:temp,runCommand:async()=>({exitCode:1}),now}),/ancestor/);
 for(const change of [{appId:'other-app'},{provider:'ravion'},{sourceCommit:source},{scenario:'deploy-python-git-repeat'}])assert.throws(()=>checkPredecessorRecord(binding,q,{...identity,...change},now),/same application/);
 assert.throws(()=>checkPredecessorRecord(binding,{...q,stage:'wrong'},identity,now),/same application/);
 assert.throws(()=>checkPredecessorRecord(binding,{...q,previousReadyAt:new Date(now-1300000).toISOString()},identity,now),/previousReadyAt/);
 assert.throws(()=>checkPredecessorRecord(binding,{...q,baselineProbes:[{name:'api',expected:{revision:'stale'}}]},identity,now),/Baseline probes/);
 await assert.rejects(observeCurrentPredecessor(q,binding,{base:temp,runCommand:async()=>({exitCode:0,stdout:JSON.stringify({latest:true,status:'succeeded',sourceCommit:'c'.repeat(40),runId:'old-success'})})}),/latest/);
 await assert.rejects(observeCurrentPredecessor({...q,pipeline:{branch,engine:'hosted'}},binding,{base:temp,runCommand:latest}),/latest native/);
 await assert.rejects(observeCurrentPredecessor(q,binding,{base:temp,runCommand:async()=>({exitCode:0,stdout:JSON.stringify({latest:true,status:'succeeded',sourceCommit:source,runId:completion.runId,finishedAt:new Date().toISOString()})})}),/idle for 15/);
 const startedAt=new Date().toISOString();
 const predecessor=await bindPredecessor({binding,q,identity,nativeCurrent:current,baseline:readiness,startedAt,base:temp});
 const result={...previous,...identity,startedAt,finishedAt:new Date(Date.parse(startedAt)+1000).toISOString(),admittedAt:new Date(Date.parse(startedAt)+2000).toISOString(),pipeline:{branch},postCompletionReadiness:{verified:true,observations:readiness.observations.map(o=>({...o,observedAt:new Date(Date.parse(startedAt)+1800).toISOString()}))},pipelineCompletion:{...completion,sourceCommit:next,runId:'new-run',verifiedAt:new Date(Date.parse(startedAt)+1500).toISOString()},cacheEvidence:{...cacheEvidence,...identity,predecessor,completion:{...completion,sourceCommit:next,runId:'new-run'}},predecessor,evidence:[{file:cacheEvidence.proofFile,sha256:cacheEvidence.proofSHA},{file:predecessor.proofFile,sha256:predecessor.proofSHA}]};
 validateRecord(result);
 assert.throws(()=>validateRecord({...result,postCompletionReadiness:undefined}),/after native terminal/);
 assert.throws(()=>validateRecord({...result,postCompletionReadiness:{verified:true,observations:[{...result.postCompletionReadiness.observations[0],observed:{revision:'rolled-back'}}]}}),/after native terminal/);
 await verifyImportedPredecessor(result,{base:temp});
 assert.throws(()=>validateRecord({...result,predecessor:undefined}),/immutable predecessor/);
 assert.throws(()=>validateRecord({...result,predecessor:{...predecessor,sourceLineage:undefined}}),/ancestry/);
 assert.throws(()=>validateRecord({...result,predecessor:{...predecessor,idleIntervalMs:999999999}}),/idle interval/);
 assert.throws(()=>validateRecord({...result,cacheEvidence:{...result.cacheEvidence,predecessor:undefined}}),/immutable cache proof/);
 await assert.rejects(verifyImportedPredecessor({...result,predecessor:{...predecessor,sha256:'f'.repeat(64)}},{base:temp}),/immutable proof/);
 await writeFile(path.join(temp,'previous.json'),JSON.stringify({...previous,status:'failed'},null,2)+'\n');
 await assert.rejects(verifyImportedPredecessor(result,{base:temp}),/checksum/);
 console.log('Concurrent CLI readiness, native failure cancellation and bound repeat predecessor regressions passed. No cloud requests.');
} finally {await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}

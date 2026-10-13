#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import {mkdir} from 'node:fs/promises';
import {root,json,saveResult,refuseExistingResult,scenarioById,parseArgs,safeId,command,sha256,validateRecord,requireGitCacheObserver,bindGitCacheEvidence,finishGitVerification} from './lib.mjs';
import {checkQualification} from './qualification.mjs';
import {measureDeployment} from './deployment-timer.mjs';
import {readPredecessor,observeCurrentPredecessor,bindPredecessor} from './git-predecessor.mjs';
import {probe} from './probe.mjs';
const {positional,flags}=parseArgs(process.argv.slice(2));
try {
  const [id,provider]=positional,scenario=await scenarioById(id);
  if(!scenario.journey.startsWith('git-')||!scenario.providers.includes(provider))throw Error('Choose a supported Git-push test/provider');
  const runId=safeId(flags['run-id']||'push-'+Date.now());
  const resultFile=path.join(root,'results/raw',runId+'-'+provider+'.json');if(flags.execute)await refuseExistingResult(resultFile);
  const branch=(await command(['git','branch','--show-current'])).stdout.trim();
  if(!/^trial\/[a-z0-9-]+$/.test(branch))throw Error('Make source changes on a neutral trial/... branch first');
  const status=await command(['git','status','--porcelain']);if(status.stdout.trim())throw Error('Commit source changes first');
  const remote=flags.remote||'origin';if(!/^[a-z0-9-]+$/.test(remote))throw Error('Invalid Git remote name');
  const sourceCommit=(await command(['git','rev-parse','HEAD'])).stdout.trim();
  const q=await json(flags.qualification);await checkQualification(q,scenario,provider,{sourceBound:true});
  if(!Array.isArray(q.pipeline?.completion?.argv)||!q.pipeline.completion.argv.length)throw Error('Qualification must bind a native pipeline completion observer');
  requireGitCacheObserver(q);
  if(q.pipeline?.branch!==branch||q.pipeline?.sourceCommit!==sourceCommit||!q.pipeline?.configurationEvidence)throw Error('Qualification must identify the configured trigger branch, commit and workflow/pipeline evidence');
  for(const item of q.qualificationEvidence)if(await sha256(path.resolve(root,item.file))!==item.sha256)throw Error('Qualification evidence checksum mismatch');
  const identity={runId,sourceCommit,scenario:id,provider,appId:q.appId};
  let preceding,nativeCurrent,predecessor;
  if(scenario.journey==='git-repeat')preceding=await readPredecessor(q,identity);
  console.log(JSON.stringify({test:id,provider,sourceCommit,branch,remote,runId},null,2));
  if(!flags.execute){console.log('Prepared only. No push was performed.');process.exit(0);}
  const baseline=await probe(q.baselineProbes,{timeoutMs:30000});
  let componentsBefore;if(scenario.fixture==='five-services'){const {captureComponents}=await import('./component-state.mjs');componentsBefore=await captureComponents(q.componentSnapshots);}
  const dir=path.join(root,'.work',runId,provider);await mkdir(dir,{recursive:true});
  if(preceding)nativeCurrent=await observeCurrentPredecessor(q,preceding);
  const stdoutFile=path.join(dir,'push.stdout.log'),stderrFile=path.join(dir,'push.stderr.log');
  let pushed;
  const measured=await measureDeployment({
    runNative:async()=>{
      pushed=await command(['git','push',remote,`HEAD:refs/heads/${branch}`],{stdoutFile,stderrFile,timeoutMs:120000});
      return {passed:pushed.exitCode===0,failure:pushed.exitCode===0?undefined:'Git push failed',finishedAt:pushed.finishedAt,durationMs:pushed.durationMs};
    },
    probeReady:signal=>probe(q.probes,{timeoutMs:q.timeoutMs||1800000,signal})
  });
  const {startedAt,finishedAt,durationMs,readiness}=measured;
  let statusValue=measured.status,failure=measured.failure;
  if(preceding)predecessor=await bindPredecessor({binding:preceding,q,identity,nativeCurrent,baseline,startedAt});
  let pipelineCompletion,reuse,cacheEvidence,postCompletionReadiness;
  if(statusValue==='passed'){try{
    const {waitForPipeline}=await import('./pipeline-completion.mjs');
    const {captureComponents,compareUnchanged}=await import('./component-state.mjs');
    const verified=await finishGitVerification({wait:()=>waitForPipeline(q.pipeline.completion,sourceCommit,{timeoutMs:q.timeoutMs||1800000}),before:componentsBefore,capture:scenario.fixture==='five-services'?()=>captureComponents(q.componentSnapshots):undefined,compare:compareUnchanged});
    ({pipelineCompletion,reuse}=verified);
    postCompletionReadiness=await probe(q.probes,{timeoutMs:q.timeoutMs||1800000});
    cacheEvidence=await bindGitCacheEvidence({q,identity:{runId,sourceCommit,scenario:id,provider,appId:q.appId,series:q.cacheEvidence.series},completion:pipelineCompletion,predecessor});
  }catch(e){statusValue='failed';failure=e.message;}}
  const admittedAt=new Date().toISOString();
  const completionFile=path.join(dir,'pipeline-completion.json');const {save}=await import('./lib.mjs');await save(completionFile,{pipelineCompletion,postCompletionReadiness,admittedAt,failure});
  const evidence=await Promise.all([stdoutFile,stderrFile,completionFile].map(async file=>({file:path.relative(root,file),sha256:await sha256(file)})));
  if(predecessor)evidence.push({file:predecessor.proofFile,sha256:predecessor.proofSHA});
  if(cacheEvidence)evidence.push({file:cacheEvidence.proofFile,sha256:cacheEvidence.proofSHA},cacheEvidence.nativeEvidence);
  const record={schemaVersion:1,kind:'deploy',scenario:id,provider,runId,appId:q.appId,stage:q.stage,status:statusValue,failure,sourceCommit,startedAt,finishedAt,admittedAt,durationMs,predecessor,commandDurationMs:pushed?.durationMs,baseline,readiness,postCompletionReadiness,reuse,rolloutAdmission:cacheEvidence?.rolloutAdmission,toolVersion:q.toolVersion,timerHost:{host:os.hostname(),platform:os.platform(),node:process.version},environment:{...q.environment,runner:cacheEvidence?.runner,cpu:cacheEvidence?.runner?.cpu,cores:cacheEvidence?.runner?.cores,memoryBytes:cacheEvidence?.runner?.memoryBytes,arch:cacheEvidence?.runner?.arch,node:cacheEvidence?.runner?.node,platform:cacheEvidence?.runner?.platform},settings:q.settings,cacheEvidence,pipeline:q.pipeline,pipelineCompletion,evidence};
  try{validateRecord(record);}catch(e){record.status='failed';record.failure=e.message;validateRecord(record);}await saveResult(resultFile,record);
  console.log(JSON.stringify(record,null,2));if(record.status!=='passed')process.exitCode=1;
} catch(e){console.error(e.message);process.exitCode=1;}

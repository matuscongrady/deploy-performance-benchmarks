#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import {mkdir} from 'node:fs/promises';
import {root,json,saveResult,refuseExistingResult,scenarioById,parseArgs,safeId,command,sha256,validateRecord,requireGitCacheObserver,bindGitCacheEvidence,finishGitVerification} from './lib.mjs';
import {checkQualification} from './qualification.mjs';
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
  const q=await json(flags.qualification);await checkQualification(q,scenario,provider);
  if(!Array.isArray(q.pipeline?.completion?.argv)||!q.pipeline.completion.argv.length)throw Error('Qualification must bind a native pipeline completion observer');
  requireGitCacheObserver(q);
  if(q.pipeline?.branch!==branch||q.pipeline?.sourceCommit!==sourceCommit||!q.pipeline?.configurationEvidence)throw Error('Qualification must identify the configured trigger branch, commit and workflow/pipeline evidence');
  for(const item of q.qualificationEvidence)if(await sha256(path.resolve(root,item.file))!==item.sha256)throw Error('Qualification evidence checksum mismatch');
  if(scenario.journey==='git-repeat') {const previous=Date.parse(q.previousReadyAt);if(!Number.isFinite(previous)||Date.now()-previous<900000)throw Error('The previous verified deployment must have finished at least 15 minutes ago');}
  console.log(JSON.stringify({test:id,provider,sourceCommit,branch,remote,runId},null,2));
  if(!flags.execute){console.log('Prepared only. No push was performed.');process.exit(0);}
  const baseline=await probe(q.baselineProbes,{timeoutMs:30000});
  let componentsBefore;if(scenario.fixture==='five-services'){const {captureComponents}=await import('./component-state.mjs');componentsBefore=await captureComponents(q.componentSnapshots);}
  const dir=path.join(root,'.work',runId,provider);await mkdir(dir,{recursive:true});
  const startedAt=new Date().toISOString(),start=performance.now();
  const stdoutFile=path.join(dir,'push.stdout.log'),stderrFile=path.join(dir,'push.stderr.log');
  const pushed=await command(['git','push',remote,`HEAD:refs/heads/${branch}`],{stdoutFile,stderrFile,timeoutMs:120000});
  let readiness={verified:false},statusValue='passed',failure;
  if(pushed.exitCode!==0){statusValue='failed';failure='Git push failed';}
  else {try{readiness=await probe(q.probes,{timeoutMs:q.timeoutMs||1800000});}catch(e){statusValue='failed';failure=e.message;}}
  const durationMs=performance.now()-start,finishedAt=new Date().toISOString();
  let pipelineCompletion,reuse,cacheEvidence;
  if(statusValue==='passed'){try{
    const {waitForPipeline}=await import('./pipeline-completion.mjs');
    const {captureComponents,compareUnchanged}=await import('./component-state.mjs');
    const verified=await finishGitVerification({wait:()=>waitForPipeline(q.pipeline.completion,sourceCommit,{timeoutMs:q.timeoutMs||1800000}),before:componentsBefore,capture:scenario.fixture==='five-services'?()=>captureComponents(q.componentSnapshots):undefined,compare:compareUnchanged});
    ({pipelineCompletion,reuse}=verified);
    cacheEvidence=await bindGitCacheEvidence({q,identity:{runId,sourceCommit,scenario:id,provider,appId:q.appId,series:q.cacheEvidence.series},completion:pipelineCompletion});
  }catch(e){statusValue='failed';failure=e.message;}}
  const completionFile=path.join(dir,'pipeline-completion.json');const {save}=await import('./lib.mjs');await save(completionFile,{pipelineCompletion,failure});
  const evidence=await Promise.all([stdoutFile,stderrFile,completionFile].map(async file=>({file:path.relative(root,file),sha256:await sha256(file)})));
  if(cacheEvidence)evidence.push({file:cacheEvidence.proofFile,sha256:cacheEvidence.proofSHA},cacheEvidence.nativeEvidence);
  const record={schemaVersion:1,kind:'deploy',scenario:id,provider,runId,appId:q.appId,stage:q.stage,status:statusValue,failure,sourceCommit,startedAt,finishedAt,durationMs,commandDurationMs:pushed.durationMs,baseline,readiness,reuse,rolloutAdmission:cacheEvidence?.rolloutAdmission,toolVersion:q.toolVersion,timerHost:{host:os.hostname(),platform:os.platform(),node:process.version},environment:{...q.environment,runner:cacheEvidence?.runner,cpu:cacheEvidence?.runner?.cpu,cores:cacheEvidence?.runner?.cores,memoryBytes:cacheEvidence?.runner?.memoryBytes,arch:cacheEvidence?.runner?.arch,node:cacheEvidence?.runner?.node,platform:cacheEvidence?.runner?.platform},settings:q.settings,cacheEvidence,pipeline:q.pipeline,pipelineCompletion,evidence};
  try{validateRecord(record);}catch(e){record.status='failed';record.failure=e.message;validateRecord(record);}await saveResult(resultFile,record);
  console.log(JSON.stringify(record,null,2));if(statusValue!=='passed')process.exitCode=1;
} catch(e){console.error(e.message);process.exitCode=1;}

import path from 'node:path';
import {createHash} from 'node:crypto';
import {root,json,sha256,command,validateRecord,validatePredecessorSummary,readCacheEvidence,saveResult} from './lib.mjs';
const hashRecord=record=>createHash('sha256').update(JSON.stringify(record,null,2)+'\n').digest('hex');
const series=scenario=>scenario.replace(/-git-(cold|repeat)$/,'');
function contains(actual,expected) {if(Array.isArray(expected))return Array.isArray(actual)&&actual.length===expected.length&&expected.every((v,i)=>contains(actual[i],v));if(expected&&typeof expected==='object')return actual&&Object.entries(expected).every(([k,v])=>contains(actual[k],v));return actual===expected;}

export function checkPredecessorRecord(binding,q,identity,now=Date.now()) {
  const previous=binding?.record;
  if(!binding?.file||! /^[a-f0-9]{64}$/.test(binding.sha256||'')||!previous||hashRecord(previous)!==binding.sha256)throw Error('Repeat pushes need a checksum-bound preceding result with its exact record');
  validateRecord(previous);
  if(previous.status!=='passed'||previous.kind!=='deploy'||!/-git-(cold|repeat)$/.test(previous.scenario)||series(previous.scenario)!==series(identity.scenario)||previous.provider!==identity.provider||previous.appId!==identity.appId||previous.stage!==q.stage||previous.environment.region!==q.environment.region||previous.pipeline?.branch!==q.pipeline.branch||previous.sourceCommit===identity.sourceCommit)throw Error('Preceding result must be successful, same application/provider/stage/region/source series/branch and a different source commit');
  if(q.environment.accountId&&previous.environment.accountId!==q.environment.accountId)throw Error('Preceding result belongs to a different account');
  const ready=Date.parse(previous.finishedAt),admitted=Date.parse(previous.admittedAt);
  if(!Number.isFinite(admitted)||admitted<ready||now-admitted<900000)throw Error('Repeat pushes require 15 idle minutes after the preceding deployment was admitted');
  if(q.previousReadyAt&&q.previousReadyAt!==previous.finishedAt)throw Error('previousReadyAt differs from the bound predecessor readiness');
  const observed=previous.readiness.observations;
  if(q.baselineProbes.length!==observed.length||q.baselineProbes.some(p=>{const expected=structuredClone(p.expected);if(p.body&&Object.hasOwn(p.body,'jobId'))delete expected.jobId;return !observed.some(o=>o.name===p.name&&contains(o.observed,expected));}))throw Error('Baseline probes differ from the preceding successful business revisions');
  return previous;
}

export async function readPredecessor(q,identity,{base=root,runCommand=command,now=Date.now()}={}) {
  const binding=q.predecessor;
  if(!binding?.file||!binding.sha256)throw Error('Repeat pushes require predecessor.file and predecessor.sha256');
  const file=path.resolve(base,binding.file);
  if(await sha256(file)!==binding.sha256)throw Error('Preceding result checksum mismatch');
  const record=await json(file);
  if(binding.record&&JSON.stringify(binding.record)!==JSON.stringify(record))throw Error('Inline predecessor differs from its saved result');
  const previous=checkPredecessorRecord({...binding,record},q,identity,now);
  const proof=await readCacheEvidence(previous.cacheEvidence.proofFile,previous.cacheEvidence,{base});
  if(proof.proofSHA!==previous.cacheEvidence.proofSHA)throw Error('Preceding cache proof checksum mismatch');
  for(const item of previous.evidence)if(await sha256(path.resolve(base,item.file))!==item.sha256)throw Error('Preceding result evidence checksum mismatch');
  const ancestor=await runCommand(['git','merge-base','--is-ancestor',previous.sourceCommit,identity.sourceCommit],{cwd:base,timeoutMs:30000});
  if(ancestor.exitCode!==0)throw Error('Preceding source must be an ancestor of the new source commit');
  // CI receives the reviewed complete binding in its qualification secret.
  return {...binding,record,sourceLineage:{verified:true,ancestorSourceCommit:previous.sourceCommit,sourceCommit:identity.sourceCommit}};
}

export async function observeCurrentPredecessor(q,binding,{base=root,runCommand=command}={}) {
  let spec=q.pipeline.currentDeployment;
  if(!spec&&q.pipeline.engine==='github-actions') {
    const repository=q.pipeline.repository||binding.record.pipelineCompletion.repository;
    if(!/^[\w.-]+\/[\w.-]+$/.test(repository||''))throw Error('Repeat CI requires the native repository identity');
    spec={argv:[process.execPath,path.join(base,'scripts/github-latest.mjs'),repository,q.pipeline.branch]};
  }
  if(!Array.isArray(spec?.argv)||!spec.argv.length)throw Error('Repeat pushes require a read-only latest native deployment observer');
  const response=await runCommand(spec.argv,{cwd:spec.cwd||base,timeoutMs:30000});
  if(response.exitCode!==0)throw Error('Latest native deployment observer failed');
  let current;try{current=JSON.parse(response.stdout);}catch{throw Error('Latest native deployment observer must return JSON');}
  const previous=binding.record,completion=previous.pipelineCompletion;
  if(current.latest!==true||current.sourceCommit!==previous.sourceCommit||current.status!=='succeeded'||String(current.runId)!==String(completion.runId)||(completion.runAttempt!==undefined&&String(current.runAttempt)!==String(completion.runAttempt)))throw Error('Bound predecessor is not the latest successful native deployment');
  if(!Number.isFinite(Date.parse(current.finishedAt)))throw Error('Latest native deployment observer must report its completion timestamp');
  if(Date.now()-Math.max(Date.parse(previous.admittedAt),Date.parse(current.finishedAt))<900000)throw Error('Latest native deployment has not been idle for 15 minutes');
  return {...current,verified:true,observedAt:new Date().toISOString(),observer:{argv:spec.argv,stdout:response.stdout,stderr:response.stderr,exitCode:response.exitCode}};
}


export async function bindPredecessor({binding,q,identity,nativeCurrent,baseline,startedAt,base=root}) {
  const previous=checkPredecessorRecord(binding,q,identity,Date.parse(startedAt));
  if(binding.sourceLineage?.verified!==true||binding.sourceLineage.ancestorSourceCommit!==previous.sourceCommit||binding.sourceLineage.sourceCommit!==identity.sourceCommit)throw Error('Repeat predecessor source ancestry was not verified before pushing');
  if(!baseline?.verified)throw Error('Repeat baseline was not verified');
  const idleStartedAt=new Date(Math.max(Date.parse(previous.admittedAt),Date.parse(nativeCurrent.finishedAt))).toISOString();
  if(Date.parse(startedAt)-Date.parse(idleStartedAt)<900000)throw Error('Latest native deployment has not been idle for 15 minutes');
  const summary={verified:true,sourceLineage:binding.sourceLineage,file:binding.file,sha256:binding.sha256,runId:previous.runId,scenario:previous.scenario,provider:previous.provider,appId:previous.appId,stage:previous.stage,region:previous.environment.region,branch:previous.pipeline.branch,sourceCommit:previous.sourceCommit,readyAt:previous.finishedAt,admittedAt:previous.admittedAt,idleStartedAt,idleIntervalMs:Date.parse(startedAt)-Date.parse(idleStartedAt),nativeRunId:previous.pipelineCompletion.runId,nativeCurrent};
  const proofFile=path.join(base,'.work/evidence',identity.runId,identity.provider,'predecessor.json');
  await saveResult(proofFile,{schemaVersion:1,...identity,startedAt,predecessor:summary,record:previous,baseline});
  return {...summary,proofFile:path.relative(base,proofFile),proofSHA:await sha256(proofFile)};
}

export async function verifyImportedPredecessor(record,{base=root}={}) {
  if(!record.scenario.endsWith('-git-repeat')||record.status!=='passed')return;
  const summary=validatePredecessorSummary(record),file=path.resolve(base,summary.proofFile);
  if(await sha256(file)!==summary.proofSHA)throw Error('Repeat predecessor proof checksum mismatch');
  const proof=await json(file),{proofFile,proofSHA,...expected}=summary;
  if(JSON.stringify(proof.predecessor)!==JSON.stringify(expected)||proof.startedAt!==record.startedAt||proof.sourceCommit!==record.sourceCommit||proof.runId!==record.runId||proof.scenario!==record.scenario||proof.provider!==record.provider||proof.appId!==record.appId)throw Error('Repeat predecessor summary differs from its immutable proof');
  if(await sha256(path.resolve(base,summary.file))!==summary.sha256||hashRecord(proof.record)!==summary.sha256)throw Error('Repeat predecessor saved result checksum mismatch');
  if(JSON.stringify(await json(path.resolve(base,summary.file)))!==JSON.stringify(proof.record))throw Error('Repeat predecessor saved record differs');
  const previous=proof.record;
  const q={stage:record.stage,environment:record.environment,pipeline:record.pipeline,baselineProbes:proof.baseline.observations.map(o=>({name:o.name,expected:o.expected}))};
  checkPredecessorRecord({file:summary.file,sha256:summary.sha256,record:previous},q,record,Date.parse(record.startedAt));
  const previousProof=await readCacheEvidence(previous.cacheEvidence.proofFile,previous.cacheEvidence,{base});
  if(previousProof.proofSHA!==previous.cacheEvidence.proofSHA)throw Error('Predecessor native cache proof checksum mismatch');
  for(const item of previous.evidence)if(await sha256(path.resolve(base,item.file))!==item.sha256)throw Error('Predecessor retained evidence checksum mismatch');
}

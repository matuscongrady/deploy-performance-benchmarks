import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import os from 'node:os';
import {measureDeployment} from './deployment-timer.mjs';
import {retainClockEvidence,validateLocalTiming,verifyImportedClock,elapsedClock} from './clock.mjs';
import {validateRecord,saveMeasuredAttempt,verifyImportedAttempt,validateImportedDeploymentBusiness} from './lib.mjs';
import {summarizeResults} from './results.mjs';

const root=await mkdtemp(path.join(os.tmpdir(),'benchmark-clock-'));
try{
 const clock={clock:elapsedClock,bootId:'12345678-1234-1234-1234-123456789abc',clocksource:'offline-clock',host:'offline',node:process.version};
 // The wall clock moves backwards while first business readiness still takes
 // exactly one second. Delayed native completion stays outside that interval.
 const marks=[{monotonicNs:'1000000000',observedAt:'2026-10-14T01:00:00.500Z'},{monotonicNs:'2000000000',observedAt:'2026-10-14T01:00:00.000Z'},{monotonicNs:'3000000000',observedAt:'2026-10-14T01:00:00.200Z'}];
 const measured=await measureDeployment({clock:{...clock,mark:()=>{assert.ok(marks.length);return marks.shift();}},runNative:async()=>{await new Promise(r=>setTimeout(r,10));return {passed:true};},probeReady:async()=>({verified:true,observations:[{name:'api',expected:{revision:'new',total:'33.00'},observed:{revision:'new',total:'33.00'},observedAt:'2026-10-14T01:00:00Z',observedMonotonicNs:'1900000000'}]})});
 assert.equal(measured.status,'passed');assert.equal(measured.durationMs,1000);assert.equal(measured.timing.quality.wallElapsedMs,-500);assert.equal(measured.timing.quality.wallOffsetChangeMs,-1500);assert.equal(measured.completion.completedMonotonicNs,'3000000000');assert.equal(measured.timing.quality.publicationQualified,false);
 const identity={scenario:'deploy-node-cli',provider:'render',runId:'clock-001',appId:'offline-app',stage:'bench',sourceCommit:'a'.repeat(40)};
 const timing=await retainClockEvidence(measured.timing,identity,{base:root,file:path.join(root,'clock.json')});
 const cacheProof={file:'cache.json',sha256:'b'.repeat(64)};
 const record={schemaVersion:1,kind:'deploy',status:'passed',...identity,startedAt:measured.startedAt,finishedAt:measured.finishedAt,durationMs:measured.durationMs,timing,toolVersion:{reported:'offline'},environment:{region:'offline'},cacheEvidence:{...identity,series:'cli-existing-cache',proofFile:cacheProof.file,proofSHA:cacheProof.sha256},evidence:[timing.proof,cacheProof],readiness:measured.readiness,nativeCompletion:{verified:true,outsideReadinessTimer:true,finishedAt:'2026-10-14T01:00:00.200Z',completedMonotonicNs:measured.completion.completedMonotonicNs,postCompletionReadiness:{verified:true,observations:[{...measured.readiness.observations[0],observedAt:'2026-10-14T00:59:59.900Z',observedMonotonicNs:'4000000000'}]}},commands:[{exitCode:0}],settings:{usual:true}};
 validateRecord(record);await verifyImportedClock(record,{base:root});
 const qualification={probes:[{name:'api',expected:{revision:'new',total:'33.00'}}]};
 // Exercise the same qualification/business admission used by record-managed:
 // correct post-completion output with backwards UTC remains causally later.
 validateImportedDeploymentBusiness(record,qualification);
 const wrongBusiness=structuredClone(record);wrongBusiness.nativeCompletion.postCompletionReadiness.observations[0].observed={revision:'new',total:'0.00'};assert.throws(()=>validateImportedDeploymentBusiness(wrongBusiness,qualification),/post-completion/);
 const staleImport=structuredClone(record);staleImport.nativeCompletion.postCompletionReadiness.observations[0].observedMonotonicNs='2900000000';assert.throws(()=>validateImportedDeploymentBusiness(staleImport,qualification),/post-completion/);
 const legacyImport={...record,timing:undefined};assert.throws(()=>validateImportedDeploymentBusiness(legacyImport,qualification),/post-completion/);
 assert.throws(()=>validateRecord({...record,durationMs:500}),/monotonic timer/);
 const changed=structuredClone(record);changed.timing.end.monotonicNs='2500000000';assert.throws(()=>validateRecord(changed),/original anchors/);
 const wrongBoot=structuredClone(record);wrongBoot.timing.bootId='changed-boot';assert.throws(()=>validateRecord(wrongBoot),/anchors/);
 const forgedDomain=structuredClone(record);forgedDomain.timing.clock='wall-clock';assert.throws(()=>validateRecord(forgedDomain),/anchors/);
 const badProbe=structuredClone(record);badProbe.readiness.observations[0].observedMonotonicNs='900000000';assert.throws(()=>validateRecord(badProbe),/outside/);
 const stalePost=structuredClone(record);stalePost.nativeCompletion.postCompletionReadiness.observations[0].observedMonotonicNs='2900000000';assert.throws(()=>validateRecord(stalePost),/post-completion/);
 const forgedQuality=structuredClone(record);forgedQuality.timing.quality.publicationQualified=true;assert.throws(()=>validateRecord(forgedQuality),/quality/);
 const crossedSource={...record,sourceCommit:'c'.repeat(40)};await assert.rejects(()=>verifyImportedClock(crossedSource,{base:root}),/identity/);
 const changedBoot=structuredClone(record);changedBoot.timing.bootId='12345678-1234-1234-1234-123456789abd';await assert.rejects(()=>verifyImportedClock(changedBoot,{base:root}),/observations/);
 const gitIdentity={...identity,scenario:'deploy-node-git-cold',runId:'git-clock-001'};
 const gitTiming=await retainClockEvidence(measured.timing,gitIdentity,{base:root,file:path.join(root,'git-clock.json')});
 const gitRecord={...record,...gitIdentity,timing:gitTiming,evidence:[gitTiming.proof,cacheProof],cacheEvidence:{...record.cacheEvidence,...gitIdentity,mode:'hosted',series:'git-cold',completion:{runId:'native-001'}},pipelineCompletion:{verified:true,status:'succeeded',runId:'native-001',sourceCommit:identity.sourceCommit,verifiedAt:'2026-10-14T01:00:00.200Z',observedMonotonicNs:'3000000000'},postCompletionReadiness:record.nativeCompletion.postCompletionReadiness,admittedAt:'2026-10-14T00:59:59.850Z',admittedMonotonicNs:'5000000000'};
 validateRecord(gitRecord);await verifyImportedClock(gitRecord,{base:root});
 const failedPipeline=structuredClone(gitRecord);failedPipeline.pipelineCompletion.status='failed';assert.throws(()=>validateRecord(failedPipeline),/pipeline completion/);
 const badGitAfter=structuredClone(gitRecord);badGitAfter.postCompletionReadiness.observations[0].observedMonotonicNs='2900000000';assert.throws(()=>validateRecord(badGitAfter),/after native terminal/);
 const summary=summarizeResults([record])[0];assert.equal(summary.clockPublicationQualified,false);assert.equal(summary.timingPublicationReady,false);assert.equal(summary.medianSeconds,1);
 const sourceEdits=Array.from({length:10},(_,i)=>{
   const sourceCommit=(i+1).toString(16).padStart(40,'0'),nativeSourceCommit=(i+101).toString(16).padStart(40,'0'),runId='source-edit-'+i;
   return {...record,sourceCommit,runId,cacheEvidence:{...record.cacheEvidence,sourceCommit,runId},settings:{mode:'fast',builder:'native',minify:true,configurationSha256:'fixed-effective-config',sourceCommit,originalSourceCommit:sourceCommit,nativeSourceCommit}};
 });
 const sourceSummary=summarizeResults(sourceEdits);assert.equal(sourceSummary.length,1);assert.equal(sourceSummary[0].passed,10);assert.equal(sourceSummary[0].sampleCountEligible,true);assert.equal(sourceSummary[0].publishable,false);assert.equal(sourceSummary[0].operationPublishable,false);assert.equal(sourceSummary[0].buildPublishable,false);
 for(const change of [{minify:false},{configurationSha256:'different-effective-config'},{mode:'full'},{builder:'different-native-builder'}]){
   const variants=sourceEdits.map((r,i)=>i<5?r:{...r,settings:{...r.settings,...change}});const summaries=summarizeResults(variants);assert.equal(summaries.length,2);assert.ok(summaries.every(s=>s.passed===5&&!s.sampleCountEligible));
 }
 // The original attempted payload exists before validation, even when admission
 // throws. Its exact logs, code/native proof and measured interval are preserved.
 const invalid={...record,durationMs:9999};const attemptFile=path.join(root,'attempted-record.json'),resultFile=path.join(root,'result.json');let sawOriginal=false;
 const saved=await saveMeasuredAttempt(resultFile,invalid,{attemptFile,base:root,validate:value=>{sawOriginal=true;assert.deepEqual(JSON.parse(readFileSync(attemptFile,'utf8')),invalid);validateRecord(value);}}).catch(error=>{throw error;});
 assert.equal(sawOriginal,true);assert.equal(saved.status,'unqualified');assert.match(saved.failure,/monotonic/);assert.equal(saved.validationFailure.attemptedStatus,'passed');
 assert.deepEqual(JSON.parse(await readFile(attemptFile,'utf8')),invalid);await verifyImportedAttempt(saved,{base:root});await verifyImportedClock(saved,{base:root});
 const failedSummary=summarizeResults([saved])[0];assert.equal(failedSummary.attempts,1);assert.equal(failedSummary.unqualified,1);assert.equal(failedSummary.passed,0);
 const admissionForged=structuredClone(saved);admissionForged.commands[0].exitCode=1;await assert.rejects(()=>verifyImportedAttempt(admissionForged,{base:root}),/original complete/);
 await assert.rejects(()=>saveMeasuredAttempt(resultFile,record,{attemptFile,base:root}),/already exists/);
 await writeFile(path.join(root,'clock.json'),'{}');await assert.rejects(()=>verifyImportedClock(record,{base:root}),/checksum/);
 const failed={...record,status:'failed',failure:'Native command failed',nativeCompletion:{...record.nativeCompletion,verified:false}};
 const failedSaved=await saveMeasuredAttempt(path.join(root,'failed.json'),failed,{attemptFile:path.join(root,'failed-attempt.json'),base:root});assert.equal(failedSaved.status,'failed');assert.equal(failedSaved.nativeCompletion.verified,false);await verifyImportedAttempt(failedSaved,{base:root});
 const invalidBuild={...record,buildTiming:{verified:true,required:true,campaignId:'invalid-stage-proof'}};
 const retainedBuild=await saveMeasuredAttempt(path.join(root,'invalid-build.json'),invalidBuild,{attemptFile:path.join(root,'invalid-build-attempt.json'),base:root});assert.equal(retainedBuild.status,'unqualified');assert.deepEqual(retainedBuild.buildTiming,invalidBuild.buildTiming);validateRecord(retainedBuild);assert.equal(summarizeResults([retainedBuild])[0].unqualified,1);await verifyImportedAttempt(retainedBuild,{base:root});
 console.log('Monotonic readiness under wall steps, immutable clock identities, tampered proofs, unchanged native/business admission and full failed-attempt retention passed. No cloud requests or clock changes.');
}finally{await rm(root,{recursive:true,force:true});}

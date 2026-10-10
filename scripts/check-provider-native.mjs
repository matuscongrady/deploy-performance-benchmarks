import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {validateRecord,verifyImportedNativePackage,sha256} from './lib.mjs';
import {summarizeResults} from './results.mjs';
const temp=await mkdtemp(path.join(os.tmpdir(),'native-package-check-'));
try {
  const identity={runId:'native-001',sourceCommit:'a'.repeat(40),scenario:'package-node',appId:'sample-app',provider:'render',nativeBuildId:'build-001'};
  const phase={startedAt:'2026-10-10T12:00:00.000Z',finishedAt:'2026-10-10T12:00:01.000Z',status:'succeeded'};
  const businessVerification={verified:true,nativeBuildId:identity.nativeBuildId,sourceCommit:identity.sourceCommit,observations:[{name:'api',observedAt:'2026-10-10T12:00:03.000Z',expected:{revision:'edit-001',total:42},observed:{revision:'edit-001',total:42}}]};
  const proof={schemaVersion:1,...identity,buildPhase:phase,nativeCompletion:{status:'succeeded',nativeBuildId:identity.nativeBuildId,sourceCommit:identity.sourceCommit,finishedAt:'2026-10-10T12:00:02.000Z'},businessVerification};
  await writeFile(path.join(temp,'native.json'),JSON.stringify(proof));
  const evidenceSHA=await sha256(path.join(temp,'native.json'));
  const cacheEvidence={...identity,series:'clean',proofFile:'cache.json',proofSHA:'b'.repeat(64)};
  const record={schemaVersion:1,kind:'package',status:'passed',...identity,startedAt:phase.startedAt,finishedAt:phase.finishedAt,durationMs:1000,toolVersion:{reported:'native-runtime'},environment:{},cacheEvidence,evidence:[{file:'cache.json',sha256:cacheEvidence.proofSHA},{file:'native.json',sha256:evidenceSHA}],artifacts:{complete:true,format:'provider-native',name:'api',bytes:null,sizeAvailable:false,nativeBuild:{...identity,phase,evidenceFile:'native.json',evidenceSHA},businessVerification}};
  assert.equal(validateRecord(record).artifacts.bytes,null);
  assert.equal((await verifyImportedNativePackage(record,{base:temp})).verified,true);
  const change=fn=>{const r=structuredClone(record);fn(r);return r;};
  for(const mutate of [r=>r.provider='cdk',r=>r.scenario='package-lambda-1',r=>r.artifacts.name='other',r=>r.artifacts.bytes=0,r=>r.artifacts.bytes=1,r=>r.artifacts.sizeAvailable=true,r=>r.artifacts.complete=false,r=>r.durationMs=0,r=>r.artifacts.nativeBuild.runId='old-build',r=>r.artifacts.nativeBuild.nativeBuildId='',r=>r.artifacts.nativeBuild.phase.startedAt='2026-10-10T11:59:59.000Z',r=>r.evidence.pop(),r=>r.artifacts.businessVerification.observations[0].observed.total=0,r=>r.artifacts.businessVerification.observations[0].observedAt=phase.startedAt,r=>r.artifacts.businessVerification.observations[0].expected={revision:'edit-001'}])assert.throws(()=>validateRecord(change(mutate)));
  // Coherent summary for a different attempt still cannot reuse the retained native proof.
  await assert.rejects(verifyImportedNativePackage(change(r=>{r.runId='native-002';r.cacheEvidence.runId=r.runId;r.artifacts.nativeBuild.runId=r.runId;}),{base:temp}),/retained|Retained/);
  await assert.rejects(verifyImportedNativePackage(change(r=>{r.artifacts.nativeBuild.nativeBuildId='build-002';r.artifacts.businessVerification.nativeBuildId='build-002';}),{base:temp}),/Retained/);
  await assert.rejects(verifyImportedNativePackage(change(r=>{r.artifacts.businessVerification.observations[0].expected.total=43;r.artifacts.businessVerification.observations[0].observed.total=43;}),{base:temp}),/summary differs/);
  for(const mutate of [p=>p.nativeCompletion.status='failed',p=>p.nativeCompletion.nativeBuildId='old-build',p=>p.nativeCompletion.sourceCommit='c'.repeat(40),p=>p.nativeCompletion.finishedAt=phase.startedAt,p=>p.nativeCompletion.finishedAt='2026-10-10T12:00:04.000Z']){
    const p=structuredClone(proof);mutate(p);await writeFile(path.join(temp,'native.json'),JSON.stringify(p));const digest=await sha256(path.join(temp,'native.json'));const r=change(r=>{r.artifacts.nativeBuild.evidenceSHA=digest;r.evidence.find(e=>e.file==='native.json').sha256=digest;});await assert.rejects(verifyImportedNativePackage(r,{base:temp}),/completion|checks/);
  }
  await assert.rejects(verifyImportedNativePackage(record,{base:temp}),/checksum/);
  const summary=summarizeResults(Array.from({length:10},()=>structuredClone(record)))[0];
  assert.equal(summary.publishable,true);assert.equal(summary.sizePublishable,false);assert.equal(summary.sizeSamples,0);for(const key of ['medianBytes','minBytes','maxBytes'])assert.equal(summary[key],null);
  const measured=change(r=>{r.provider='heroku';r.cacheEvidence.provider='heroku';r.artifacts={format:'heroku-slug',complete:true,bytes:1234};});
  const sized=summarizeResults(Array.from({length:10},()=>structuredClone(measured)))[0];assert.equal(sized.sizePublishable,true);assert.equal(sized.medianBytes,1234);
  console.log('Managed native packaging timing/proof and unavailable-size checks passed.');
} finally {await rm(temp,{recursive:true,force:true});}

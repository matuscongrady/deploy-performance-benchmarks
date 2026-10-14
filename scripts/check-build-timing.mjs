import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {command,sha256,validateRecord} from './lib.mjs';
import {buildScope,buildClock,reviewBuildFiles,captureBuildInputs,collectBuildTiming,verifyImportedBuildTiming,verifyBuildQualificationEvidence,nativeSpan,candidateSpan,validateBuildQualification} from './build-timing.mjs';
import {summarizeResults} from './results.mjs';
import {createBuildTiming,buildTimingDefaults} from '../providers/build-timing.mjs';

const temp=await mkdtemp(path.join(os.tmpdir(),'matched-build-timing-'));
try {
  await mkdir(path.join(temp,'app'));await writeFile(path.join(temp,'app','handler.mjs'),'export function handler(){return "baseline"}');
  await writeFile(path.join(temp,'native.config.json'),'{}\n');await writeFile(path.join(temp,'instrument.mjs'),'export const version=1;');
  const spec={required:true,scope:buildScope,clock:buildClock,campaignId:'matched-test',producer:'native-markers',configurationFiles:['native.config.json'],instrumentationFiles:['instrument.mjs'],qualificationEvidence:[{file:'parity.json',sha256:'f'.repeat(64)}]};
  const identity={provider:'cdk',runId:'build-001',sourceCommit:'a'.repeat(40),appId:'native-app',fixture:'lambda-1',toolVersion:{reported:'pinned'}};
  const reviewed=await reviewBuildFiles({qualification:spec,project:temp,repository:temp});Object.assign(spec,{configurationSha256:reviewed.configurationSha256,instrumentationSha256:reviewed.instrumentationSha256});
  validateBuildQualification({buildTiming:spec},{kind:'package',fixture:'lambda-1'},'cdk');
  assert.throws(()=>validateBuildQualification({buildTiming:{...spec,campaignId:undefined}},{kind:'package',fixture:'lambda-1'},'cdk'),/campaign ID/);
  const input=await captureBuildInputs({qualification:spec,identity,project:temp,repository:temp,file:path.join(temp,'inputs.json')});
  const output=path.join(temp,'report.zip'),nativeFile=path.join(temp,'markers.json');
  // Real child process: startup and post-build delays must stay in the operation clock only.
  const child=`const fs=require('node:fs'),crypto=require('node:crypto');const sleep=ms=>new Promise(r=>setTimeout(r,ms));(async()=>{await sleep(35);const startNs=process.hrtime.bigint().toString();await sleep(25);fs.writeFileSync(${JSON.stringify(output)},'native complete archive');const endNs=process.hrtime.bigint().toString();const bytes=fs.readFileSync(${JSON.stringify(output)});fs.writeFileSync(${JSON.stringify(nativeFile)},JSON.stringify({...${JSON.stringify(identity)},schemaVersion:1,scope:${JSON.stringify(buildScope)},clock:${JSON.stringify(buildClock)},outcome:'ok',configurationSha256:${JSON.stringify(input.manifest.configurationSha256)},inputManifestSha256:${JSON.stringify(input.sha256)},startNs,endNs,markers:[{name:'build:start',monotonicNs:startNs},{name:'artifacts:ready',monotonicNs:endNs}],files:[{name:'report',role:'function',path:'report.zip',nativeOutputPath:'report.zip',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}]}));await sleep(45);})();`;
  const operation={clock:buildClock,startNs:process.hrtime.bigint().toString()};const result=await command([process.execPath,'-e',child],{cwd:temp});operation.endNs=process.hrtime.bigint().toString();assert.equal(result.exitCode,0,result.stderr);
  const original=JSON.parse(await readFile(nativeFile,'utf8'));
  const total=original.files[0].bytes;
  const artifacts={complete:true,format:'lambda-zip',functionCount:1,bytes:total,codeBytes:total,zipBytes:total,sourceMapBytes:0,sizeMetric:'total-application-upload-bytes',files:original.files.map(({nativeOutputPath,...f})=>({...f,evidenceFile:f.path})),businessVerification:{completeZipBusinessProbes:[{name:'report',revision:'baseline'}]}};
  const buildTiming=await collectBuildTiming({spec,identity,input,nativeFile,operation,commands:[result],artifacts,base:temp});
  assert.ok(buildTiming.durationMs>=20&&buildTiming.durationMs<result.durationMs-50);
  const expected={...identity,inputManifestSha256:input.sha256,configurationSha256:input.manifest.configurationSha256,zipArtifactCount:1};
  for(const key of ['provider','runId','sourceCommit','appId','fixture','configurationSha256','inputManifestSha256'])assert.throws(()=>nativeSpan({...original,[key]:'wrong'},expected,operation,artifacts),new RegExp(key));
  assert.throws(()=>nativeSpan({...original,startNs:original.endNs,endNs:original.startNs,markers:[{name:'build:start',monotonicNs:original.endNs},{name:'artifacts:ready',monotonicNs:original.startNs}]},expected,operation,artifacts),/reversed/);
  assert.throws(()=>nativeSpan({...original,markers:[...original.markers,original.markers[0]]},expected,operation,artifacts),/duplicate/);
  assert.throws(()=>nativeSpan({...original,markers:[]},expected,operation,artifacts),/Missing/);
  assert.throws(()=>nativeSpan({...original,endNs:(BigInt(operation.endNs)+1n).toString(),markers:[original.markers[0],{name:'artifacts:ready',monotonicNs:(BigInt(operation.endNs)+1n).toString()}]},expected,operation,artifacts),/outside/);
  assert.throws(()=>nativeSpan({...original,outcome:'error'},expected,operation,artifacts),/failed/);
  assert.throws(()=>nativeSpan({...original,files:[...original.files,{name:'layer',role:'layer',path:'layer.zip',bytes:1,sha256:'b'.repeat(64)}]},expected,operation,artifacts),/complete current/);
  assert.throws(()=>nativeSpan({...original,files:[{...original.files[0],sha256:'b'.repeat(64)}]},expected,operation,artifacts),/complete current/);
  const slsMethods=buildTimingDefaults.serverless.nativeMethodSha256,slsProof={...original,provider:'serverless',details:{frameworkVersion:'4.43.0',methodSha256:slsMethods}},slsExpected={...expected,provider:'serverless',nativeMethodSha256:slsMethods};
  nativeSpan(slsProof,slsExpected,operation,artifacts);assert.throws(()=>nativeSpan({...slsProof,details:{...slsProof.details,methodSha256:{...slsMethods,_build:'f'.repeat(64)}}},slsExpected,operation,artifacts),/lifecycle method differs/);
  const cacheEvidence={...identity,scenario:'package-lambda-1',series:'clean',proofFile:'cache.json',proofSHA:'c'.repeat(64)};
  const record={schemaVersion:1,kind:'package',status:'passed',scenario:cacheEvidence.scenario,...identity,startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),durationMs:Number(BigInt(operation.endNs)-BigInt(operation.startNs))/1e6,toolVersion:{reported:'pinned'},environment:{region:'eu-west-1'},cacheEvidence,artifacts,evidence:[{file:cacheEvidence.proofFile,sha256:cacheEvidence.proofSHA},...artifacts.files.map(f=>({file:f.evidenceFile,sha256:f.sha256})),buildTiming.inputEvidence,buildTiming.nativeEvidence],operationTiming:operation,buildTiming,commands:[result]};
  record.finishedAt=new Date(Date.parse(record.startedAt)+record.durationMs).toISOString();validateRecord(record);await verifyImportedBuildTiming(record,{base:temp});
  const boundaryFile=path.join(temp,'boundary-qualification.json');await writeFile(boundaryFile,JSON.stringify({...record,classification:'qualification-only',measuredSamples:0}));
  const reviewedQ={provider:record.provider,appId:record.appId,scenario:record.scenario,toolVersion:record.toolVersion,buildTiming:{...spec,qualificationEvidence:[{file:'boundary-qualification.json',sha256:await sha256(boundaryFile)}]}};await verifyBuildQualificationEvidence(reviewedQ,{base:temp});await assert.rejects(verifyBuildQualificationEvidence({...reviewedQ,buildTiming:{...reviewedQ.buildTiming,nativeMethodSha256:slsMethods}},{base:temp}),/differ from the saved/);
  assert.throws(()=>validateRecord({...record,buildTiming:{...buildTiming,durationMs:1}}),/duration differs/);
  assert.throws(()=>validateRecord({...record,evidence:record.evidence.slice(0,1)}),/original native\/input/);
  await assert.rejects(verifyImportedBuildTiming({...record,sourceCommit:'b'.repeat(40)},{base:temp}),/identity differs/);
  await assert.rejects(verifyImportedBuildTiming({...record,buildTiming:{...buildTiming,campaignId:'forged-campaign'}},{base:temp}),/campaign identity/);
  await writeFile(path.join(temp,'app','handler.mjs'),'changed after native build');await assert.rejects(collectBuildTiming({spec,identity,input,nativeFile,operation,commands:[result],artifacts,base:temp}),/inputs changed/);await writeFile(path.join(temp,'app','handler.mjs'),'export function handler(){return "baseline"}');
  await writeFile(nativeFile,JSON.stringify({...original,runId:'forged'}));await assert.rejects(verifyImportedBuildTiming(record,{base:temp}),/checksum/);await writeFile(nativeFile,JSON.stringify(original));
  // Candidate's original trace uses two shared-clock anchors, not its wall timeOrigin.
  const base=BigInt(operation.startNs)+1000000n;
  const trace={schema:3,kind:'stacktape-cli-timings',clock:'performance.now() milliseconds since performance.timeOrigin',pid:result.pid,exitCode:0,droppedSpans:0,timeOrigin:-999999,exitAt:50,clockAnchors:{init:{monotonicNs:base.toString(),performanceMs:10},exit:{monotonicNs:(base+40000000n).toString(),performanceMs:50}},buildContext:{bindingsSHA256:input.sha256,configurationSHA256:input.manifest.configurationSha256},spans:[{name:'startup',start:10,end:20},{name:'package:build-and-archive',start:20,end:40,detail:{outcome:'ok'}},{name:'zip:archive',start:30,end:39,detail:{format:'zip'}}]};
  const cspan=candidateSpan(trace,operation,[result],expected);assert.equal(cspan.durationMs,20);assert.equal(cspan.startNs,(base+10000000n).toString());
  for(const anchors of [undefined,{init:null,exit:trace.clockAnchors.exit},{init:trace.clockAnchors.init,exit:{...trace.clockAnchors.exit,monotonicNs:(base+80000000n).toString()}}])assert.throws(()=>candidateSpan({...trace,clockAnchors:anchors},operation,[result],expected),/anchors/);
  assert.throws(()=>candidateSpan({...trace,buildContext:undefined},operation,[result],expected),/binding/);
  assert.throws(()=>candidateSpan({...trace,pid:result.pid+1},operation,[result],expected),/different native process/);
  assert.throws(()=>candidateSpan({...trace,spans:[...trace.spans,trace.spans[1]]},operation,[result],expected),/exactly one/);
  for(const span of [{...trace.spans[1],end:null},{...trace.spans[1],end:19},{...trace.spans[1],detail:{outcome:'error'}}])assert.throws(()=>candidateSpan({...trace,spans:[span]},operation,[result],expected),/incomplete/);
  assert.throws(()=>candidateSpan({...trace,droppedSpans:1},operation,[result],expected),/truncated/);
  assert.throws(()=>candidateSpan({...trace,spans:trace.spans.slice(0,2)},operation,[result],expected),/every qualified complete/);
  assert.throws(()=>candidateSpan({...trace,spans:[...trace.spans.slice(0,2),{...trace.spans[2],end:41}]},operation,[result],expected),/every qualified complete/);
  const identitySession={policy:'shared-prewarmed',accountId:'597581086285',expiration:'2026-10-13T23:00:00.000Z'},cachedTrace={...trace,spans:[...trace.spans,{name:'aws:identity',start:10,end:11,detail:{source:'cache',account:identitySession.accountId}}]},cachedExpected={...expected,identitySession};candidateSpan(cachedTrace,operation,[result],cachedExpected);
  assert.throws(()=>candidateSpan({...cachedTrace,spans:[...trace.spans,{name:'aws:identity',start:10,end:11,detail:{source:'sts',account:identitySession.accountId}}]},operation,[result],cachedExpected),/prewarmed identity/);
  assert.throws(()=>candidateSpan({...cachedTrace,spans:[...cachedTrace.spans,{name:'aws:request',start:11,end:12,detail:{operation:'GetCallerIdentityCommand'}}]},operation,[result],cachedExpected),/no STS/);
  const fakeCredential='TEST_CREDENTIAL_NEVER_REAL_123456',secretLog=path.join(temp,'secret.stderr.log');const safe=await command([process.execPath,'-e','process.stderr.write(process.env.AWS_ACCESS_KEY_ID)'],{env:{AWS_ACCESS_KEY_ID:fakeCredential},stderrFile:secretLog});assert.equal(safe.stderr,'<redacted>');assert.equal(await readFile(secretLog,'utf8'),'<redacted>');
  const history={...record,buildTiming:undefined,operationTiming:undefined};assert.equal(summarizeResults([history])[0].buildSamples,0);
  const samples=[];
  for(const provider of ['candidate','serverless','sst','cdk'])for(let i=0;i<10;i++){
    const r=structuredClone(record);r.provider=provider;r.cacheEvidence.provider=provider;r.runId='round-'+i;r.cacheEvidence.runId=r.runId;r.buildTiming.producer=provider==='candidate'?'candidate-trace':'native-markers';if(provider==='serverless')r.buildTiming.nativeMethodSha256=slsMethods;
    if(provider==='sst'){const map={name:'report',role:'source-map',path:'report.map',bytes:1,sha256:'e'.repeat(64),evidenceFile:'report.map',uploadedSeparately:true,sourceMap:{version:3}};r.artifacts.files.push(map);r.evidence.push({file:map.evidenceFile,sha256:map.sha256});r.artifacts.sourceMapBytes=1;r.artifacts.bytes+=1;r.buildTiming.artifactBindings.push({name:map.name,role:map.role,path:map.path,bytes:map.bytes,sha256:map.sha256});r.buildTiming.artifactBindings.sort((a,b)=>`${a.role}/${a.name}/${a.path}`.localeCompare(`${b.role}/${b.name}/${b.path}`,'en'));}samples.push(r);
  }
  assert.ok(summarizeResults(samples).every(r=>r.buildSampleCountEligible&&!r.buildPublishable&&!r.operationPublishable));assert.ok(summarizeResults(samples.slice(0,-1)).every(r=>!r.buildSampleCountEligible));
  const changed=samples.map(r=>r.provider==='sst'?{...r,buildTiming:{...r.buildTiming,campaignId:'different-campaign'}}:r);assert.ok(summarizeResults(changed).every(r=>!r.buildSampleCountEligible));
  const differentSources=samples.map(r=>r.provider==='sst'?{...r,sourceCommit:'d'.repeat(40),cacheEvidence:{...r.cacheEvidence,sourceCommit:'d'.repeat(40)}}:r);assert.ok(summarizeResults(differentSources).every(r=>!r.buildSampleCountEligible));
  const mismatchedRound=samples.map((r,i)=>i===15?{...r,runId:'different-round',cacheEvidence:{...r.cacheEvidence,runId:'different-round'}}:r);assert.ok(summarizeResults(mismatchedRound).every(r=>!r.buildSampleCountEligible));
  for(const status of ['failed','unqualified']){
    const unsuccessful={...record,status,failure:'No successful native trace',artifacts:{complete:false,format:'lambda-zip'},buildTiming:{required:true,verified:false,campaignId:spec.campaignId,scope:buildScope,clock:buildClock,producer:spec.producer,configurationSha256:input.manifest.configurationSha256,instrumentationSha256:input.manifest.instrumentationSha256,inputEvidence:buildTiming.inputEvidence}};
    validateRecord(unsuccessful);await verifyImportedBuildTiming(unsuccessful,{base:temp});
    const summary=summarizeResults([record,{...unsuccessful,runId:'failed-round',cacheEvidence:{...cacheEvidence,runId:'failed-round'}}]);assert.equal(summary.length,1);assert.equal(summary[0].attempts,2);assert.equal(summary[0][status],1);assert.equal(summary[0].buildSamples,1);assert.match(summary[0].test,/matched-test/);
  }
  assert.throws(()=>summarizeResults([record,record]),/Duplicate/);
  const variedProvenance=samples.map((r,i)=>({...r,settings:{...r.settings,sourceCommit:r.sourceCommit,originalSourceCommit:r.sourceCommit,nativeSourceCommit:i.toString(16).padStart(40,'0')}}));
  assert.ok(summarizeResults(variedProvenance).every(r=>r.buildSampleCountEligible&&!r.buildPublishable));
  const mixed=samples.map((r,i)=>i===15?{...r,toolVersion:{reported:'different-version'}}:r);assert.ok(summarizeResults(mixed).every(r=>!r.buildSampleCountEligible));
  // Exercise the actual producer and consumer contract without invoking a provider CLI.
  const project=path.join(temp,'contract');await mkdir(path.join(project,'app'),{recursive:true});await writeFile(path.join(project,'app','source.mjs'),'export const revision="contract";');await writeFile(path.join(project,'app','package-lock.json'),'{}');
  for(const name of buildTimingDefaults.cdk.configurationFiles)await writeFile(path.join(project,name),'{}');
  const contractSpec={...spec,...buildTimingDefaults.cdk},repository=path.resolve(new URL('..',import.meta.url).pathname);
  const contractReviewed=await reviewBuildFiles({qualification:contractSpec,project,repository});Object.assign(contractSpec,{configurationSha256:contractReviewed.configurationSha256,instrumentationSha256:contractReviewed.instrumentationSha256});
  const contractInput=await captureBuildInputs({qualification:contractSpec,identity,project,repository,file:path.join(project,'inputs.json')});
  const contractProof=path.join(project,'native.json');const env={BENCH_PROVIDER:identity.provider,BENCH_RUN_ID:identity.runId,BENCH_SOURCE_COMMIT:identity.sourceCommit,BENCH_APP_ID:identity.appId,BENCH_FIXTURE:identity.fixture,BENCH_BUILD_TIMING_FILE:contractProof,BENCH_BUILD_INPUT_MANIFEST:contractInput.file,BENCH_BUILD_INPUT_MANIFEST_SHA256:contractInput.sha256,BENCH_BUILD_CONFIG_SHA256:contractInput.manifest.configurationSha256};
  const contractOperation={clock:buildClock,startNs:process.hrtime.bigint().toString()},stage=await createBuildTiming('cdk',{cwd:project,env});stage.start();
  await writeFile(path.join(project,'report.zip'),Buffer.from([80,75,3,4,0,0]));stage.finish();const contractNative=await stage.commit([{name:'report',role:'function',path:'report.zip'}]);contractOperation.endNs=process.hrtime.bigint().toString();
  const contractArtifacts={files:contractNative.files};assert.equal((await collectBuildTiming({spec:contractSpec,identity,input:contractInput,nativeFile:contractProof,operation:contractOperation,commands:[],artifacts:contractArtifacts,base:temp})).verified,true);
  await assert.rejects(createBuildTiming('cdk',{cwd:project,env:{...env,BENCH_BUILD_INPUT_MANIFEST_SHA256:'f'.repeat(64)}}),/checksum/);
  console.log('Matched native build clocks: real child delay separation, original trace anchors, lifecycle/source/config/artifact binding, forged imports and all-four publication checks passed. No cloud requests.');
} finally {await rm(temp,{recursive:true,force:true});}

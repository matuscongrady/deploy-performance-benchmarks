import path from 'node:path';
import {readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';

export const buildScope='native-build-and-archive';
export const buildClock='linux-clock-monotonic-nanoseconds';
const hash=b=>createHash('sha256').update(b).digest('hex');
const sha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const relative=p=>typeof p==='string'&&p.length>0&&!path.isAbsolute(p)&&!p.split(/[\\/]/).some(s=>['','..','.'].includes(s));
const ns=s=>{if(typeof s!=='string'||!/^\d+$/.test(s))throw Error('Build timing needs original monotonic nanoseconds');return BigInt(s);};
const identityKeys=['provider','runId','sourceCommit','appId','fixture'];
const sortFiles=files=>files.sort((a,b)=>{const x=`${a.base}/${a.path}`,y=`${b.base}/${b.path}`;return x<y?-1:x>y?1:0;});
export function configurationDigest(files){return hash(JSON.stringify(files.filter(f=>f.role==='configuration')));}
export function instrumentationDigest(files){return hash(JSON.stringify(files.filter(f=>f.role==='instrumentation')));}
function validNativeMethods(methods){return methods&&isDeepStrictEqual(Object.keys(methods).sort(),['_build','_package','_preparePackageJson','_writeArchive'])&&Object.values(methods).every(sha);}
function validIdentitySession(s){return s&&s.policy==='shared-prewarmed'&&/^\d{12}$/.test(s.accountId||'')&&Number.isFinite(Date.parse(s.expiration))&&isDeepStrictEqual(Object.keys(s).sort(),['accountId','expiration','policy']);}

export function validateBuildQualification(q,scenario,provider) {
  if(q.buildTiming===undefined)return;
  const s=q.buildTiming;
  if(s.required!==true||s.scope!==buildScope||s.clock!==buildClock||scenario.kind!=='package'||!scenario.fixture.startsWith('lambda-')||!['candidate','serverless','sst','cdk'].includes(provider))throw Error('Matched build timing is qualified only for the reviewed Lambda packaging recipes');
  if(s.producer!==(provider==='candidate'?'candidate-trace':'native-markers'))throw Error('Wrong matched build timing producer');
  if(!/^[a-z0-9][a-z0-9-]{2,60}$/.test(s.campaignId||''))throw Error('Matched build timing needs one shared reviewed campaign ID');
  if(!sha(s.configurationSha256)||!sha(s.instrumentationSha256))throw Error('Build qualification needs the exact reviewed configuration and instrumentation digests');
  if(provider==='serverless'&&!validNativeMethods(s.nativeMethodSha256))throw Error('Serverless build qualification needs reviewed native 4.43 lifecycle method fingerprints');
  if(s.identitySession!==undefined&&!validIdentitySession(s.identitySession))throw Error('Shared packaging identity needs only its reviewed policy, account and expiration');
  for(const key of ['configurationFiles','instrumentationFiles'])if(!Array.isArray(s[key])||!s[key].length||new Set(s[key]).size!==s[key].length||s[key].some(f=>!relative(f)))throw Error('Build qualification needs reviewed '+key);
  if(!Array.isArray(s.qualificationEvidence)||!s.qualificationEvidence.length||s.qualificationEvidence.some(e=>!relative(e.file)||!sha(e.sha256)))throw Error('Build timing needs its own saved native boundary qualification evidence');
}

async function descriptor(root,base,file,role){
  if(!relative(file))throw Error('Unsafe build input path');
  let cursor=root;for(const part of file.split('/')){cursor=path.join(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw Error('Linked build input is not a reviewed source file');}
  if(!(await lstat(cursor)).isFile())throw Error('Build input must be a regular source file');
  const b=await readFile(cursor);return {base,path:file,role,bytes:b.length,sha256:hash(b)};
}
async function sourceFiles(root,folder){
  const found=[];
  async function visit(rel){for(const e of await readdir(path.join(root,rel),{withFileTypes:true})){if(['node_modules','.git','.venv','__pycache__','workload-locks'].includes(e.name))continue;const f=path.posix.join(rel,e.name);if(e.isSymbolicLink())throw Error('Linked source input is not qualified');if(e.isDirectory())await visit(f);else if(e.isFile())found.push(f);}}
  await visit(folder);return found;
}
export async function reviewBuildFiles({qualification,project,repository}) {
  const files=[];
  for(const f of await sourceFiles(project,'app'))files.push(await descriptor(project,'project',f,f.endsWith('lock.json')?'lock':'source'));
  for(const f of qualification.configurationFiles)files.push(await descriptor(project,'project',f,'configuration'));
  for(const f of qualification.instrumentationFiles)files.push(await descriptor(repository,'repository',f,'instrumentation'));
  if(new Set(files.map(f=>`${f.base}/${f.path}`)).size!==files.length)throw Error('Build input roles overlap');
  sortFiles(files);
  const configurationSha256=configurationDigest(files),instrumentationSha256=instrumentationDigest(files);
  return {files,configurationSha256,instrumentationSha256};
}
export async function captureBuildInputs({qualification,identity,project,repository,file}) {
  const {files,configurationSha256,instrumentationSha256}=await reviewBuildFiles({qualification,project,repository});
  if(configurationSha256!==qualification.configurationSha256||instrumentationSha256!==qualification.instrumentationSha256)throw Error('Build configuration/instrumentation differs from its native qualification');
  const manifest={schemaVersion:1,scope:buildScope,campaignId:qualification.campaignId,...identity,roots:{project:path.resolve(project),repository:path.resolve(repository)},configurationSha256,instrumentationSha256,...qualification.nativeMethodSha256&&{nativeMethodSha256:qualification.nativeMethodSha256},...qualification.identitySession&&{identitySession:qualification.identitySession},files};
  const b=Buffer.from(JSON.stringify(manifest,null,2)+'\n');await writeFile(file,b,{flag:'wx'});
  return {manifest,sha256:hash(b),file};
}
export async function verifyBuildInputs(manifest,{live=false}={}) {
  if(manifest.schemaVersion!==1||manifest.scope!==buildScope||!Array.isArray(manifest.files)||!manifest.files.length||!manifest.roots?.project||!manifest.roots?.repository)throw Error('Invalid build input manifest');
  if(!isDeepStrictEqual(manifest.files,sortFiles([...manifest.files]))||new Set(manifest.files.map(f=>`${f.base}/${f.path}`)).size!==manifest.files.length)throw Error('Unsorted or duplicate build inputs');
  if(configurationDigest(manifest.files)!==manifest.configurationSha256||instrumentationDigest(manifest.files)!==manifest.instrumentationSha256||!manifest.files.some(f=>f.role==='configuration')||!manifest.files.some(f=>f.role==='instrumentation')||!manifest.files.some(f=>f.role==='source'))throw Error('Build configuration/input provenance is incomplete');
  if(manifest.provider==='serverless'&&!validNativeMethods(manifest.nativeMethodSha256))throw Error('Serverless input manifest lacks qualified native method fingerprints');
  if(manifest.identitySession!==undefined&&!validIdentitySession(manifest.identitySession))throw Error('Invalid or unsafe packaging identity metadata');
  for(const f of manifest.files){if(!['project','repository'].includes(f.base)||!['configuration','source','lock','instrumentation'].includes(f.role)||!relative(f.path)||!sha(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0)throw Error('Invalid build input descriptor');if(live&&!isDeepStrictEqual(f,await descriptor(manifest.roots[f.base],f.base,f.path,f.role)))throw Error('Build inputs changed during the operation: '+f.path);}
  return manifest;
}
function bindings(files){
  if(!Array.isArray(files)||!files.length)throw Error('Matched build timing needs all final native upload artifacts');
  return files.map(f=>({name:f.name,role:f.role||'function',path:f.path,bytes:f.bytes,sha256:f.sha256})).sort((a,b)=>`${a.role}/${a.name}/${a.path}`.localeCompare(`${b.role}/${b.name}/${b.path}`,'en'));
}
function envelope(operation){const start=ns(operation?.startNs),end=ns(operation?.endNs);if(operation.clock!==buildClock||end<=start)throw Error('Missing or reversed full operation monotonic envelope');return {start,end};}
function bounded(start,end,operation){const e=envelope(operation);if(end<=start||start<e.start||end>e.end)throw Error('Build markers are reversed or outside the native operation');return Number(end-start)/1e6;}
function anchor(a){if(!a||!Number.isFinite(a.performanceMs)||a.performanceMs<0)throw Error('Candidate trace needs both original monotonic clock anchors');return {ns:ns(a.monotonicNs),ms:a.performanceMs};}
export function candidateSpan(trace,operation,commands,expected) {
  if(trace.schema!==3||trace.kind!=='stacktape-cli-timings'||trace.clock!=='performance.now() milliseconds since performance.timeOrigin'||trace.exitCode!==0||trace.droppedSpans!==0||!Array.isArray(trace.spans))throw Error('Candidate build trace is missing, failed or truncated');
  if(!Number.isSafeInteger(trace.pid)||!commands?.some(c=>c.pid===trace.pid&&c.exitCode===0))throw Error('Candidate trace belongs to a different native process');
  if(trace.buildContext?.bindingsSHA256!==expected.inputManifestSha256||trace.buildContext?.configurationSHA256!==expected.configurationSha256)throw Error('Candidate trace source/configuration binding differs');
  if(expected.identitySession){const identity=trace.spans.filter(s=>s.name==='aws:identity');if(!validIdentitySession(expected.identitySession)||identity.length!==1||identity[0].detail?.source!=='cache'||identity[0].detail.account!==expected.identitySession.accountId||trace.spans.some(s=>s.name==='aws:request'&&/GetCallerIdentity|AssumeRole|GetSessionToken|GetFederationToken/.test(s.detail?.operation||'')))throw Error('Candidate packaging requires the verified prewarmed identity cache and no STS request');}
  const init=anchor(trace.clockAnchors?.init),exit=anchor(trace.clockAnchors?.exit);
  bounded(init.ns,exit.ns,operation);
  const drift=Number(exit.ns-init.ns)/1e6-(exit.ms-init.ms);
  if(exit.ms<=init.ms||Math.abs(drift)>2||trace.exitAt!==exit.ms)throw Error('Candidate trace clock anchors disagree');
  const spans=trace.spans.filter(s=>s.name==='package:build-and-archive');
  if(spans.length!==1)throw Error('Candidate trace needs exactly one complete build-and-archive span');
  const s=spans[0];if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<init.ms||s.end>exit.ms||s.end<=s.start||s.detail?.outcome!=='ok')throw Error('Candidate build span is incomplete, failed or outside its process lifecycle');
  if(expected.identitySession){const i=trace.spans.find(s=>s.name==='aws:identity');if(!Number.isFinite(i.start)||!Number.isFinite(i.end)||i.start<init.ms||i.end<i.start||i.end>s.start)throw Error('Cached identity observation is incomplete or outside startup');}
  const archives=trace.spans.filter(z=>z.name==='zip:archive');
  if(archives.length!==expected.zipArtifactCount||archives.some(z=>!Number.isFinite(z.start)||!Number.isFinite(z.end)||z.start<s.start||z.end>s.end||z.end<=z.start||z.detail?.format!=='zip'||z.detail?.outcome==='error'))throw Error('Candidate build span does not contain every qualified complete ZIP/layer archive');
  const start=init.ns+BigInt(Math.round((s.start-init.ms)*1e6)),end=init.ns+BigInt(Math.round((s.end-init.ms)*1e6));
  bounded(start,end,operation);
  return {startNs:start.toString(),endNs:end.toString(),durationMs:s.end-s.start,spanName:s.name};
}
export function nativeSpan(proof,expected,operation,artifacts) {
  if(proof.schemaVersion!==1||proof.scope!==buildScope||proof.clock!==buildClock||proof.outcome!=='ok')throw Error('Invalid or failed native build timing proof');
  for(const k of [...identityKeys,'inputManifestSha256','configurationSha256'])if(proof[k]!==expected[k])throw Error('Native build marker differs from '+k);
  if(!Array.isArray(proof.markers)||proof.markers.length!==2||proof.markers[0].name!=='build:start'||proof.markers[1].name!=='artifacts:ready'||proof.markers[0].monotonicNs!==proof.startNs||proof.markers[1].monotonicNs!==proof.endNs)throw Error('Missing, duplicate or mismatched native lifecycle markers');
  if(!isDeepStrictEqual(bindings(proof.files),bindings(artifacts.files)))throw Error('Build-ready markers do not bind the complete current native artifact set');
  if(proof.files.some(f=>f.nativeOutputPath!==undefined&&!relative(f.nativeOutputPath)))throw Error('Unsafe native build-ready output path');
  if(proof.provider==='serverless'&&(!validNativeMethods(expected.nativeMethodSha256)||proof.details?.frameworkVersion!=='4.43.0'||!isDeepStrictEqual(proof.details?.methodSha256,expected.nativeMethodSha256)))throw Error('Native Serverless lifecycle method differs from its qualification');
  const start=ns(proof.startNs),end=ns(proof.endNs);return {startNs:proof.startNs,endNs:proof.endNs,durationMs:bounded(start,end,operation)};
}
export function validateBuildSummary(record) {
  const b=record.buildTiming;if(b===undefined)return;
  if(record.kind!=='package'||!record.scenario.startsWith('package-lambda-'))throw Error('Build timing is not qualified for this scenario');
  if(record.status!=='passed'&&b.verified!==true)return;
  if(b.verified!==true||b.required!==true||b.scope!==buildScope||b.clock!==buildClock||!['candidate-trace','native-markers'].includes(b.producer)||b.producer!==(record.provider==='candidate'?'candidate-trace':'native-markers')||!/^[a-z0-9][a-z0-9-]{2,60}$/.test(b.campaignId||''))throw Error('Passed matched build result requires verified native timing');
  if(!Number.isFinite(b.durationMs)||b.durationMs<=0||b.durationMs>record.durationMs+2||Math.abs(bounded(ns(b.startNs),ns(b.endNs),record.operationTiming)-b.durationMs)>0.002)throw Error('Build duration differs from original monotonic markers');
  if(Math.abs(Number(ns(record.operationTiming.endNs)-ns(record.operationTiming.startNs))/1e6-record.durationMs)>2)throw Error('Full operation duration differs from its monotonic envelope');
  for(const item of [b.nativeEvidence,b.inputEvidence])if(!relative(item?.file)||!sha(item?.sha256)||!record.evidence.some(e=>e.file===item.file&&e.sha256===item.sha256))throw Error('Matched build result needs checksum-bound original native/input evidence');
  if(!sha(b.configurationSha256)||!sha(b.instrumentationSha256)||!isDeepStrictEqual(b.artifactBindings,bindings(record.artifacts.files)))throw Error('Matched build artifact/configuration summary differs');
  if(record.provider==='serverless'&&!validNativeMethods(b.nativeMethodSha256))throw Error('Matched Serverless result lacks qualified native lifecycle fingerprints');
  if(b.identitySession!==undefined&&!validIdentitySession(b.identitySession))throw Error('Matched packaging identity metadata is invalid');
}
export async function collectBuildTiming({spec,identity,input,nativeFile,operation,commands,artifacts,base}) {
  await verifyBuildInputs(input.manifest,{live:true});
  if(hash(await readFile(input.file))!==input.sha256)throw Error('Build input manifest changed during the operation');
  if(!(await lstat(nativeFile)).isFile()||(await lstat(nativeFile)).isSymbolicLink())throw Error('Native timing proof must be an original regular file');
  if(!isDeepStrictEqual(spec.nativeMethodSha256,input.manifest.nativeMethodSha256))throw Error('Native lifecycle fingerprints differ from the input qualification');
  if(!isDeepStrictEqual(spec.identitySession,input.manifest.identitySession))throw Error('Packaging identity policy differs from the input qualification');
  const raw=await readFile(nativeFile),proof=JSON.parse(raw);const expected={...identity,inputManifestSha256:input.sha256,configurationSha256:input.manifest.configurationSha256,nativeMethodSha256:spec.nativeMethodSha256,identitySession:spec.identitySession,zipArtifactCount:artifacts.files.filter(f=>['function','layer'].includes(f.role||'function')).length};
  const span=spec.producer==='candidate-trace'?candidateSpan(proof,operation,commands,expected):nativeSpan(proof,expected,operation,artifacts);
  for(const f of proof.files||[])if(f.nativeOutputPath){const native=await descriptor(input.manifest.roots.project,'project',f.nativeOutputPath,'source');if(native.bytes!==f.bytes||native.sha256!==f.sha256)throw Error('Captured build artifact differs from the actual native-ready output');}
  return {required:true,verified:true,campaignId:spec.campaignId,scope:buildScope,clock:buildClock,producer:spec.producer,...span,configurationSha256:expected.configurationSha256,instrumentationSha256:input.manifest.instrumentationSha256,...spec.nativeMethodSha256&&{nativeMethodSha256:spec.nativeMethodSha256},...spec.identitySession&&{identitySession:spec.identitySession},artifactBindings:bindings(artifacts.files),inputEvidence:{file:path.relative(base,input.file),sha256:input.sha256},nativeEvidence:{file:path.relative(base,nativeFile),sha256:hash(raw)}};
}
export async function verifyImportedBuildTiming(record,{base}={}) {
  if(!record.buildTiming||record.status!=='passed')return;
  validateBuildSummary(record);
  const b=record.buildTiming;
  const load=async e=>{const raw=await readFile(path.resolve(base,e.file));if(hash(raw)!==e.sha256)throw Error('Original build timing evidence checksum mismatch');return JSON.parse(raw);};
  const input=await load(b.inputEvidence),proof=await load(b.nativeEvidence);await verifyBuildInputs(input);
  if(input.campaignId!==b.campaignId)throw Error('Retained matched-build campaign identity differs');
  const fixture=record.scenario.replace(/^package-/,'');
  const identity={provider:record.provider,runId:record.runId,sourceCommit:record.sourceCommit,appId:record.appId,fixture};
  for(const k of identityKeys)if(input[k]!==identity[k])throw Error('Retained build input identity differs from '+k);
  if(!isDeepStrictEqual(input.toolVersion,record.toolVersion))throw Error('Retained build tool version differs');
  if(input.configurationSha256!==b.configurationSha256||input.instrumentationSha256!==b.instrumentationSha256)throw Error('Retained build configuration/instrumentation digest differs');
  if(!isDeepStrictEqual(input.nativeMethodSha256,b.nativeMethodSha256))throw Error('Retained native lifecycle fingerprints differ');
  if(!isDeepStrictEqual(input.identitySession,b.identitySession))throw Error('Retained packaging identity differs');
  const expected={...identity,inputManifestSha256:b.inputEvidence.sha256,configurationSha256:b.configurationSha256,nativeMethodSha256:b.nativeMethodSha256,identitySession:b.identitySession,zipArtifactCount:record.artifacts.files.filter(f=>['function','layer'].includes(f.role||'function')).length};
  const span=b.producer==='candidate-trace'?candidateSpan(proof,record.operationTiming,record.commands,expected):nativeSpan(proof,expected,record.operationTiming,record.artifacts);
  for(const k of ['startNs','endNs','durationMs'])if(span[k]!==b[k])throw Error('Build summary differs from retained original markers');
  return {verified:true,scope:buildScope,durationMs:span.durationMs};
}
export async function verifyBuildQualificationEvidence(q,{base}) {
  if(!q.buildTiming)return;
  const s=q.buildTiming;let qualified=false;
  for(const e of s.qualificationEvidence){
    const bytes=await readFile(path.resolve(base,e.file));if(hash(bytes)!==e.sha256)throw Error('Build boundary qualification checksum mismatch');
    const proof=JSON.parse(bytes),b=proof.buildTiming;
    if(proof.classification!=='qualification-only'||proof.measuredSamples!==0||proof.status!=='passed'||proof.provider!==q.provider||proof.appId!==q.appId||proof.scenario!==q.scenario||!isDeepStrictEqual(proof.toolVersion,q.toolVersion)||b?.campaignId!==s.campaignId||b.configurationSha256!==s.configurationSha256||b.instrumentationSha256!==s.instrumentationSha256||!isDeepStrictEqual(b.nativeMethodSha256,s.nativeMethodSha256))throw Error('Build qualification settings differ from the saved native boundary proof');
    await verifyImportedBuildTiming(proof,{base});qualified=true;
  }
  if(!qualified)throw Error('Missing native boundary qualification proof');
}

import { readFile, writeFile, mkdir, access, lstat, realpath, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
export async function save(file, value) { await mkdir(path.dirname(file), {recursive:true}); await writeFile(file, JSON.stringify(value,null,2)+'\n'); }
export async function saveResult(file, value) { await mkdir(path.dirname(file), {recursive:true}); await writeFile(file, JSON.stringify(value,null,2)+'\n',{flag:'wx'}); }
export async function refuseExistingResult(file) { try { await access(file); } catch(e) { if(e.code==='ENOENT') return; throw e; } throw Error('Result already exists; use a new run ID: '+file); }
export async function scenarios() { return (await json(path.join(root,'scenarios/index.json'))).scenarios; }
export async function scenarioById(id) { const value=(await scenarios()).find(s=>s.id===id); if(!value) throw Error('Unknown test: '+id); return value; }
export function parseArgs(args) { const positional=[]; const flags={}; for(let i=0;i<args.length;i++) { if(args[i].startsWith('--')) { const key=args[i].slice(2); if(['execute'].includes(key)) flags[key]=true; else { if(!args[i+1]||args[i+1].startsWith('--')) throw Error('Missing value for --'+key); flags[key]=args[++i]; } } else positional.push(args[i]); } return {positional,flags}; }
export async function sha256(file) { return createHash('sha256').update(await readFile(file)).digest('hex'); }
export async function command(argv,{cwd=root,env={},stdoutFile,stderrFile,timeoutMs=1800000}={}) {
  if(!Array.isArray(argv)||!argv.length||argv.some(a=>typeof a!=='string')) throw Error('Commands must be argv arrays');
  const started=performance.now(); const wallStarted=new Date().toISOString();
  return await new Promise((resolve,reject)=>{
    const child=spawn(argv[0],argv.slice(1),{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    const out=[],err=[]; let timedOut=false; let spawnError; let killTimer;
    const kill=(signal)=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{}};
    const timer=setTimeout(()=>{timedOut=true;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),1000);},timeoutMs);
    child.stdout.on('data',b=>out.push(b)); child.stderr.on('data',b=>err.push(b));
    child.on('error',e=>{spawnError=e.message;err.push(Buffer.from(e.message));});
    child.on('close',async(code,signal)=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer); const stdout=Buffer.concat(out).toString(),stderr=Buffer.concat(err).toString(); try {if(stdoutFile) await writeFile(stdoutFile,stdout); if(stderrFile) await writeFile(stderrFile,stderr); resolve({argv,cwd,exitCode:spawnError?127:code,signal,timedOut,spawnError,startedAt:wallStarted,finishedAt:new Date().toISOString(),durationMs:performance.now()-started,stdout,stderr});} catch(e){reject(e);} });
  });
}
export function safeId(value,label='identifier') { if(!/^[a-z0-9][a-z0-9-]{2,60}$/.test(value)) throw Error('Invalid '+label+': use 3–61 lowercase letters, digits and hyphens'); return value; }
export async function ownedCachePath(project,relative) {
  if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>['','..','.','node_modules','.venv','app'].includes(p)))throw Error('Unsafe cache path');
  const resolved=await realpath(project);if(resolved!==path.resolve(project))throw Error('Refusing a linked project directory');
  const target=path.resolve(project,relative);let cursor=project;
  for(const part of relative.split('/')){cursor=path.join(cursor,part);const info=await lstat(cursor).catch(e=>{if(e.code==='ENOENT')return null;throw e;});if(info?.isSymbolicLink())throw Error('Refusing a linked cache');}
  return target;
}
export async function observeCachePaths(project,paths,{reset=false}={}) {
  if(!Array.isArray(paths))throw Error('Provider cache paths have not been qualified');
  const observations=[];
  for(const relative of paths){const target=await ownedCachePath(project,relative);const existed=await lstat(target).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});if(reset&&existed)await rm(target,{recursive:true,force:false});const exists=await lstat(target).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});observations.push({path:relative,existed,exists,removed:reset&&!exists});}
  return observations;
}
function cacheIdentity(proof,expected){for(const key of ['runId','sourceCommit','scenario','appId','provider','series'])if(!expected[key]||proof[key]!==expected[key])throw Error('Cache evidence differs from current '+key);}
export async function readCacheEvidence(file,expected,{beforeTimer=false,base=root}={}) {
  const absolute=path.resolve(base,file),proof=await json(absolute);cacheIdentity(proof,expected);
  if(proof.schemaVersion!==1||!['local','github-actions','hosted'].includes(proof.mode))throw Error('Invalid per-attempt cache proof');
  if(proof.mode==='local') {
    const project=path.join(base,'.work',proof.appId,proof.provider);
    if(!Array.isArray(proof.paths))throw Error('Cache proof needs path observations');
    if(beforeTimer&&proof.series==='clean'){
      if(!proof.paths.length&&proof.nativeClean?.verified!==true)throw Error('Clean build needs reset paths or a qualified native no-cache control');
      for(const item of proof.paths){if(item.removed!==true)throw Error('Clean cache reset was not verified');const target=await ownedCachePath(project,item.path);if(await lstat(target).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('Reset cache path reappeared before timer: '+item.path);}
    }
    if(proof.series==='cached-source-edit')await verifyRetainedCache(proof,project,{base,live:beforeTimer});
  }else{
    if(!proof.nativeEvidence?.file||!proof.nativeEvidence.sha256)throw Error('Native cache proof needs its original observer evidence');
    const original=path.resolve(base,proof.nativeEvidence.file);if(await sha256(original)!==proof.nativeEvidence.sha256)throw Error('Native cache observer evidence checksum mismatch');
    const observation=await json(original);validateNativeCacheObservation(observation,expected,proof.completion,proof.mode);
    if(JSON.stringify(proof.runner)!==JSON.stringify(observation.runner)||JSON.stringify(proof.cache)!==JSON.stringify(observation.cache))throw Error('Bound cache/runner observations differ from native evidence');
    if(JSON.stringify(proof.rolloutAdmission)!==JSON.stringify(observation.rolloutAdmission))throw Error('Bound rollout admission differs from native evidence');
  }
  return {...proof,proofFile:path.relative(base,absolute),proofSHA:await sha256(absolute)};
}
export async function verifyRetainedCache(proof,project,{base=root,live=true}={}) {
  const prior=proof.retainedFrom;if(!prior?.file||!prior.sha256)throw Error('Cached source edit needs preceding result proof');
  const previousFile=path.resolve(base,prior.file);if(await sha256(previousFile)!==prior.sha256)throw Error('Preceding result checksum mismatch');
  const previous=validateRecord(await json(previousFile));
  if(previous.status!=='passed'||previous.appId!==proof.appId||previous.provider!==proof.provider||previous.scenario!==proof.scenario||previous.sourceCommit===proof.sourceCommit)throw Error('Retained result must be passed, same app/provider/test and different source commit');
  const previousProof=await readCacheEvidence(previous.cacheEvidence.proofFile,previous.cacheEvidence,{base});if(previousProof.proofSHA!==previous.cacheEvidence.proofSHA)throw Error('Preceding cache proof checksum mismatch');
  if(!live)return;
  let observed=0;
  for(const item of proof.paths){const target=await ownedCachePath(project,item.path);if(!await lstat(target).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('Retained cache path is missing: '+item.path);observed++;}
  for(const item of previous.artifacts?.files||[]){const target=await ownedCachePath(project,item.path);if(await sha256(target)!==item.sha256)throw Error('Retained artifact is missing or changed: '+item.path);observed++;}
  if(!observed)throw Error('Retained cache/artifact files have not been established');
}
export function validateNativeCacheObservation(observation,expected,completion,mode) {
  for(const key of ['sourceCommit','scenario','provider','appId'])if(observation[key]!==expected[key])throw Error('Native cache observer differs from '+key);
  if(observation.status!=='passed'||!observation.runner||typeof observation.runner!=='object'||Array.isArray(observation.runner)||!observation.cache||typeof observation.cache!=='object'||Array.isArray(observation.cache)||!completion?.verified||completion.status!=='succeeded'||completion.sourceCommit!==expected.sourceCommit)throw Error('Native cache/runner evidence requires a successful completed attempt');
  if(mode==='github-actions') {
    if(String(observation.runner.githubRunId)!==String(completion.runId)||String(observation.runner.githubRunAttempt)!==String(completion.runAttempt))throw Error('CI cache evidence belongs to a different run/attempt');
    if(typeof observation.cache.requested!=='boolean'||typeof observation.cache.restored!=='boolean'||typeof observation.cache.exactKeyHit!=='boolean')throw Error('CI cache restore observation is missing');
    if(expected.scenario.endsWith('-git-cold')&&(observation.cache.requested||observation.cache.restored))throw Error('Fresh CI attempt unexpectedly restored a cache');
    if(expected.scenario.endsWith('-git-repeat')&&!observation.cache.requested)throw Error('Repeat CI attempt did not request the qualified cache restore');
  }else {
    if(String(observation.nativeRunId)!==String(completion.runId))throw Error('Hosted cache evidence belongs to a different native run');
    if(typeof observation.cache.restored!=='boolean')throw Error('Hosted cache evidence requires an observed restored boolean');
    if(expected.scenario.endsWith('-git-cold')&&observation.cache.restored)throw Error('Fresh hosted attempt unexpectedly restored a cache');
  }
}
export function requireGitCacheObserver(q) {
  if(q.pipeline?.engine==='github-actions')return;
  if(!Array.isArray(q.pipeline?.evidence?.argv)||!q.pipeline.evidence.argv.length)throw Error('Hosted qualification requires a per-attempt native cache/runner evidence observer');
}
export async function bindGitCacheEvidence({q,identity,completion,runCommand=command,base=root}) {
  requireGitCacheObserver(q);
  const mode=q.pipeline.engine==='github-actions'?'github-actions':'hosted';
  const directory=path.join(base,'.work/evidence',identity.runId,identity.provider);await mkdir(directory,{recursive:true});
  const proofFile=path.join(directory,'cache-control.json');await refuseExistingResult(proofFile);
  let nativeFile,observation;
  if(mode==='github-actions') {
    const repository=completion.repository||q.pipeline.repository;
    if(!/^[\w.-]+\/[\w.-]+$/.test(repository||'')||!/^\d+$/.test(String(completion.runId))||!/^\d+$/.test(String(completion.runAttempt)))throw Error('CI completion must identify repository, run ID and attempt');
    const artifactDir=path.join(directory,'native-ci');await mkdir(artifactDir);
    const result=await runCommand(['gh','run','download',String(completion.runId),'--repo',repository,'--name',`ci-${identity.provider}-${identity.sourceCommit}-${completion.runAttempt}`,'--dir',artifactDir],{timeoutMs:120000});
    if(result.exitCode!==0)throw Error('The completed CI attempt cache/runner artifact could not be downloaded');
    nativeFile=path.join(artifactDir,'ci-evidence.json');observation=await json(nativeFile);
  }else{
    const result=await runCommand(q.pipeline.evidence.argv,{cwd:q.pipeline.evidence.cwd||base,timeoutMs:120000});
    if(result.exitCode!==0)throw Error('Hosted native cache/runner evidence observer failed');
    observation=JSON.parse(result.stdout);nativeFile=path.join(directory,'native-hosted.json');await saveResult(nativeFile,observation);
  }
  validateNativeCacheObservation(observation,identity,completion,mode);
  const proof={schemaVersion:1,mode,...identity,capturedAt:new Date().toISOString(),runner:observation.runner,cache:observation.cache,rolloutAdmission:observation.rolloutAdmission,completion,nativeEvidence:{file:path.relative(base,nativeFile),sha256:await sha256(nativeFile)}};
  await saveResult(proofFile,proof);return await readCacheEvidence(proofFile,identity,{base});
}
export async function finishGitVerification({wait,capture,compare,before}) {
  const pipelineCompletion=await wait();
  const reuse=capture?compare(before,await capture()):undefined;
  return {pipelineCompletion,reuse};
}
function validateProviderNativePackage(record) {
  const a=record.artifacts,n=a?.nativeBuild;
  if(record.kind!=='package'||!['package-node','package-python'].includes(record.scenario)||!['render','ravion','heroku'].includes(record.provider)||a?.name!=='api'||a.complete!==true||a.bytes!==null||a.sizeAvailable!==false)throw Error('Provider-native timing is only available for the selected managed container API with unavailable size');
  for(const key of ['runId','sourceCommit','scenario','appId','provider'])if(!record[key]||n?.[key]!==record[key])throw Error('Provider-native build differs from current '+key);
  if(typeof n.nativeBuildId!=='string'||!n.nativeBuildId.trim()||!n.evidenceFile||!/^[a-f0-9]{64}$/.test(n.evidenceSHA||'')||!record.evidence?.some(e=>e.file===n.evidenceFile&&e.sha256===n.evidenceSHA))throw Error('Provider-native build needs its ID and exact retained evidence binding');
  const phase=n.phase;
  if(phase?.status!=='succeeded'||phase.startedAt!==record.startedAt||phase.finishedAt!==record.finishedAt)throw Error('Provider-native timing must be the successful native build phase');
  const business=a.businessVerification,observations=business?.observations;
  if(business?.verified!==true||business.nativeBuildId!==n.nativeBuildId||business.sourceCommit!==record.sourceCommit||!Array.isArray(observations)||observations.length!==1||observations[0].name!=='api')throw Error('Provider-native build needs current business verification of the selected API');
  for(const o of observations){if(!o.expected?.revision||!o.observed||Object.keys(o.expected).length<2||!Number.isFinite(Date.parse(o.observedAt))||Date.parse(o.observedAt)<Date.parse(phase.finishedAt)||Object.entries(o.expected).some(([key,value])=>JSON.stringify(o.observed[key])!==JSON.stringify(value)))throw Error('Provider-native build needs matching full business/revision observations after the build');}
}
export async function verifyImportedNativePackage(record,{base=root}={}) {
  if(record.artifacts?.format!=='provider-native')return;
  validateRecord(record);
  if(record.status!=='passed')throw Error('Provider-native proof admission requires a passed record');
  const native=record.artifacts.nativeBuild,file=path.resolve(base,native.evidenceFile);
  if(await sha256(file)!==native.evidenceSHA)throw Error('Provider-native evidence checksum mismatch');
  const proof=await json(file);
  if(proof.schemaVersion!==1)throw Error('Invalid provider-native evidence schema');
  for(const key of ['runId','sourceCommit','scenario','appId','provider','nativeBuildId'])if(proof[key]!==native[key])throw Error('Retained provider-native proof differs from current '+key);
  if(JSON.stringify(proof.buildPhase)!==JSON.stringify(native.phase)||JSON.stringify(proof.businessVerification)!==JSON.stringify(record.artifacts.businessVerification))throw Error('Provider-native phase/business summary differs from retained raw proof');
  const completion=proof.nativeCompletion;
  if(completion?.status!=='succeeded'||completion.nativeBuildId!==native.nativeBuildId||completion.sourceCommit!==record.sourceCommit||!Number.isFinite(Date.parse(completion.finishedAt))||Date.parse(completion.finishedAt)<Date.parse(native.phase.finishedAt))throw Error('Provider-native build requires successful native completion of the same build/source');
  if(record.artifacts.businessVerification.observations.some(o=>Date.parse(o.observedAt)<Date.parse(completion.finishedAt)))throw Error('Provider-native business checks must follow native completion');
  return {verified:true,nativeBuildId:native.nativeBuildId,sizeAvailable:false};
}
export function validateRecord(r) {
  if(r.schemaVersion!==1||!['package','deploy'].includes(r.kind)||!['passed','failed','unqualified'].includes(r.status)) throw Error('Invalid result schema/kind/status');
  for(const key of ['scenario','provider','runId','sourceCommit','startedAt','finishedAt']) if(typeof r[key]!=='string'||!r[key]) throw Error('Missing '+key);
  if(!Number.isFinite(Date.parse(r.startedAt))||!Number.isFinite(Date.parse(r.finishedAt))||Date.parse(r.finishedAt)<Date.parse(r.startedAt)) throw Error('Invalid timer timestamps');
  if(!/^[a-f0-9]{40}$/.test(r.sourceCommit)) throw Error('sourceCommit must be a full Git SHA');
  if(r.status==='passed') {
    if(!Number.isFinite(r.durationMs)||r.durationMs<0) throw Error('Invalid duration');
    if(Math.abs(Date.parse(r.finishedAt)-Date.parse(r.startedAt)-r.durationMs)>1000)throw Error('Elapsed duration differs from observed timer boundaries');
    if(!r.toolVersion||!r.environment||!r.cacheEvidence||!Array.isArray(r.evidence)||!r.evidence.length) throw Error('Passed results require versions, environment, cache evidence and source evidence');
    cacheIdentity(r.cacheEvidence,{...r,series:r.cacheEvidence.series});
    if(!r.cacheEvidence.proofFile||!/^[a-f0-9]{64}$/.test(r.cacheEvidence.proofSHA||'')||!r.evidence.some(e=>e.file===r.cacheEvidence.proofFile&&e.sha256===r.cacheEvidence.proofSHA))throw Error('Passed results require matching immutable per-attempt cache proof and evidence checksum');
    if(r.kind==='deploy') {
      if(r.scenario.includes('-git-')&&(r.pipelineCompletion?.verified!==true||r.pipelineCompletion.sourceCommit!==r.sourceCommit||r.pipelineCompletion.status!=='succeeded'||!r.pipelineCompletion.runId))throw Error('Git results require successful native pipeline completion for the pushed SHA');
      if(r.scenario.includes('-git-')&&(r.cacheEvidence.mode==='local'||r.cacheEvidence.completion?.runId!==r.pipelineCompletion.runId||r.cacheEvidence.completion?.runAttempt!==r.pipelineCompletion.runAttempt))throw Error('Git cache proof must identify the completed native pipeline attempt');
      if(r.scenario.includes('five-services')&&(r.reuse?.verified!==true||r.reuse.observations?.length!==2||!['inventory','webhooks'].every(name=>r.reuse.observations.some(s=>s.name===name&&s.unchanged===true))))throw Error('Five-service results need verified unchanged native component identities');
      const expectedCount=r.scenario.includes('five-services')?5:Number(r.scenario.match(/lambda-(1|5|25)-/)?.[1]||1);
      const observations=r.readiness?.observations;
      if(r.readiness?.verified!==true||!Array.isArray(observations)||observations.length!==expectedCount||new Set(observations.map(o=>o.name)).size!==expectedCount||observations.some(o=>!o.expected?.revision||o.observed?.revision!==o.expected.revision)) throw Error('Deployment needs verified business/revision observations for every component');
      if(r.provider==='sst'&&!r.scenario.includes('lambda-')) {
        const admission=r.rolloutAdmission,states=admission?.observations,changedNames=r.scenario.includes('five-services')?['api','reporting','notifications']:['api'];
        if(admission?.verified!==true||admission.outsideReadinessTimer!==true||!Array.isArray(states)||states.length!==changedNames.length||new Set(states.map(o=>o.name)).size!==changedNames.length||changedNames.some(name=>!states.some(o=>o.name===name))||states.some(o=>o.rolloutState!=='COMPLETED'||!o.serviceArn||!o.beforeDeploymentId||!o.deploymentId||o.beforeDeploymentId===o.deploymentId||!o.taskDefinition))throw Error('SST containers require successful post-timer admission of every changed ECS service');
        const after=admission.postRolloutReadiness?.observations;
        if(admission.postRolloutReadiness?.verified!==true||!Array.isArray(after)||after.length!==expectedCount||new Set(after.map(o=>o.name)).size!==expectedCount||observations.some(before=>!after.some(o=>o.name===before.name&&o.observed?.revision===before.expected.revision)))throw Error('SST containers require verified business revisions after successful rollout');
        if(r.scenario.includes('-git-')&&JSON.stringify(admission)!==JSON.stringify(r.cacheEvidence.rolloutAdmission))throw Error('Git rollout admission differs from the immutable native CI proof');
      }
    }
    if(r.kind==='package') {
      if(r.artifacts?.format==='provider-native')validateProviderNativePackage(r);
      else if(r.artifacts?.complete!==true||!Number.isSafeInteger(r.artifacts.bytes)||r.artifacts.bytes<=0||!['lambda-zip','oci-compressed','heroku-slug'].includes(r.artifacts.format))throw Error('Packaging needs complete deployable artifacts');
      if(r.artifacts.format==='oci-compressed'){const blobs=r.artifacts.blobs;if(!Array.isArray(blobs)||!blobs.length||new Set(blobs.map(b=>b.digest)).size!==blobs.length||blobs.some(b=>!/^sha256:[a-f0-9]{64}$/.test(b.digest)||!Number.isSafeInteger(b.size)||b.size<=0)||blobs.reduce((sum,b)=>sum+b.size,0)!==r.artifacts.bytes||!r.artifacts.manifestDigest)throw Error('OCI size requires a complete compressed blob manifest');}
      if(r.artifacts.format==='oci-compressed') {
        const native=r.artifacts.nativeBuild;
        if(!native||native.sourceCommit!==r.sourceCommit||native.runId!==r.runId||native.provider!==r.provider||!/^sha256:[a-f0-9]{64}$/.test(native.imageId||'')||!r.artifacts.blobs.some(b=>b.digest===native.imageId&&['application/vnd.oci.image.config.v1+json','application/vnd.docker.container.image.v1+json'].includes(b.mediaType)))throw Error('OCI artifacts require a current source/run/provider build identity matching the image config blob');
      }
      const expectedCount=Number(r.scenario.match(/lambda-(1|5|25)$/)?.[1]);if(expectedCount) {const functions=r.artifacts.files?.filter(f=>f.role==='function');if(r.artifacts.format!=='lambda-zip'||functions?.length!==expectedCount)throw Error('Every selected function ZIP is required');const probes=r.artifacts.businessVerification?.completeZipBusinessProbes;if(!Array.isArray(probes)||probes.length!==expectedCount||new Set(probes.map(p=>p.name)).size!==expectedCount||probes.some(p=>!p.revision))throw Error('Every complete Lambda ZIP needs a business/revision verification');}
    }
  }
  return r;
}

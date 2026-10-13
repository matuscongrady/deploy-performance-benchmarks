#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import {mkdir,readFile,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {root,json,save,saveResult,refuseExistingResult,scenarios,scenarioById,parseArgs,safeId,command,sha256,validateRecord,readCacheEvidence} from './lib.mjs';
import {verifyImportedPredecessor} from './git-predecessor.mjs';
import {measureDeployment} from './deployment-timer.mjs';
import {needsSstRollout,admitSstRollout,captureSstRolloutBaseline} from './sst-rollout.mjs';
const {positional,flags}=parseArgs(process.argv.slice(2));
const [operation,id,provider]=positional;
try {
  if(operation==='list') { for(const s of await scenarios()) console.log(`${s.id.padEnd(34)} ${s.title}`); }
  else if(operation==='describe') console.log(JSON.stringify(await scenarioById(id),null,2));
  else if(operation==='prepare'||operation==='run') {
    const scenario=await scenarioById(id);
    if(!scenario.providers.includes(provider)) throw Error('Provider not included in this test');
    const runId=safeId(flags['run-id']||'bench-'+Date.now(),'run ID');
    const resultFile=path.join(root,'results/raw',runId+'-'+provider+'.json');
    if(operation==='run'&&flags.execute)await refuseExistingResult(resultFile);
    if(operation==='run'&&flags.execute&&!flags['app-id'])throw Error('Timed runs require --app-id for the existing application');
    const appId=safeId(flags['app-id']||runId,'application ID');
    const outputDir=path.join(root,'.work',appId,provider); await mkdir(outputDir,{recursive:true});
    const {prepare}=await import('../providers/index.mjs');
    const plan=await prepare({provider,scenario,outputDir,repoRoot:root,runId:appId,region:flags.region||'eu-west-1',stage:flags.stage||'bench'});
    await save(path.join(outputDir,'plan.json'),plan);
    console.log(JSON.stringify({runId,appId,scenario:id,provider,...plan},null,2));
    if(operation==='prepare'||!flags.execute) { console.log('Prepared only. No build or deployment was started.'); process.exit(0); }
    if(scenario.journey.startsWith('git-')) throw Error('Git tests must follow TEST.md; do not time a CLI command as a Git push');
    if(['unsupported','account-required'].includes(plan.availability)) throw Error(plan.reason||'Provider prerequisites are missing');
    const qualification=await json(flags.qualification||path.join(outputDir,'qualification.json'));
    if(qualification.environment?.region!==(flags.region||'eu-west-1'))throw Error('Qualification region differs from the generated project');
    if(qualification.stage!==(flags.stage||'bench'))throw Error('Qualification stage differs from the generated project');
    if(qualification.appId!==appId)throw Error('Qualification application ID differs from --app-id');
    const {checkQualification}=await import('./qualification.mjs');
    await checkQualification(qualification,scenario,provider,{sourceBound:true});
    for(const item of qualification.qualificationEvidence) if(await sha256(path.resolve(root,item.file))!==item.sha256) throw Error('Qualification evidence checksum mismatch');
    if(provider==='candidate'&&await sha256(process.env.CANDIDATE_CLI)!==qualification.toolVersion.sha256) throw Error('Candidate executable hash differs from qualification');
    if(scenario.kind==='deploy'&&['candidate','serverless','sst','cdk'].includes(provider)){
      if(!/^\d{12}$/.test(qualification.environment.accountId||''))throw Error('Deployment qualification needs the expected AWS account ID');
      const identity=await command(['aws','sts','get-caller-identity','--region',qualification.environment.region,'--output','json']);
      if(identity.exitCode!==0||JSON.parse(identity.stdout).Account!==qualification.environment.accountId)throw Error('Authenticated AWS account differs from qualification');
    }
    let baseline,componentsBefore,rolloutBaseline;
    if(needsSstRollout(scenario,provider)){const {verifyExistingApplication}=await import('./existing-app.mjs');await verifyExistingApplication({q:qualification,provider,appName:plan.appName,region:qualification.environment.region});}
    if(scenario.fixture==='five-services'){const {captureComponents}=await import('./component-state.mjs');componentsBefore=await captureComponents(qualification.componentSnapshots);}
    if(scenario.kind==='deploy') {const {probe}=await import('./probe.mjs');baseline=await probe(qualification.baselineProbes,{timeoutMs:30000});}
    if(needsSstRollout(scenario,provider))rolloutBaseline=await captureSstRolloutBaseline(qualification);
    const git=await command(['git','rev-parse','HEAD']); if(git.exitCode!==0) throw Error('Commit the benchmark sources first');
    const dirty=await command(['git','status','--porcelain']); if(dirty.stdout.trim()) throw Error('Commit all source changes before timing');
    const commands=plan.commands[scenario.kind==='package'?'package':'update'];
    if(!Array.isArray(commands)||!commands.length) throw Error('No executable native command for this measurement');
    if(!flags['cache-evidence'])throw Error('Timed runs require --cache-evidence FILE captured for this attempt');
    const cacheEvidence=await readCacheEvidence(flags['cache-evidence'],{runId,sourceCommit:git.stdout.trim(),scenario:id,provider,appId,series:qualification.cacheEvidence.series},{beforeTimer:true});
    if(cacheEvidence.mode!=='local')throw Error('CLI runs require local cache observations');
    const defaults={serverless:['.serverless'],cdk:['cdk.out','package-artifacts'],sst:['.sst/artifacts','package-artifacts']};
    const paths=qualification.cacheControl?.localPaths||defaults[provider];
    if(JSON.stringify(cacheEvidence.paths.map(p=>p.path))!==JSON.stringify(paths))throw Error('Observed cache paths differ from qualified native paths');
    if(cacheEvidence.nativeClean&&JSON.stringify(cacheEvidence.nativeClean)!==JSON.stringify(qualification.cacheControl?.nativeClean))throw Error('Native clean control differs from qualification');
    if(cacheEvidence.series==='clean'&&cacheEvidence.nativeClean?.verified){const {env={}}=cacheEvidence.nativeClean;for(const [key,value]of Object.entries(env))if((plan.env?.[key]??process.env[key])!==value)throw Error('Qualified native no-cache environment is missing: '+key);if(!Object.keys(env).length)throw Error('Native clean control requires a qualified no-cache environment');}
    const evidenceDir=path.join(root,'.work','evidence',runId,provider);await mkdir(evidenceDir,{recursive:true});
    let startedAt,start,commandFinishedAt,commandDurationMs,finishedAt,durationMs;
    const logs=[]; let status='passed',failure;
    let readiness={verified:false},artifacts={complete:false},nativeCompletion;
    async function runNative() {
      const nativeStart=performance.now();let passed=true,nativeFailure;
      for(let i=0;i<commands.length;i++) {
        const stdoutFile=path.join(evidenceDir,`command-${i}.stdout.log`),stderrFile=path.join(evidenceDir,`command-${i}.stderr.log`);
        const result=await command(commands[i],{cwd:plan.cwd,env:{...plan.env,BENCH_SOURCE_COMMIT:git.stdout.trim(),BENCH_RUN_ID:runId},stdoutFile,stderrFile});
        logs.push({argv:result.argv,exitCode:result.exitCode,durationMs:result.durationMs,stdoutFile,stderrFile});
        if(result.exitCode!==0) {passed=false;nativeFailure=`Native command ${i+1} failed`;break;}
      }
      commandFinishedAt=new Date().toISOString();commandDurationMs=performance.now()-nativeStart;
      return {passed,failure:nativeFailure,finishedAt:commandFinishedAt,durationMs:commandDurationMs};
    }
    if(scenario.kind==='deploy') {
      const {probe}=await import('./probe.mjs');
      const measured=await measureDeployment({runNative,probeReady:signal=>probe(qualification.probes,{timeoutMs:qualification.timeoutMs||900000,signal})});
      ({startedAt,finishedAt,durationMs,readiness,status,failure}=measured);
      nativeCompletion={verified:measured.completion.passed,outsideReadinessTimer:true,finishedAt:commandFinishedAt};
      // Keep readiness as the first observation, but do not admit a rollback or failed native completion.
      if(status==='passed')try{nativeCompletion.postCompletionReadiness=await probe(qualification.probes,{timeoutMs:qualification.timeoutMs||900000});}catch(e){status='failed';failure=e.message;nativeCompletion.verified=false;}
    } else {
      startedAt=new Date().toISOString();start=performance.now();
      const completed=await runNative();if(!completed.passed){status='failed';failure=completed.failure;}
      durationMs=performance.now()-start;finishedAt=commandFinishedAt;
    }
    if(status==='passed'&&scenario.kind==='package') {
      const {collectArtifacts}=await import('./sizes.mjs');
      try {
        artifacts=await collectArtifacts(qualification.artifacts,plan.cwd,{startedAt,commandFinishedAt,sourceCommit:git.stdout.trim(),runId,provider});
        if(scenario.fixture.startsWith('lambda-')) {
          const bindings=path.join(evidenceDir,'artifact-bindings.json');await save(bindings,artifacts.nativeManifest?{...qualification.artifacts,files:artifacts.nativeManifest.files}:qualification.artifacts);
          const stdoutFile=path.join(evidenceDir,'packaged-business.stdout.log'),stderrFile=path.join(evidenceDir,'packaged-business.stderr.log');
          const checked=await command(['node',path.join(root,'providers/check-lambda-zips.mjs'),bindings,path.join(root,'fixtures/manifest.json'),scenario.fixture,plan.cwd],{cwd:plan.cwd,stdoutFile,stderrFile});
          logs.push({...checked,stdoutFile,stderrFile,phase:'verification-outside-timer'});
          if(checked.exitCode!==0)throw Error('Complete ZIP business/revision verification failed: '+checked.stderr.slice(-2000));
          artifacts.businessVerification=JSON.parse(checked.stdout.trim().split('\n').at(-1));
        }
      } catch(e){status='unqualified';failure=e.message;}
    }
    let reuse,rolloutAdmission;
    if(status==='passed'&&needsSstRollout(scenario,provider)){try{rolloutAdmission=await admitSstRollout(qualification,{baseline:rolloutBaseline});}catch(e){status='failed';failure=e.message;rolloutAdmission=e.rolloutAdmission;}}
    if(status==='passed'&&scenario.fixture==='five-services'){try{const {captureComponents,compareUnchanged}=await import('./component-state.mjs');reuse=compareUnchanged(componentsBefore,await captureComponents(qualification.componentSnapshots));}catch(e){status='failed';failure=e.message;}}
    const evidence=[{file:cacheEvidence.proofFile,sha256:cacheEvidence.proofSHA}];
    if(rolloutAdmission){const file=path.join(evidenceDir,'rollout-admission.json');await save(file,rolloutAdmission);evidence.push({file:path.relative(root,file),sha256:await sha256(file)});}
    for(const artifact of [...(artifacts.files||[]),...(artifacts.proofs||[])])if(['oci-compressed','lambda-zip'].includes(artifacts.format)){
      const file=path.join(evidenceDir,'artifacts',artifact.path);await mkdir(path.dirname(file),{recursive:true});
      await copyFile(path.resolve(plan.cwd,artifact.path),file,constants.COPYFILE_EXCL);
      artifact.evidenceFile=path.relative(root,file);
      evidence.push({file:artifact.evidenceFile,sha256:artifact.sha256});
    }
    for(const log of logs) for(const file of [log.stdoutFile,log.stderrFile]) evidence.push({file:path.relative(root,file),sha256:await sha256(file)});
    const record={schemaVersion:1,kind:scenario.kind,scenario:id,provider,runId,appId,stage:flags.stage||'bench',status,failure,sourceCommit:git.stdout.trim(),startedAt,commandFinishedAt,finishedAt,durationMs,commandDurationMs,nativeCompletion,baseline,readiness,reuse,artifacts,toolVersion:qualification.toolVersion,environment:{...qualification.environment,runner:os.hostname(),platform:os.platform(),arch:os.arch(),node:process.version,cpu:os.cpus()[0]?.model,cores:os.availableParallelism(),memoryBytes:os.totalmem()},cacheEvidence,settings:qualification.settings,evidence,commands:logs};
    if(rolloutAdmission)record.rolloutAdmission=rolloutAdmission;
    validateRecord(record); await saveResult(resultFile,record);
    console.log(JSON.stringify(record,null,2)); if(status!=='passed') process.exitCode=1;
  } else if(operation==='record-managed') {
    const record=validateRecord(await json(id));
    const scenario=await scenarioById(record.scenario);if(!scenario.providers.includes(record.provider))throw Error('Provider is not supported by this test');if(record.kind!==scenario.kind)throw Error('Record kind differs from selected test');safeId(record.provider);safeId(record.runId);
    if(!record.qualificationFile)throw Error('Imported results require a reviewed qualificationFile');
    const {checkQualification}=await import('./qualification.mjs');const qualification=await json(path.resolve(root,record.qualificationFile));await checkQualification(qualification,scenario,record.provider);
    if(record.stage!==qualification.stage||record.appId!==qualification.appId||record.environment.region!==qualification.environment.region||record.status==='passed'&&record.cacheEvidence.series!==qualification.cacheEvidence.series||record.toolVersion.reported!==qualification.toolVersion.reported||record.toolVersion.sha256!==qualification.toolVersion.sha256)throw Error('Imported application/version/environment/cache metadata differs from qualification');
    const contains=(actual,want)=>Array.isArray(want)?Array.isArray(actual)&&actual.length===want.length&&want.every((v,i)=>contains(actual[i],v)):want&&typeof want==='object'?actual&&Object.entries(want).every(([k,v])=>contains(actual[k],v)):actual===want;
    if(record.status==='passed'&&record.kind==='deploy'){
      for(const expectedProbe of qualification.probes){const observation=record.readiness.observations.find(o=>o.name===expectedProbe.name);const expected=structuredClone(expectedProbe.expected);if(expectedProbe.body&&Object.hasOwn(expectedProbe.body,'jobId'))delete expected.jobId;
        if(!observation||!contains(observation.observed,expected))throw Error('Imported business response differs from qualification: '+expectedProbe.name);
        if(record.scenario.includes('-git-')){const after=record.postCompletionReadiness.observations.find(o=>o.name===expectedProbe.name);if(!after||!contains(after.observed,expected))throw Error('Imported post-terminal business response differs from qualification: '+expectedProbe.name);}
        if(record.scenario.endsWith('-cli')) {const after=record.nativeCompletion.postCompletionReadiness.observations.find(o=>o.name===expectedProbe.name);if(!after||!contains(after.observed,expected)||!Number.isFinite(Date.parse(after.observedAt))||Date.parse(after.observedAt)<Date.parse(record.nativeCompletion.finishedAt))throw Error('Imported post-completion business response differs from qualification: '+expectedProbe.name);}
      }
    }
    if(record.status==='passed'&&record.kind==='package') {
      if(record.artifacts.format!==qualification.artifacts.format)throw Error('Imported artifact format differs from qualification');
      if(scenario.fixture.startsWith('lambda-')) {
        const key=f=>JSON.stringify({name:f.name,role:f.role||'function'});
        if(JSON.stringify(record.artifacts.files.map(key).sort())!==JSON.stringify(qualification.artifacts.files.map(key).sort()))throw Error('Imported upload artifact roles/names differ from qualification');
        if(record.artifacts.nativeManifest)for(const file of record.artifacts.nativeManifest.files.filter(f=>(f.role||'function')==='function')){const declared=qualification.artifacts.files.find(f=>f.name===file.name&&(f.role||'function')==='function');if(file.handler!==declared.handler||file.module!==declared.module||declared.resourceName&&file.resourceName!==declared.resourceName)throw Error('Imported native function binding differs from qualification');}
      }
    }
    for(const item of qualification.qualificationEvidence)if(await sha256(path.resolve(root,item.file))!==item.sha256)throw Error('Qualification evidence checksum mismatch');
    if(record.status==='passed'){const proof=await readCacheEvidence(record.cacheEvidence.proofFile,record.cacheEvidence);if(proof.proofSHA!==record.cacheEvidence.proofSHA)throw Error('Cache proof checksum differs from imported record');if(JSON.stringify(proof)!==JSON.stringify(record.cacheEvidence))throw Error('Imported cache evidence differs from its immutable proof');}
    await verifyImportedPredecessor(record);
    for(const item of record.evidence) { if(!item.file||!item.sha256) throw Error('Evidence requires file and SHA256'); if(await sha256(path.resolve(root,item.file))!==item.sha256) throw Error('Evidence checksum mismatch: '+item.file); }
    if(record.status==='passed'&&record.kind==='package'&&record.artifacts.format==='oci-compressed') {
      const selected=qualification.artifacts.images[0];
      if(record.artifacts.name!==selected.name||record.artifacts.platform!==(qualification.artifacts.platform||'linux/amd64')||selected.expectedDigest&&record.artifacts.manifestDigest!==selected.expectedDigest)throw Error('Imported OCI image/platform/digest differs from qualification');
      const {verifyImportedOci}=await import('./sizes.mjs');await verifyImportedOci(record);
    }
    if(record.status==='passed'&&record.kind==='package'&&record.artifacts.format==='lambda-zip') {
      const {verifyImportedLambda}=await import('./sizes.mjs');await verifyImportedLambda(record);
    }
    if(record.status==='passed'&&record.kind==='package'&&record.artifacts.format==='provider-native') {
      const {verifyImportedNativePackage}=await import('./lib.mjs');await verifyImportedNativePackage(record);
      const observation=record.artifacts.businessVerification.observations[0];
      if(record.artifacts.name!==qualification.artifacts.name||!contains(observation.observed,qualification.artifacts.businessExpected))throw Error('Imported native API business response differs from qualification');
    }
    await saveResult(path.join(root,'results/raw',record.runId+'-'+record.provider+'.json'),record); console.log('Recorded '+record.runId);
  } else { console.log('Commands: list | describe TEST | prepare TEST PROVIDER [--run-id ID] | run TEST PROVIDER --execute --qualification FILE | record-managed FILE'); if(operation) process.exitCode=1; }
} catch(e) { console.error(e.message); process.exitCode=1; }

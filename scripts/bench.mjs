#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import {mkdir,readFile} from 'node:fs/promises';
import {root,json,save,saveResult,refuseExistingResult,scenarios,scenarioById,parseArgs,safeId,command,sha256,validateRecord} from './lib.mjs';
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
    await checkQualification(qualification,scenario,provider);
    for(const item of qualification.qualificationEvidence) if(await sha256(path.resolve(root,item.file))!==item.sha256) throw Error('Qualification evidence checksum mismatch');
    if(provider==='candidate'&&await sha256(process.env.CANDIDATE_CLI)!==qualification.toolVersion.sha256) throw Error('Candidate executable hash differs from qualification');
    if(scenario.kind==='deploy'&&['candidate','serverless','sst','cdk'].includes(provider)){
      if(!/^\d{12}$/.test(qualification.environment.accountId||''))throw Error('Deployment qualification needs the expected AWS account ID');
      const identity=await command(['aws','sts','get-caller-identity','--region',qualification.environment.region,'--output','json']);
      if(identity.exitCode!==0||JSON.parse(identity.stdout).Account!==qualification.environment.accountId)throw Error('Authenticated AWS account differs from qualification');
    }
    let baseline,componentsBefore;
    if(scenario.fixture==='five-services'){const {captureComponents}=await import('./component-state.mjs');componentsBefore=await captureComponents(qualification.componentSnapshots);}
    if(scenario.kind==='deploy') {const {probe}=await import('./probe.mjs');baseline=await probe(qualification.baselineProbes,{timeoutMs:30000});}
    const git=await command(['git','rev-parse','HEAD']); if(git.exitCode!==0) throw Error('Commit the benchmark sources first');
    const dirty=await command(['git','status','--porcelain']); if(dirty.stdout.trim()) throw Error('Commit all source changes before timing');
    const commands=plan.commands[scenario.kind==='package'?'package':'update'];
    if(!Array.isArray(commands)||!commands.length) throw Error('No executable native command for this measurement');
    const startedAt=new Date().toISOString(),start=performance.now();
    const logs=[]; let status='passed',failure;
    const evidenceDir=path.join(root,'.work','evidence',runId,provider);await mkdir(evidenceDir,{recursive:true});
    for(let i=0;i<commands.length;i++) {
      const stdoutFile=path.join(evidenceDir,`command-${i}.stdout.log`),stderrFile=path.join(evidenceDir,`command-${i}.stderr.log`);
      const result=await command(commands[i],{cwd:plan.cwd,env:plan.env||{},stdoutFile,stderrFile});
      logs.push({argv:result.argv,exitCode:result.exitCode,durationMs:result.durationMs,stdoutFile,stderrFile});
      if(result.exitCode!==0) {status='failed';failure=`Native command ${i+1} failed`;break;}
    }
    const commandFinishedAt=new Date().toISOString(),commandDurationMs=performance.now()-start;
    let readiness={verified:false},artifacts={complete:false};
    if(status==='passed'&&scenario.kind==='deploy') {
      const {probe}=await import('./probe.mjs');
      try { readiness=await probe(qualification.probes,{timeoutMs:qualification.timeoutMs||900000}); } catch(e){status='failed';failure=e.message;}
    }
    if(status==='passed'&&scenario.kind==='package') {
      const {collectArtifacts}=await import('./sizes.mjs');
      try {
        artifacts=await collectArtifacts(qualification.artifacts,plan.cwd);
        if(scenario.fixture.startsWith('lambda-')) {
          const bindings=path.join(evidenceDir,'artifact-bindings.json');await save(bindings,qualification.artifacts);
          const stdoutFile=path.join(evidenceDir,'packaged-business.stdout.log'),stderrFile=path.join(evidenceDir,'packaged-business.stderr.log');
          const checked=await command(['node',path.join(root,'providers/check-lambda-zips.mjs'),bindings,path.join(root,'fixtures/manifest.json'),scenario.fixture,plan.cwd],{cwd:plan.cwd,stdoutFile,stderrFile});
          logs.push({...checked,stdoutFile,stderrFile,phase:'verification-outside-timer'});
          if(checked.exitCode!==0)throw Error('Complete ZIP business/revision verification failed: '+checked.stderr.slice(-2000));
          artifacts.businessVerification=JSON.parse(checked.stdout.trim().split('\n').at(-1));
        }
      } catch(e){status='unqualified';failure=e.message;}
    }
    const finish=performance.now(),finishedAt=new Date().toISOString();
    let reuse;
    if(status==='passed'&&scenario.fixture==='five-services'){try{const {captureComponents,compareUnchanged}=await import('./component-state.mjs');reuse=compareUnchanged(componentsBefore,await captureComponents(qualification.componentSnapshots));}catch(e){status='failed';failure=e.message;}}
    const evidence=[];
    for(const log of logs) for(const file of [log.stdoutFile,log.stderrFile]) evidence.push({file:path.relative(root,file),sha256:await sha256(file)});
    const record={schemaVersion:1,kind:scenario.kind,scenario:id,provider,runId,appId,stage:flags.stage||'bench',status,failure,sourceCommit:git.stdout.trim(),startedAt,commandFinishedAt,finishedAt:scenario.kind==='package'?commandFinishedAt:finishedAt,durationMs:scenario.kind==='package'?commandDurationMs:finish-start,commandDurationMs,baseline,readiness,reuse,artifacts,toolVersion:qualification.toolVersion,environment:{runner:os.hostname(),platform:os.platform(),arch:os.arch(),node:process.version,cpu:os.cpus()[0]?.model,cores:os.availableParallelism(),memoryBytes:os.totalmem(),...qualification.environment},cacheEvidence:qualification.cacheEvidence,settings:qualification.settings,evidence,commands:logs};
    validateRecord(record); await saveResult(resultFile,record);
    console.log(JSON.stringify(record,null,2)); if(status!=='passed') process.exitCode=1;
  } else if(operation==='record-managed') {
    const record=validateRecord(await json(id));
    const scenario=await scenarioById(record.scenario);if(!scenario.providers.includes(record.provider))throw Error('Provider is not supported by this test');if(record.kind!==scenario.kind)throw Error('Record kind differs from selected test');safeId(record.provider);safeId(record.runId);
    if(!record.qualificationFile)throw Error('Imported results require a reviewed qualificationFile');
    const {checkQualification}=await import('./qualification.mjs');const qualification=await json(path.resolve(root,record.qualificationFile));await checkQualification(qualification,scenario,record.provider);
    if(record.stage!==qualification.stage||record.appId!==qualification.appId||record.environment.region!==qualification.environment.region||record.cacheEvidence.series!==qualification.cacheEvidence.series||record.toolVersion.reported!==qualification.toolVersion.reported||record.toolVersion.sha256!==qualification.toolVersion.sha256)throw Error('Imported application/version/environment/cache metadata differs from qualification');
    if(record.status==='passed'&&record.kind==='deploy'){
      for(const expectedProbe of qualification.probes){const observation=record.readiness.observations.find(o=>o.name===expectedProbe.name);const expected=structuredClone(expectedProbe.expected);if(expectedProbe.body&&Object.hasOwn(expectedProbe.body,'jobId'))delete expected.jobId;
        const contains=(actual,want)=>Array.isArray(want)?Array.isArray(actual)&&actual.length===want.length&&want.every((v,i)=>contains(actual[i],v)):want&&typeof want==='object'?actual&&Object.entries(want).every(([k,v])=>contains(actual[k],v)):actual===want;
        if(!observation||!contains(observation.observed,expected))throw Error('Imported business response differs from qualification: '+expectedProbe.name);
      }
    }
    if(record.status==='passed'&&record.kind==='package'&&scenario.fixture.startsWith('lambda-')){const names=qualification.artifacts.files.filter(f=>(f.role||'function')==='function').map(f=>f.name).sort();if(JSON.stringify(record.artifacts.files.filter(f=>f.role==='function').map(f=>f.name).sort())!==JSON.stringify(names))throw Error('Imported function artifacts differ from qualification');}
    for(const item of qualification.qualificationEvidence)if(await sha256(path.resolve(root,item.file))!==item.sha256)throw Error('Qualification evidence checksum mismatch');
    for(const item of record.evidence) { if(!item.file||!item.sha256) throw Error('Evidence requires file and SHA256'); if(await sha256(path.resolve(root,item.file))!==item.sha256) throw Error('Evidence checksum mismatch: '+item.file); }
    await saveResult(path.join(root,'results/raw',record.runId+'-'+record.provider+'.json'),record); console.log('Recorded '+record.runId);
  } else { console.log('Commands: list | describe TEST | prepare TEST PROVIDER [--run-id ID] | run TEST PROVIDER --execute --qualification FILE | record-managed FILE'); if(operation) process.exitCode=1; }
} catch(e) { console.error(e.message); process.exitCode=1; }

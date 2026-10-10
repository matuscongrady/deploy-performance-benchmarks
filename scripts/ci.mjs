#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, appendFile, chmod } from 'node:fs/promises';
import { root, scenarioById, safeId, command, sha256 } from './lib.mjs';
import { prepare, versions } from '../providers/index.mjs';
import { checkQualification } from './qualification.mjs';
import { probe } from './probe.mjs';
import {validateExistingApplication,verifyExistingApplication} from './existing-app.mjs';

const modes = new Set(['--plan-only','--validate-only','--fetch-candidate','--run']);
const [mode = '--plan-only', planScenario] = process.argv.slice(2);
const directory = path.join(root,'.work','ci-evidence');
const binary = path.join(root,'.work','ci-tools','candidate');
const allowedProviders = ['candidate','serverless','sst','cdk'];
const secrets = ['SERVERLESS_ACCESS_KEY','BENCH_CANDIDATE_ARTIFACT_TOKEN','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN'].map(key=>process.env[key]).filter(Boolean);
function redact(value) {
  let result = String(value);
  for(const secret of secrets) result=result.split(secret).join('<redacted>');
  return result.replace(/\b\d{12}\b/g,'<account-id>');
}
function requireValue(name) {const value=process.env[name];if(!value)throw Error(`Missing ${name}`);return value;}
function validateProbeCommands(q, region) {
  for(const spec of [...q.baselineProbes,...q.probes]) {
    if(spec.url) {const url=new URL(spec.url);if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw Error('CI HTTP probes must use HTTP(S) without embedded credentials');}
    else if(spec.argv) {
      const argv=spec.argv;
      if(argv[0]!=='node'||!/^scripts\/invoke-lambda\.mjs$/.test(argv[1]||'')||argv.length<3||argv.length>5)throw Error('CI command probes must use node scripts/invoke-lambda.mjs FUNCTION REGION PAYLOAD');
      if(argv[3] && argv[3]!==region)throw Error('Lambda probe region differs from the qualified deployment');
      spec.argv=[process.execPath,path.join(root,'scripts/invoke-lambda.mjs'),argv[2],region,argv[4]||'{}'];spec.cwd=root;
    } else throw Error('Missing HTTPS or native Lambda probe');
  }
  for(const spec of q.componentSnapshots||[]) {
    const argv=spec.argv;
    if(!Array.isArray(argv)||argv.length!==6||argv[0]!=='node'||argv[1]!=='scripts/component-state.mjs'||argv[2]!=='ecs'||argv[3]!==region)throw Error('CI component snapshots must use node scripts/component-state.mjs ecs REGION CLUSTER SERVICE');
    spec.argv=[process.execPath,path.join(root,'scripts/component-state.mjs'),...argv.slice(2)];spec.cwd=root;
  }
}
async function configuration({qualified=false}={}) {
  if(qualified&&process.env.BENCH_CI_ENABLED!=='true')throw Error('CI cloud deployment is disabled; BENCH_CI_ENABLED must be exactly true');
  if(!modes.has(mode)||process.argv.length>4||(planScenario&&mode!=='--plan-only'))throw Error('Usage: node scripts/ci.mjs --plan-only [SCENARIO] | --validate-only | --fetch-candidate | --run');
  const selection=planScenario?{scenario:planScenario}:JSON.parse(await readFile(path.join(root,'.benchmark-test.json'),'utf8'));
  const scenario=await scenarioById(selection.scenario);
  const provider=requireValue('BENCH_PROVIDER');
  if(scenario.kind!=='deploy'||!scenario.journey.startsWith('git-')||!scenario.providers.includes(provider)||!allowedProviders.includes(provider))throw Error('This workflow supports qualified Git deployments on candidate, Serverless Framework, SST and CDK');
  const appId=safeId(requireValue('BENCH_APP_ID'),'application ID');
  const region=requireValue('BENCH_REGION');
  const stage=process.env.BENCH_STAGE||'bench';
  let sourceCommit=process.env.GITHUB_SHA||(await command(['git','rev-parse','HEAD'])).stdout.trim();
  const branch=process.env.GITHUB_REF_NAME||(await command(['git','branch','--show-current'])).stdout.trim();
  if(!/^[a-f0-9]{40}$/.test(sourceCommit)) {if(qualified)throw Error('A full source commit SHA is required');sourceCommit='uncommitted';}
  if(qualified&&!/^trial\/[a-z0-9-]+$/.test(branch))throw Error('CI deployment is restricted to neutral trial/... branches');
  if(provider==='candidate')process.env.CANDIDATE_CLI=binary;
  const outputDir=path.join(root,'.work',appId,provider);
  const plan=await prepare({provider,scenario,outputDir,repoRoot:root,runId:appId,region,stage});
  if(!Array.isArray(plan.commands.update)||!plan.commands.update.length)throw Error('No native update command exists');
  const lockInputs=[await sha256(path.join(root,'fixtures/manifest.json'))];
  if(provider!=='candidate')lockInputs.push(await sha256(path.join(root,'providers/tools',provider,'package-lock.json')));
  const manifest=JSON.parse(await readFile(path.join(root,'fixtures/manifest.json'),'utf8'));
  const contexts=scenario.fixture.startsWith('lambda-')?[manifest.lambda.context]:scenario.fixture==='five-services'?manifest.fiveServices.services.map(s=>s.buildContext):[manifest.containers.find(c=>c.id==='container-'+scenario.fixture).buildContext];
  for(const context of contexts) {const lock=path.join(root,context,scenario.fixture==='python'?'requirements.txt':'package-lock.json');lockInputs.push(await sha256(lock));}
  const cachePaths=[path.join(os.homedir(),'.npm')];
  if(provider==='sst')cachePaths.push(path.join(outputDir,'.sst/platform/node_modules'));
  // No framework state, credentials, qualification files or arbitrary user paths are cached.
  const keyPrefix=`bench-v1-linux-node22-${provider}-${scenario.fixture}-${appId}-${createHash('sha256').update(lockInputs.join(':')).digest('hex').slice(0,20)}`;
  const cache={paths:cachePaths,key:keyPrefix+'-'+sourceCommit,restorePrefix:keyPrefix+'-',requested:scenario.journey==='git-repeat'};
  let qualification;
  if(qualified) {
    if(process.version!=='v22.22.0')throw Error('Measured CI must use Node.js 22.22.0');
    if(!/^arn:aws:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/.test(requireValue('BENCH_AWS_ROLE_ARN')))throw Error('Invalid benchmark OIDC role');
    try {qualification=JSON.parse(requireValue('BENCH_QUALIFICATION_JSON'));}catch {throw Error('BENCH_QUALIFICATION_JSON must contain valid JSON');}
    await checkQualification(qualification,scenario,provider);
    if(qualification.appId!==appId||qualification.environment.region!==region||qualification.stage!==stage)throw Error('Qualification must match the existing application ID, stage and region');
    if(!/^\d{12}$/.test(qualification.environment.accountId||''))throw Error('Qualification needs the disposable AWS account ID');
    if(requireValue('BENCH_AWS_ROLE_ARN').split(':')[4]!==qualification.environment.accountId)throw Error('OIDC role account differs from the qualified disposable account');
    validateExistingApplication(qualification,provider);
    if(qualification.pipeline?.branch!==branch||qualification.pipeline?.sourceCommit!==sourceCommit||!qualification.pipeline?.configurationEvidence)throw Error('Qualification must match the exact pushed branch and source commit');
    if(qualification.pipeline.workflowSha256!==await sha256(path.join(root,'.github/workflows/deploy-benchmark.yml')))throw Error('Qualification must bind the reviewed deployment workflow SHA-256');
    if(scenario.journey==='git-repeat') {const time=Date.parse(qualification.previousReadyAt);if(!Number.isFinite(time)||Date.now()-time<900000)throw Error('Repeat pushes require at least 15 minutes since previous verified readiness');}
    validateProbeCommands(qualification,region);
    if(provider==='serverless')requireValue('SERVERLESS_ACCESS_KEY');
    if(provider==='candidate') {
      const url=new URL(requireValue('BENCH_CANDIDATE_ARTIFACT_URL'));
      if(url.protocol!=='https:'||url.username||url.password)throw Error('Candidate artifact must be an HTTPS URL without embedded credentials');
      if(!/^[a-f0-9]{64}$/.test(requireValue('BENCH_CANDIDATE_SHA256'))||process.env.BENCH_CANDIDATE_SHA256!==qualification.toolVersion.sha256)throw Error('Candidate artifact hash must match qualification');
    }
  }
  return {scenario,provider,appId,region,stage,sourceCommit,branch,plan,cache,qualification};
}
async function fetchCandidate(config) {
  if(config.provider!=='candidate')throw Error('Candidate download is only valid for the candidate provider');
  const original=new URL(process.env.BENCH_CANDIDATE_ARTIFACT_URL);let target=original;
  let response;
  for(let attempt=0;attempt<6;attempt++) {
    const headers={};
    if(target.hostname===original.hostname&&process.env.BENCH_CANDIDATE_ARTIFACT_TOKEN)headers.authorization='Bearer '+process.env.BENCH_CANDIDATE_ARTIFACT_TOKEN;
    response=await fetch(target,{headers,redirect:'manual',signal:AbortSignal.timeout(180000)});
    if([301,302,303,307,308].includes(response.status)) {await response.body?.cancel();target=new URL(response.headers.get('location'),target);if(target.protocol!=='https:'||target.username||target.password)throw Error('Unsafe candidate download redirect');continue;}
    break;
  }
  if(!response.ok||response.status>=300)throw Error('Candidate download failed');
  const max=256*1024*1024;if(Number(response.headers.get('content-length'))>max)throw Error('Candidate executable exceeds 256 MB');
  const chunks=[];let bytes=0;
  for await(const chunk of response.body) {bytes+=chunk.length;if(bytes>max)throw Error('Candidate executable exceeds 256 MB');chunks.push(chunk);}
  const data=Buffer.concat(chunks);
  if(createHash('sha256').update(data).digest('hex')!==process.env.BENCH_CANDIDATE_SHA256)throw Error('Candidate executable checksum mismatch');
  await mkdir(path.dirname(binary),{recursive:true});await writeFile(binary,data);await chmod(binary,0o700);
  console.log('Downloaded and checksum-verified the reviewed candidate executable.');
}
async function execute(argv,cwd,index) {
  if(!Array.isArray(argv)||!argv.length||argv.some(arg=>typeof arg!=='string'||arg.includes('<CANDIDATE')))throw Error('Native command plan is not executable');
  const response=await command(argv,{cwd,timeoutMs:1800000});
  const name=`command-${String(index).padStart(2,'0')}`;
  await writeFile(path.join(directory,name+'.stdout.log'),redact(response.stdout));
  await writeFile(path.join(directory,name+'.stderr.log'),redact(response.stderr));
  const record={argv:argv.map(redact),exitCode:response.exitCode,durationMs:response.durationMs,startedAt:response.startedAt,finishedAt:response.finishedAt,stdout:name+'.stdout.log',stderr:name+'.stderr.log'};
  return {record,stdout:response.stdout};
}
async function run(config) {
  const {scenario,provider,qualification:q,plan,cache}=config;
  await mkdir(directory,{recursive:true});
  const report={schemaVersion:1,sourceCommit:config.sourceCommit,branch:config.branch,scenario:scenario.id,provider,appId:config.appId,stage:config.stage,region:config.region,status:'running',startedAt:new Date().toISOString(),runner:{host:os.hostname(),platform:os.platform(),arch:os.arch(),image:process.env.ImageOS,imageVersion:process.env.ImageVersion,node:process.version,cpu:os.cpus()[0]?.model,cores:os.availableParallelism(),memoryBytes:os.totalmem(),githubRunId:process.env.GITHUB_RUN_ID,githubRunAttempt:process.env.GITHUB_RUN_ATTEMPT},cache:{...cache,exactKeyHit:process.env.BENCH_CACHE_HIT==='true',restored:Boolean(process.env.BENCH_CACHE_MATCHED_KEY),matchedKey:process.env.BENCH_CACHE_MATCHED_KEY||null,note:'A cache restore hit is not proof that a compiler or remote image builder reused work.'},commands:[]};
  try {
    const identity=await command(['aws','sts','get-caller-identity','--query','Account','--output','text'],{timeoutMs:30000});
    if(identity.exitCode!==0||identity.stdout.trim()!==q.environment.accountId)throw Error('OIDC credentials do not match the qualified disposable account');
    report.existingApplication=await verifyExistingApplication({q,provider,appName:plan.appName,region:config.region});
    report.baseline=await probe(q.baselineProbes,{timeoutMs:30000});
    let componentsBefore;
    if(scenario.fixture==='five-services') {const {captureComponents}=await import('./component-state.mjs');componentsBefore=await captureComponents(q.componentSnapshots);}
    let index=0;
    async function step(argv) {
      const result=await execute(argv,plan.cwd,index++);report.commands.push(result.record);
      if(result.record.exitCode!==0)throw Error(`Native command ${index-1} failed; inspect its saved logs`);
      return result;
    }
    for(const argv of plan.commands.install||[])await step(argv);
    const executable=provider==='candidate'?binary:path.join(root,'providers/tools',provider,'node_modules/.bin',provider);
    if(provider==='candidate'&&await sha256(binary)!==q.toolVersion.sha256)throw Error('Candidate checksum differs from qualification');
    const version=await step([executable,'--version']);
    const expected=provider==='candidate'?q.toolVersion.reported:versions[provider];
    if(!version.stdout.includes(expected))throw Error('Native executable version differs from the qualified pinned version');
    report.toolVersion={reported:redact(version.stdout.trim()),sha256:provider==='candidate'?await sha256(binary):undefined};
    for(const argv of plan.commands.update)await step(argv);
    report.readiness=await probe(q.probes,{timeoutMs:q.timeoutMs||900000});
    if(scenario.fixture==='five-services') {const {captureComponents,compareUnchanged}=await import('./component-state.mjs');report.reuse=compareUnchanged(componentsBefore,await captureComponents(q.componentSnapshots));}
    report.status='passed';
  } catch(error) {report.status='failed';report.failure=redact(error.message);throw error;}
  finally {report.finishedAt=new Date().toISOString();await writeFile(path.join(directory,'ci-evidence.json'),redact(JSON.stringify(report,null,2))+'\n');}
  console.log('Native update and all business/revision probes passed. CI evidence is diagnostic; the external Git-push runner owns the complete timer.');
}
try {
  const config=await configuration({qualified:mode!=='--plan-only'});
  if(mode==='--plan-only')console.log(JSON.stringify({scenario:config.scenario.id,provider:config.provider,appId:config.appId,sourceCommit:config.sourceCommit,cache:config.cache,commands:config.plan.commands,notice:'Prepared only. No install, credential request, build or deployment ran.'},null,2));
  if(mode==='--validate-only') {
    if(process.env.GITHUB_OUTPUT)await appendFile(process.env.GITHUB_OUTPUT,`scenario=${config.scenario.id}\njourney=${config.scenario.journey}\ncache_key=${config.cache.key}\ncache_prefix=${config.cache.restorePrefix}\ncache_paths<<CACHE_PATHS\n${config.cache.paths.join('\n')}\nCACHE_PATHS\n`);
    console.log('Selected source commit, qualification, existing application and workflow match.');
  }
  if(mode==='--fetch-candidate')await fetchCandidate(config);
  if(mode==='--run')await run(config);
} catch(error) {console.error(redact(error.message));process.exitCode=1;}

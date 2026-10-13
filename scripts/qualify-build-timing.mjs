#!/usr/bin/env node
// Explicitly untimed native-boundary qualification. This never creates a measured result.
import path from 'node:path';
import {mkdir,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {root,json,parseArgs,scenarioById,safeId,command,sha256,saveResult,refuseExistingResult} from './lib.mjs';
import {checkQualification} from './qualification.mjs';
import {reviewBuildFiles,captureBuildInputs,collectBuildTiming,verifyImportedBuildTiming,buildClock,buildScope} from './build-timing.mjs';
import {collectArtifacts} from './sizes.mjs';
import {prepare} from '../providers/index.mjs';
import {buildTimingDefaults} from '../providers/build-timing.mjs';

const {positional,flags}=parseArgs(process.argv.slice(2));
try {
  const [scenarioId,provider]=positional,scenario=await scenarioById(scenarioId);
  if(scenario.kind!=='package'||!scenario.fixture.startsWith('lambda-')||!['candidate','serverless','sst','cdk'].includes(provider))throw Error('Boundary qualification supports the selected Lambda packaging recipes');
  if(!flags.execute)throw Error('Native boundary qualification requires explicit --execute after native uploaded/runtime parity');
  const q=await json(path.resolve(root,flags.qualification||''));
  // A preliminary qualification binds native uploaded artifacts; the new stage proof is added only after this succeeds.
  if(q.buildTiming)throw Error('Start with a fresh native artifact qualification without a reused buildTiming proof');
  await checkQualification(q,scenario,provider,{sourceBound:true});
  for(const e of q.qualificationEvidence)if(await sha256(path.resolve(root,e.file))!==e.sha256)throw Error('Native parity evidence checksum mismatch');
  if(provider==='candidate'&&await sha256(process.env.CANDIDATE_CLI)!==q.toolVersion.sha256)throw Error('Candidate executable differs from native qualification');
  const campaignId=safeId(flags['campaign-id'],'campaign ID'),runId=safeId(flags['run-id'],'qualification attempt');
  const dir=path.join(root,'.work/evidence',runId,provider);await mkdir(dir,{recursive:true});
  const resultFile=path.join(dir,'build-boundary-qualification.json');await refuseExistingResult(resultFile);
  const source=await command(['git','rev-parse','HEAD']),dirty=await command(['git','status','--porcelain']);if(source.exitCode!==0||dirty.stdout.trim())throw Error('Qualification source must be committed and clean');
  const appId=safeId(q.appId),plan=await prepare({provider,scenario,outputDir:path.join(root,'.work',appId,provider),repoRoot:root,runId:appId,region:q.environment.region,stage:q.stage,nativeBindings:q.nativeBindings||{}});
  const defaults=provider==='candidate'?{configurationFiles:['candidate.yml'],instrumentationFiles:['providers/candidate-artifacts.mjs']}:buildTimingDefaults[provider];
  const spec={required:true,campaignId,scope:buildScope,clock:buildClock,producer:provider==='candidate'?'candidate-trace':'native-markers',...defaults};
  const reviewed=await reviewBuildFiles({qualification:spec,project:plan.cwd,repository:root});Object.assign(spec,{configurationSha256:reviewed.configurationSha256,instrumentationSha256:reviewed.instrumentationSha256});
  const identity={provider,runId,sourceCommit:source.stdout.trim(),appId,fixture:scenario.fixture,toolVersion:q.toolVersion};
  const input=await captureBuildInputs({qualification:spec,identity,project:plan.cwd,repository:root,file:path.join(dir,'build-inputs.json')});
  const nativeFile=path.join(dir,provider==='candidate'?'native-build-trace.json':'native-build-markers.json');await refuseExistingResult(nativeFile);
  const env={...plan.env,BENCH_PROVIDER:provider,BENCH_RUN_ID:runId,BENCH_SOURCE_COMMIT:identity.sourceCommit,BENCH_APP_ID:appId,BENCH_FIXTURE:scenario.fixture,BENCH_BUILD_TIMING_FILE:nativeFile,BENCH_BUILD_INPUT_MANIFEST:input.file,BENCH_BUILD_INPUT_MANIFEST_SHA256:input.sha256,BENCH_BUILD_CONFIG_SHA256:input.manifest.configurationSha256};
  if(provider==='candidate')Object.assign(env,{STP_TIMINGS_FILE:nativeFile,STP_TIMINGS_BINDINGS_SHA256:input.sha256,STP_TIMINGS_CONFIG_SHA256:input.manifest.configurationSha256});
  const logs=[],evidence=[{file:path.relative(root,input.file),sha256:input.sha256}],startedAt=new Date().toISOString(),operation={clock:buildClock,startNs:process.hrtime.bigint().toString()};
  for(const [i,argv]of plan.commands.package.entries()){const stdoutFile=path.join(dir,`command-${i}.stdout.log`),stderrFile=path.join(dir,`command-${i}.stderr.log`);const r=await command(argv,{cwd:plan.cwd,env,stdoutFile,stderrFile});logs.push({argv:r.argv,pid:r.pid,exitCode:r.exitCode,stdoutFile,stderrFile});if(r.exitCode!==0)throw Error('Native qualification command failed; preserve its original logs and trace');}
  operation.endNs=process.hrtime.bigint().toString();const commandFinishedAt=new Date().toISOString();
  const artifacts=await collectArtifacts(q.artifacts,plan.cwd,{...identity,startedAt,commandFinishedAt});
  const buildTiming=await collectBuildTiming({spec,identity,input,nativeFile,operation,commands:logs,artifacts,base:root});evidence.push(buildTiming.nativeEvidence);
  for(const f of [...artifacts.files,...(artifacts.proofs||[])]){const dest=path.join(dir,'artifacts',f.path);await mkdir(path.dirname(dest),{recursive:true});await copyFile(path.resolve(plan.cwd,f.path),dest,constants.COPYFILE_EXCL);f.evidenceFile=path.relative(root,dest);evidence.push({file:f.evidenceFile,sha256:f.sha256});}
  const bindings=path.join(dir,'artifact-bindings.json');await saveResult(bindings,artifacts.nativeManifest?{...q.artifacts,files:artifacts.nativeManifest.files}:q.artifacts);
  const stdoutFile=path.join(dir,'business.stdout.log'),stderrFile=path.join(dir,'business.stderr.log');const checked=await command([process.execPath,path.join(root,'providers/check-lambda-zips.mjs'),bindings,path.join(root,'fixtures/manifest.json'),scenario.fixture,plan.cwd],{cwd:plan.cwd,stdoutFile,stderrFile});if(checked.exitCode!==0)throw Error('Complete native ZIP/layer business qualification failed');artifacts.businessVerification=JSON.parse(checked.stdout.trim().split('\n').at(-1));
  for(const log of [...logs,{stdoutFile,stderrFile}])for(const file of [log.stdoutFile,log.stderrFile])evidence.push({file:path.relative(root,file),sha256:await sha256(file)});
  const record={schemaVersion:1,kind:'package',status:'passed',scenario:scenario.id,...identity,durationMs:Number(BigInt(operation.endNs)-BigInt(operation.startNs))/1e6,operationTiming:operation,buildTiming,commands:logs,artifacts,evidence,classification:'qualification-only',measuredSamples:0};
  await verifyImportedBuildTiming(record,{base:root});await saveResult(resultFile,record);
  spec.qualificationEvidence=[{file:path.relative(root,resultFile),sha256:await sha256(resultFile)}];
  const output=path.resolve(root,flags.output||path.join(dir,'qualified-build-settings.json'));await saveResult(output,spec);
  console.log(JSON.stringify({qualified:true,classification:'qualification-only',measuredSamples:0,settingsFile:path.relative(root,output),proofFile:path.relative(root,resultFile),proofSHA256:spec.qualificationEvidence[0].sha256}));
} catch(e){console.error(e.message);process.exitCode=1;}

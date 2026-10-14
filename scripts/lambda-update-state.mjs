import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {gunzipSync} from 'node:zlib';

// Lambda code-update observations. The caller supplies the existing, secret-safe
// command runner; raw get-function responses never leave this observer.
const hash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function canonical(value) {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));
  return value;
}
export function validateLambdaBindings(q,provider) {
  const names=q.baselineProbes?.map(p=>p.name).sort();
  if(!names?.length||!Array.isArray(q.nativeResources)||q.nativeResources.length!==names.length||!isDeepStrictEqual(q.nativeResources.map(r=>r.name).sort(),names))throw Error('Lambda admission requires every qualified native function');
  const prefix=`arn:aws:lambda:${q.environment.region}:${q.environment.accountId}:function:`;
  if(q.nativeResources.some(r=>r.type!=='lambda'||!r.arn?.startsWith(prefix)))throw Error('Lambda bindings differ from the qualified account/region');
  if(!q.nativeBindings?.owner)throw Error('Lambda admission requires an explicit task owner');
  if(provider!=='sst'&&!q.nativeStackName)throw Error('Lambda admission requires the existing CloudFormation stack');
  if(provider==='candidate'&&!q.nativeDeploymentBucket)throw Error('Candidate admission requires its owned deployment bucket');
  if(provider==='sst'&&(!q.nativeStateBucket||!q.nativeAppName))throw Error('SST admission requires its existing app/state bucket');
}
async function awsJson(q,runCommand,service,operation,...args) {
  const result=await runCommand(['aws',service,operation,...args,'--region',q.environment.region,'--output','json','--no-cli-pager'],{timeoutMs:60000});
  if(result.exitCode!==0)throw Error('Lambda admission observation failed: '+service+'/'+operation);
  return JSON.parse(result.stdout);
}
async function readObject(q,runCommand,bucket,key) {
  const temp=await mkdtemp(path.join(os.tmpdir(),'lambda-native-observation-'));
  try {
    const file=path.join(temp,'body');
    await awsJson(q,runCommand,'s3api','get-object','--bucket',bucket,'--key',key,'--expected-bucket-owner',q.environment.accountId,file);
    const bytes=await readFile(file),decoded=bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes):bytes;
    return {text:decoded.toString('utf8'),sha256:createHash('sha256').update(bytes).digest('hex')};
  }finally{await rm(temp,{recursive:true,force:true});}
}
export function sanitizeLambdaState(data,resource,q,provider) {
  const c=data.Configuration,tags=data.Tags,ownerKey=provider==='sst'?'benchmark:owner':'benchmark-owner';
  if(c?.FunctionArn!==resource.arn||tags?.[ownerKey]!==q.nativeBindings.owner)throw Error('Existing Lambda identity/ownership differs: '+resource.name);
  if(provider==='sst'&&(tags['sst:app']!==q.nativeAppName||tags['sst:stage']!==q.stage))throw Error('Existing SST Lambda app/stage differs: '+resource.name);
  if(c.State!=='Active'||c.LastUpdateStatus!=='Successful'||c.Runtime!=='nodejs22.x'||c.MemorySize!==512||c.Timeout!==30)throw Error('Lambda must be active with the qualified runtime/resources: '+resource.name);
  // All stable configuration, including environment values and role, participates
  // in the hash. Plaintext environment values and signed download URLs are omitted.
  const volatile=new Set(['FunctionArn','FunctionName','CodeSize','CodeSha256','LastModified','RevisionId','State','StateReason','StateReasonCode','LastUpdateStatus','LastUpdateStatusReason','LastUpdateStatusReasonCode','Layers']);
  const configuration=Object.fromEntries(Object.entries(c).filter(([key])=>!volatile.has(key)));
  return {name:resource.name,arn:c.FunctionArn,functionName:c.FunctionName,codeSHA256:c.CodeSha256,layers:(c.Layers||[]).map(l=>l.Arn),configurationSHA256:hash(configuration),ownerTagKey:ownerKey,owner:q.nativeBindings.owner,state:c.State,lastUpdateStatus:c.LastUpdateStatus,runtime:c.Runtime,memoryMB:c.MemorySize,timeoutSeconds:c.Timeout};
}
export async function captureLambdaState(q,provider,runCommand) {
  validateLambdaBindings(q,provider);
  async function aws(service,operation,...args) {
    const result=await runCommand(['aws',service,operation,...args,'--region',q.environment.region,'--output','json','--no-cli-pager'],{timeoutMs:60000});
    if(result.exitCode!==0)throw Error('Lambda admission observation failed: '+service+'/'+operation);
    return JSON.parse(result.stdout);
  }
  const functions=[];
  // Bound parallelism avoids 25 simultaneous credential processes / AWS requests.
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,q.nativeResources.length)},async()=>{
    while(next<q.nativeResources.length){const resource=q.nativeResources[next++];functions.push(sanitizeLambdaState(await aws('lambda','get-function','--function-name',resource.arn),resource,q,provider));}
  }));
  functions.sort((a,b)=>a.name.localeCompare(b.name));
  let cloudformation;
  if(provider!=='sst'){
    const stack=(await aws('cloudformation','describe-stacks','--stack-name',q.nativeStackName)).Stacks?.[0];
    if(!stack?.StackId?.startsWith(`arn:aws:cloudformation:${q.environment.region}:${q.environment.accountId}:stack/`)||!stack.Tags?.some(t=>t.Key==='benchmark-owner'&&t.Value===q.nativeBindings.owner))throw Error('Existing CloudFormation stack identity/ownership differs');
    const resources=(await aws('cloudformation','list-stack-resources','--stack-name',stack.StackId)).StackResourceSummaries;
    const inventory=resources.map(r=>({logicalId:r.LogicalResourceId,type:r.ResourceType,physicalId:r.PhysicalResourceId})).sort((a,b)=>a.logicalId.localeCompare(b.logicalId));
    cloudformation={stackId:stack.StackId,creationTime:stack.CreationTime,lastUpdatedTime:stack.LastUpdatedTime||null,inventory};
    if(provider==='candidate'&&!inventory.some(r=>r.type==='AWS::S3::Bucket'&&r.physicalId===q.nativeDeploymentBucket))throw Error('Candidate deployment bucket differs from the existing stack');
  }
  let pathState;
  if(provider==='candidate'){
    const head=await readObject(q,runCommand,q.nativeDeploymentBucket,'.stacktape-release-state/head.json');
    const current=JSON.parse(head.text).current;
    if(typeof current!=='string'||!/^v\d+$/.test(current))throw Error('Candidate release head has no native version');
    pathState={version:current,headSHA256:head.sha256};
  }
  if(provider==='sst'){
    const prefix=`eventlog/${q.nativeAppName}/${q.stage}/`;
    const data=await aws('s3api','list-objects-v2','--bucket',q.nativeStateBucket,'--prefix',prefix,'--expected-bucket-owner',q.environment.accountId);
    pathState={eventKeys:(data.Contents||[]).map(o=>o.Key).sort()};
  }
  return {observedAt:new Date().toISOString(),functions,...cloudformation&&{cloudformation},...pathState&&{pathState}};
}
export function compareLambdaUpdate(before,after,{provider,names}) {
  for(const observation of [before,after])if(!Array.isArray(observation?.functions)||!isDeepStrictEqual(observation.functions.map(f=>f.name).sort(),[...names].sort())||new Set(observation.functions.map(f=>f.name)).size!==names.length)throw Error('Lambda update proof is missing selected functions');
  const updates=after.functions.map(current=>{
    const previous=before.functions.find(f=>f.name===current.name);
    for(const field of ['arn','functionName','configurationSHA256','ownerTagKey','owner','runtime','memoryMB','timeoutSeconds'])if(!isDeepStrictEqual(current[field],previous[field]))throw Error('Code-only update changed Lambda identity/configuration: '+current.name+'/'+field);
    if(current.state!=='Active'||current.lastUpdateStatus!=='Successful')throw Error('Lambda update is not successful: '+current.name);
    if(current.codeSHA256===previous.codeSHA256&&isDeepStrictEqual(current.layers,previous.layers))throw Error('Lambda code/layers did not change: '+current.name);
    return {name:current.name,arn:current.arn,codeChanged:current.codeSHA256!==previous.codeSHA256,layersChanged:!isDeepStrictEqual(current.layers,previous.layers)};
  });
  if(provider!=='sst'&&(!before.cloudformation||!isDeepStrictEqual(before.cloudformation,after.cloudformation)))throw Error('Fast update changed its CloudFormation baseline/resources');
  return {verified:true,outsideReadinessTimer:true,updates};
}
export function sanitizePulumiEvents(text) {
  const events=text.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const summary=events.filter(e=>e.summaryEvent).map(e=>e.summaryEvent);
  if(summary.length!==1||summary[0].maybeCorrupt===true)throw Error('SST event history needs one successful, non-corrupt summary');
  const operations=events.filter(e=>e.resourcePreEvent||e.resOutputsEvent).map(e=>{
    const m=(e.resourcePreEvent||e.resOutputsEvent).metadata;
    return {sequence:e.sequence,op:m.op,urn:m.urn,type:m.type,id:m.new?.id||m.old?.id||null};
  });
  if(!operations.length||operations.some(o=>!['same','update','read','read-discard'].includes(o.op)))throw Error('SST update created, replaced, deleted or used an unknown resource operation');
  const changes=summary[0].resourceChanges||{};
  if(Object.entries(changes).some(([op,count])=>count>0&&!['same','update','read','read-discard'].includes(op)))throw Error('SST summary includes resource creation/replacement/deletion');
  return {operations,resourceChanges:changes};
}
export function validateSstUpdateMetadata(metadata,id,runId) {
  const emptyErrors=metadata.errors===null||Array.isArray(metadata.errors)&&metadata.errors.length===0;
  if(metadata.id!==id||metadata.runID!==runId||metadata.command!=='deploy'||!Number.isFinite(Date.parse(metadata.timeStarted))||!Number.isFinite(Date.parse(metadata.timeCompleted))||Date.parse(metadata.timeCompleted)<Date.parse(metadata.timeStarted)||!emptyErrors)throw Error('SST update metadata differs from this successful attempt');
}
export async function captureLambdaPath(q,provider,{before,after,runId,logs,runCommand}) {
  if(provider==='candidate'){
    if(after.pathState.version===before.pathState.version)throw Error('Candidate did not commit a new fast release');
    const native=await readObject(q,runCommand,q.nativeDeploymentBucket,`.stacktape-release-state/releases/${after.pathState.version}.json`),release=JSON.parse(native.text);
    if(release.kind!=='fast'||release.version!==after.pathState.version||release.predecessor!==before.pathState.version||release.target?.accountId!==q.environment.accountId||release.target?.region!==q.environment.region||release.target?.stackId!==after.cloudformation.stackId)throw Error('Candidate native release is not this target’s next fast deployment');
    const resources=q.nativeResources.map(r=>r.resourceName);
    if(resources.some(r=>!r)||!isDeepStrictEqual([...release.changedWorkloads].sort(),resources.sort()))throw Error('Candidate fast release changed different workloads');
    for(const resource of q.nativeResources){const workload=release.workloads[resource.resourceName],state=after.functions.find(f=>f.name===resource.name);if(workload?.type!=='lambda'||workload.functionName!==state.functionName||workload.code?.codeSha256!==state.codeSHA256)throw Error('Candidate release code differs from observed Lambda: '+resource.name);}
    return {kind:'candidate-fast',version:release.version,predecessor:release.predecessor,changedWorkloads:release.changedWorkloads,target:release.target,nativeSHA256:native.sha256,code:resources.map(name=>({name,functionName:release.workloads[name].functionName,codeSHA256:release.workloads[name].code.codeSha256}))};
  }
  if(provider==='sst'){
    const keys=after.pathState.eventKeys.filter(key=>!before.pathState.eventKeys.includes(key));
    if(keys.length!==1)throw Error('SST attempt needs exactly one new native event history');
    const key=keys[0],id=path.basename(key,'.json'),update=await readObject(q,runCommand,q.nativeStateBucket,`update/${q.nativeAppName}/${q.stage}/${id}.json`),metadata=JSON.parse(update.text);
    validateSstUpdateMetadata(metadata,id,runId);
    const native=await readObject(q,runCommand,q.nativeStateBucket,key);
    return {kind:'sst-update',id,runId,command:metadata.command,timeStarted:metadata.timeStarted,timeCompleted:metadata.timeCompleted,eventSHA256:native.sha256,updateSHA256:update.sha256,...sanitizePulumiEvents(native.text)};
  }
  const outputs=await Promise.all(logs.flatMap(l=>[readFile(l.stdoutFile,'utf8'),readFile(l.stderrFile,'utf8')]));
  if(provider==='cdk'){
    const output=outputs.join('\n').replace(/\x1b\[[0-9;]*m/g,'');
    if(!logs.some(l=>l.argv.includes('--hotswap'))||! /hotswapping resources:/i.test(output)||/non-hotswappable changes were found|no hotswappable changes/i.test(output))throw Error('CDK native command did not prove a complete hotswap');
    return {kind:'cdk-hotswap',ignoredChanges:[],functions:after.functions.map(f=>f.name)};
  }
  if(provider==='serverless'){
    const summaries=outputs.flatMap(text=>text.split('\n').flatMap(line=>{try{const v=JSON.parse(line);return Array.isArray(v.functions)&&Number.isInteger(v.concurrency)?[v]:[];}catch{return [];}}));
    if(summaries.length!==1)throw Error('Serverless requires one complete native function-update summary');
    const summary=summaries[0];
    if(!isDeepStrictEqual(summary.functions.map(f=>f.function).sort(),after.functions.map(f=>f.name).sort())||summary.functions.some(f=>!f.success||f.exitCode!==0))throw Error('Serverless did not update every selected function');
    return {kind:'serverless-function',concurrency:summary.concurrency,functions:summary.functions};
  }
  throw Error('Unsupported Lambda fast-update provider');
}
export function needsLambdaUpdate(scenario) {return scenario.kind==='deploy'&&scenario.fixture.startsWith('lambda-');}
export function validateLambdaAdmission(record) {
  if(record.kind!=='deploy'||!record.scenario.includes('lambda-')||record.status!=='passed')return;
  const a=record.lambdaUpdateAdmission;
  if(a?.verified!==true||a.outsideReadinessTimer!==true||a.schemaVersion!==1)throw Error('Lambda deployments require observed fast-update admission');
  for(const key of ['provider','runId','sourceCommit','appId','stage'])if(a[key]!==record[key])throw Error('Lambda update admission differs from '+key);
  if(a.accountId!==record.environment.accountId||a.region!==record.environment.region)throw Error('Lambda update admission differs from account/region');
  if(Date.parse(a.before?.observedAt)>Date.parse(record.startedAt)||!Number.isFinite(Date.parse(a.before?.observedAt))||!Number.isFinite(Date.parse(a.after?.observedAt))||Date.parse(a.after.observedAt)<Date.parse(record.nativeCompletion?.finishedAt||record.pipelineCompletion?.verifiedAt))throw Error('Lambda update observations must surround native completion outside timing');
  const names=record.readiness.observations.map(o=>o.name);
  const compared=compareLambdaUpdate(a.before,a.after,{provider:record.provider,names});
  if(!isDeepStrictEqual(compared.updates,a.updates))throw Error('Lambda update summary differs from native observations');
  const expectedKind={candidate:'candidate-fast',cdk:'cdk-hotswap',sst:'sst-update',serverless:'serverless-function'}[record.provider];
  if(a.path?.kind!==expectedKind)throw Error('Lambda update proof lacks the provider’s native fast path');
  if(record.provider==='candidate'){
    if(a.path.predecessor!==a.before.pathState?.version||a.path.version!==a.after.pathState?.version||a.path.version===a.path.predecessor||a.path.target?.stackId!==a.after.cloudformation?.stackId||a.path.target?.accountId!==a.accountId||a.path.target?.region!==a.region||!isDeepStrictEqual(a.path.code?.map(c=>c.functionName).sort(),a.after.functions.map(f=>f.functionName).sort())||a.path.code.some(c=>c.codeSHA256!==a.after.functions.find(f=>f.functionName===c.functionName).codeSHA256))throw Error('Candidate admission differs from its observed fast release');
  }
  if(record.provider==='sst'&&(a.path.runId!==record.runId||a.path.command!=='deploy'||!a.path.timeCompleted||!Array.isArray(a.path.operations)||!a.path.operations.length||a.path.operations.some(o=>!['same','update','read','read-discard'].includes(o.op))))throw Error('SST admission differs from its successful native resource update');
  if(record.provider==='cdk'&&(!isDeepStrictEqual(a.path.ignoredChanges,[])||!isDeepStrictEqual([...a.path.functions].sort(),[...names].sort())))throw Error('CDK admission must cover every function without ignored changes');
  if(record.provider==='serverless'&&(!isDeepStrictEqual(a.path.functions?.map(f=>f.function).sort(),[...names].sort())||a.path.functions.some(f=>!f.success||f.exitCode!==0)))throw Error('Serverless admission must include every successful native child');
  if(!a.proof?.file||!/^[a-f0-9]{64}$/.test(a.proof.sha256||'')||!record.evidence.some(e=>isDeepStrictEqual(e,a.proof)))throw Error('Lambda update admission requires an immutable proof sidecar');
  if(!Array.isArray(a.nativeLogEvidence)||!a.nativeLogEvidence.length||a.nativeLogEvidence.some(e=>!record.evidence.some(item=>isDeepStrictEqual(item,e))))throw Error('Lambda native command logs must be bound to admission');
}
export async function verifyImportedLambdaAdmission(record,{base}) {
  if(record.kind!=='deploy'||!record.scenario.includes('lambda-')||record.status!=='passed')return;
  validateLambdaAdmission(record);
  const a=record.lambdaUpdateAdmission,bytes=await readFile(path.resolve(base,a.proof.file));
  if(createHash('sha256').update(bytes).digest('hex')!==a.proof.sha256)throw Error('Lambda update admission checksum mismatch');
  const {proof,...expected}=a;
  if(!isDeepStrictEqual(JSON.parse(bytes),expected))throw Error('Imported Lambda admission differs from its original observations');
  for(const evidence of a.nativeLogEvidence)if(createHash('sha256').update(await readFile(path.resolve(base,evidence.file))).digest('hex')!==evidence.sha256)throw Error('Lambda native command evidence checksum mismatch');
}

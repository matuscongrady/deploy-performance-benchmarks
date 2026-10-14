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
  if(provider==='sst'&&(!q.nativeStateBucket||!q.nativeAppName||!q.nativeAssetBucket||q.toolVersion?.reported!=='4.17.2'))throw Error('SST admission requires its pinned version and existing app/state/asset buckets');
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
  const volatile=new Set(['FunctionArn','FunctionName','CodeSize','CodeSha256','LastModified','RevisionId','State','StateReason','StateReasonCode','LastUpdateStatus','LastUpdateStatusReason','LastUpdateStatusReasonCode','Layers','RuntimeVersionConfig']);
  const configuration=Object.fromEntries(Object.entries(c).filter(([key])=>!volatile.has(key)));
  if(c.RuntimeVersionConfig?.Error)throw Error('Lambda reports a managed-runtime error: '+resource.name);
  return {name:resource.name,arn:c.FunctionArn,functionName:c.FunctionName,codeSHA256:c.CodeSha256,layers:(c.Layers||[]).map(l=>l.Arn),configurationSHA256:hash(configuration),runtimeVersionArn:c.RuntimeVersionConfig?.RuntimeVersionArn||null,ownerTagKey:ownerKey,owner:q.nativeBindings.owner,state:c.State,lastUpdateStatus:c.LastUpdateStatus,runtime:c.Runtime,memoryMB:c.MemorySize,timeoutSeconds:c.Timeout,...provider==='sst'&&{appName:q.nativeAppName,stage:q.stage,logGroupName:c.LoggingConfig?.LogGroup||`/aws/lambda/${c.FunctionName}`}};
}
export async function captureLambdaState(q,provider,runCommand,{project}={}) {
  validateLambdaBindings(q,provider);
  async function aws(service,operation,...args) {
    const result=await runCommand(['aws',service,operation,...args,'--region',q.environment.region,'--output','json','--no-cli-pager'],{timeoutMs:60000});
    if(result.exitCode!==0)throw Error('Lambda admission observation failed: '+service+'/'+operation);
    return operation==='head-bucket'&&!result.stdout.trim()?{}:JSON.parse(result.stdout);
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
  let pathState,assetBucket;
  if(provider==='candidate'){
    const head=await readObject(q,runCommand,q.nativeDeploymentBucket,'.stacktape-release-state/head.json');
    const current=JSON.parse(head.text).current;
    if(typeof current!=='string'||!/^v\d+$/.test(current))throw Error('Candidate release head has no native version');
    pathState={version:current,headSHA256:head.sha256};
  }
  if(provider==='sst'){
    // Ownership is observed outside the clock, rather than trusted from a name
    // supplied by the qualifier. Retain only the selected bucket's safe fields.
    await aws('s3api','head-bucket','--bucket',q.nativeAssetBucket,'--expected-bucket-owner',q.environment.accountId);
    const location=await aws('s3api','get-bucket-location','--bucket',q.nativeAssetBucket,'--expected-bucket-owner',q.environment.accountId);
    const bucketRegion=location.LocationConstraint==='EU'?'eu-west-1':location.LocationConstraint||'us-east-1';
    const tags=await aws('s3api','get-bucket-tagging','--bucket',q.nativeAssetBucket,'--expected-bucket-owner',q.environment.accountId);
    if(bucketRegion!==q.environment.region||!tags.TagSet?.some(t=>t.Key==='benchmark:owner'&&t.Value===q.nativeBindings.owner))throw Error('SST asset bucket region/ownership differs');
    assetBucket={name:q.nativeAssetBucket,accountId:q.environment.accountId,region:bucketRegion,ownerTagKey:'benchmark:owner',owner:q.nativeBindings.owner};
    const prefix=`eventlog/${q.nativeAppName}/${q.stage}/`;
    const data=await aws('s3api','list-objects-v2','--bucket',q.nativeStateBucket,'--prefix',prefix,'--expected-bucket-owner',q.environment.accountId);
    pathState={eventKeys:(data.Contents||[]).map(o=>o.Key).sort()};
  }
  let nativeTemplate;
  if(provider==='cdk'&&project){
    const template=JSON.parse(await readFile(path.join(project,'cdk.out',q.nativeStackName+'.template.json'),'utf8'));
    delete template.Metadata;
    const selected=new Set(functions.map(f=>f.functionName));
    for(const resource of Object.values(template.Resources||{})){
      delete resource.Metadata;
      if(resource.Type==='AWS::Lambda::Function'&&selected.has(resource.Properties?.FunctionName))for(const field of ['S3Bucket','S3Key','S3ObjectVersion','ZipFile'])delete resource.Properties.Code?.[field];
    }
    nativeTemplate={stableSHA256:hash(template),allowedChanges:'Selected Lambda Code upload fields and generated asset metadata only'};
  }
  return {observedAt:new Date().toISOString(),functions,...cloudformation&&{cloudformation},...pathState&&{pathState},...assetBucket&&{assetBucket},...nativeTemplate&&{nativeTemplate}};
}
export function compareLambdaUpdate(before,after,{provider,names}) {
  for(const observation of [before,after])if(!Array.isArray(observation?.functions)||!isDeepStrictEqual(observation.functions.map(f=>f.name).sort(),[...names].sort())||new Set(observation.functions.map(f=>f.name)).size!==names.length)throw Error('Lambda update proof is missing selected functions');
  const updates=after.functions.map(current=>{
    const previous=before.functions.find(f=>f.name===current.name);
    for(const field of ['arn','functionName','configurationSHA256','ownerTagKey','owner','runtime','memoryMB','timeoutSeconds',...provider==='sst'?['appName','stage','logGroupName']:[]])if(!isDeepStrictEqual(current[field],previous[field]))throw Error('Code-only update changed Lambda identity/configuration: '+current.name+'/'+field);
    if(current.state!=='Active'||current.lastUpdateStatus!=='Successful')throw Error('Lambda update is not successful: '+current.name);
    if(current.codeSHA256===previous.codeSHA256&&isDeepStrictEqual(current.layers,previous.layers))throw Error('Lambda code/layers did not change: '+current.name);
    return {name:current.name,arn:current.arn,codeChanged:current.codeSHA256!==previous.codeSHA256,layersChanged:!isDeepStrictEqual(current.layers,previous.layers)};
  });
  if(provider!=='sst'&&(!before.cloudformation||!isDeepStrictEqual(before.cloudformation,after.cloudformation)))throw Error('Fast update changed its CloudFormation baseline/resources');
  if(provider==='sst'&&(!before.assetBucket||!isDeepStrictEqual(before.assetBucket,after.assetBucket)))throw Error('SST asset bucket observation changed or is missing');
  return {verified:true,outsideReadinessTimer:true,updates};
}
const s3ObjectType='aws:s3/bucketObjectv2:BucketObjectv2';
const ordinaryOps=['same','update','read'],replacementOps=['create-replacement','replace','delete-replaced'];
function assetCoordinates(state) {
  if(!state)return null;
  const pick=value=>typeof value==='string'?value:null;
  const inputs={bucket:pick(state.inputs?.bucket),key:pick(state.inputs?.key)};
  const outputs={bucket:pick(state.outputs?.bucket),key:pick(state.outputs?.key)};
  return {bucket:outputs.bucket??inputs.bucket,key:outputs.key??inputs.key,
    conflicting: ['bucket','key'].some(k=>inputs[k]!==null&&outputs[k]!==null&&inputs[k]!==outputs[k])};
}
// Project first, validate second: even a failed history can be retained without
// raw inputs, outputs, provider configuration or native error messages.
export function projectPulumiEvents(text) {
  const events=[],operations=[];let parseFailures=0;
  for(const line of text.trim().split('\n').filter(Boolean))try{const event=JSON.parse(line);if(!event||typeof event!=='object'||Array.isArray(event))parseFailures++;else events.push(event);}catch{parseFailures++;}
  for(const e of events)for(const [field,phase] of [['resourcePreEvent','pre'],['resOutputsEvent','outputs']])if(e[field]){
    const m=e[field].metadata||{};
    operations.push({sequence:e.sequence,timestamp:e.timestamp,phase,logical:m.logical===true,op:m.op,urn:m.urn,type:m.type,
      ...m.type===s3ObjectType&&{old:assetCoordinates(m.old),new:assetCoordinates(m.new)}});
  }
  const summaries=events.filter(e=>e.summaryEvent).map(e=>({maybeCorrupt:e.summaryEvent.maybeCorrupt,isPreview:e.summaryEvent.isPreview,resourceChanges:e.summaryEvent.resourceChanges||{}}));
  const failures=events.filter(e=>e.resOpFailedEvent||e.errorEvent||e.diagnosticEvent?.severity==='error').length;
  return {operations,summaries,parseFailures,failures,resourceChanges:summaries.length===1?summaries[0].resourceChanges:{}};
}
function codeHex(value) {
  if(typeof value!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(value)||Buffer.from(value,'base64').length!==32||Buffer.from(value,'base64').toString('base64')!==value)throw Error('SST artifact proof needs the observed Lambda ZIP SHA-256');
  return Buffer.from(value,'base64').toString('hex');
}
export function sstArtifactScope(before,after,{accountId,region,version}) {
  if(version!=='4.17.2'||!before?.assetBucket||!isDeepStrictEqual(before.assetBucket,after?.assetBucket))throw Error('SST artifact replacement needs the pinned version and stable owned asset bucket');
  const bucket=before.assetBucket,first=before.functions?.[0];
  if(!first?.appName||!first.stage||bucket.accountId!==accountId||bucket.region!==region||bucket.ownerTagKey!=='benchmark:owner'||bucket.owner!==first.owner)throw Error('SST artifact bucket differs from observed account/region/owner');
  const functions=before.functions.map(previous=>{
    const current=after.functions.find(f=>f.name===previous.name);
    if(!current||[previous,current].some(f=>f.appName!==first.appName||f.stage!==first.stage||f.owner!==bucket.owner||f.ownerTagKey!=='benchmark:owner'||!f.arn?.startsWith(`arn:aws:lambda:${region}:${accountId}:function:`))||previous.logGroupName!==current.logGroupName||!/^\/[A-Za-z0-9_./#-]+$/.test(previous.logGroupName||''))throw Error('SST artifact component differs from observed function/app/stage');
    return {name:previous.name,oldCodeSHA256:codeHex(previous.codeSHA256),newCodeSHA256:codeHex(current.codeSHA256),logGroupArn:`arn:aws:logs:${region}:${accountId}:log-group:${previous.logGroupName}`};
  });
  if(!functions.length||new Set(functions.map(f=>f.name)).size!==functions.length||functions.length!==after.functions.length)throw Error('SST artifact scope needs every selected function');
  return {version,appName:first.appName,stage:first.stage,assetBucket:bucket.name,accountId,region,functions};
}
function artifactFor(operation,scope) {
  const prefix=`urn:pulumi:${scope.stage}::${scope.appName}::sst:aws:Function$${s3ObjectType}::`;
  if(operation.type!==s3ObjectType||!operation.urn?.startsWith(prefix))throw Error('SST update created, replaced, deleted a non-artifact resource');
  const logicalName=operation.urn.slice(prefix.length);
  for(const f of scope.functions)if(logicalName===`${f.name}Code`)return {fn:f,kind:'code'};
  for(const f of scope.functions)if(logicalName.startsWith(`${f.name}Sourcemap`)&&/^(0|[1-9][0-9]*)$/.test(logicalName.slice(`${f.name}Sourcemap`.length)))return {fn:f,kind:'map'};
  throw Error('SST artifact replacement belongs to an unselected component');
}
function checkCoordinates(coordinates,artifact,side,scope) {
  const expectedHash=artifact.fn[side==='old'?'oldCodeSHA256':'newCodeSHA256'];
  if(!coordinates||coordinates.conflicting!==false||coordinates.bucket!==scope.assetBucket||typeof coordinates.key!=='string')throw Error('SST artifact replacement differs from the observed owned bucket');
  if(artifact.kind==='code'){
    if(coordinates.key!==`assets/${artifact.fn.name}-code-${expectedHash}.zip`)throw Error('SST code object differs from the observed Lambda ZIP hash');
  }else{
    const prefix=`sourcemap/${artifact.fn.logGroupArn}`,suffix=`/${expectedHash}.`;
    const alternatives=[prefix+suffix,prefix+':*'+suffix];
    const matching=alternatives.find(p=>coordinates.key.startsWith(p));
    if(!matching||!/^[A-Za-z0-9_.-]+\.map$/.test(coordinates.key.slice(matching.length)))throw Error('SST source-map object differs from its function log group/ZIP hash');
  }
}
export function validatePulumiEvents(projection,scope) {
  const {operations,summaries,failures,parseFailures,resourceChanges:changes}=projection;
  if(parseFailures||summaries?.length!==1||summaries[0].maybeCorrupt!==false||summaries[0].isPreview!==false||!isDeepStrictEqual(changes,summaries[0].resourceChanges))throw Error('SST event history needs one successful, non-preview, non-corrupt summary');
  if(failures!==0)throw Error('SST event history contains a native resource/engine failure');
  if(!operations?.length)throw Error('SST event history has no resource operations');
  if(!scope){
    if(operations.some(o=>!ordinaryOps.includes(o.op)))throw Error('SST update created, replaced, deleted or used an unknown resource operation');
    if(Object.entries(changes).some(([op,count])=>!Number.isInteger(count)||count<0||count>0&&!ordinaryOps.includes(op)))throw Error('SST summary includes invalid counts or resource creation/replacement/deletion');
    return projection;
  }
  if(scope.version!=='4.17.2')throw Error('SST artifact exception requires pinned native 4.17.2');
  let sequence=-1;const replacements=new Map(),preCounts={};
  for(const o of operations){
    if(!Number.isInteger(o.sequence)||o.sequence<=sequence||!['pre','outputs'].includes(o.phase)||typeof o.logical!=='boolean')throw Error('SST event operation order/phase is invalid');
    sequence=o.sequence;
    if(o.phase==='pre'&&o.logical)preCounts[o.op]=(preCounts[o.op]||0)+1;
    if(ordinaryOps.includes(o.op))continue;
    if(!replacementOps.includes(o.op))throw Error('SST update created, replaced, deleted or used an unknown resource operation');
    const artifact=artifactFor(o,scope);
    if(artifact.fn.oldCodeSHA256===artifact.fn.newCodeSHA256)throw Error('SST artifact replacement has no observed ZIP change');
    if(o.logical!==(o.op==='replace'))throw Error('SST artifact replacement has an invalid logical step');
    checkCoordinates(o.old,artifact,'old',scope);
    if(o.op==='delete-replaced'){if(o.new!==null)throw Error('SST retired artifact unexpectedly has new resource state');}
    else checkCoordinates(o.new,artifact,'new',scope);
    const steps=replacements.get(o.urn)||[];steps.push(o);replacements.set(o.urn,steps);
  }
  for(const steps of replacements.values()){
    const coordinates=steps.find(s=>s.op==='create-replacement'&&s.phase==='pre');
    if(!coordinates||steps.some(s=>!isDeepStrictEqual(s.old,coordinates.old)||s.op!=='delete-replaced'&&!isDeepStrictEqual(s.new,coordinates.new)))throw Error('SST artifact coordinates changed within its replacement lifecycle');
    for(const op of replacementOps){
      const pre=steps.filter(s=>s.op===op&&s.phase==='pre'),outputs=steps.filter(s=>s.op===op&&s.phase==='outputs');
      if(pre.length!==1||outputs.length!==1||pre[0].sequence>=outputs[0].sequence||!isDeepStrictEqual(pre[0].old,outputs[0].old)||!isDeepStrictEqual(pre[0].new,outputs[0].new))throw Error('SST artifact replacement lifecycle is incomplete or inconsistent');
    }
    const create=steps.find(s=>s.op==='create-replacement'&&s.phase==='outputs'),replace=steps.find(s=>s.op==='replace'&&s.phase==='pre'),retire=steps.find(s=>s.op==='delete-replaced'&&s.phase==='pre');
    if(create.sequence>=replace.sequence||replace.sequence>=retire.sequence)throw Error('SST artifact replacement lifecycle order is invalid');
  }
  // Pulumi counts logical ReplaceStep, not the physical create/delete steps.
  for(const [op,count] of Object.entries(changes))if(!Number.isInteger(count)||count<0||count>0&&!['same','update','read','replace'].includes(op))throw Error('SST summary includes invalid counts or forbidden resource changes');
  if((changes.replace||0)!==replacements.size||(changes.update||0)!==(preCounts.update||0)||['same','read'].some(op=>(changes[op]||0)>(preCounts[op]||0)))throw Error('SST resource summary differs from its observed logical operations');
  return projection;
}
export function sanitizePulumiEvents(text,scope) {
  const projection=projectPulumiEvents(text);
  try{return validatePulumiEvents(projection,scope);}catch(error){error.lambdaPathObservation=projection;throw error;}
}
export function validateSstUpdateMetadata(metadata,id,runId) {
  const emptyErrors=metadata.errors===null||Array.isArray(metadata.errors)&&metadata.errors.length===0;
  if(metadata.version!=='4.17.2'||metadata.id!==id||metadata.runID!==runId||metadata.command!=='deploy'||!Number.isFinite(Date.parse(metadata.timeStarted))||!Number.isFinite(Date.parse(metadata.timeCompleted))||Date.parse(metadata.timeCompleted)<Date.parse(metadata.timeStarted)||!emptyErrors)throw Error('SST update metadata differs from this successful attempt');
}
export async function captureSstHistory(q,{before,runId,runCommand,eventKeys}) {
  const keys=eventKeys||(await awsJson(q,runCommand,'s3api','list-objects-v2','--bucket',q.nativeStateBucket,'--prefix',`eventlog/${q.nativeAppName}/${q.stage}/`,'--expected-bucket-owner',q.environment.accountId)).Contents?.map(o=>o.Key)||[];
  const fresh=keys.filter(key=>!before.pathState.eventKeys.includes(key));
  if(fresh.length!==1)throw Error('SST attempt needs exactly one new native event history');
  const key=fresh[0],id=path.basename(key,'.json');
  if(key!==`eventlog/${q.nativeAppName}/${q.stage}/${id}.json`)throw Error('SST event history key differs from this app/stage');
  const native=await readObject(q,runCommand,q.nativeStateBucket,key);
  let observed={kind:'sst-update',id,runId,eventSHA256:native.sha256,...projectPulumiEvents(native.text)};
  try{
    const update=await readObject(q,runCommand,q.nativeStateBucket,`update/${q.nativeAppName}/${q.stage}/${id}.json`),metadata=JSON.parse(update.text);
    observed={...observed,version:/^\d+\.\d+\.\d+$/.test(metadata.version||'')?metadata.version:null,command:['deploy','remove','refresh','diff'].includes(metadata.command)?metadata.command:null,
      timeStarted:Number.isFinite(Date.parse(metadata.timeStarted))?metadata.timeStarted:null,
      timeCompleted:Number.isFinite(Date.parse(metadata.timeCompleted))?metadata.timeCompleted:null,updateSHA256:update.sha256,
      metadataVerified:false,metadataFailureCount:Array.isArray(metadata.errors)?metadata.errors.length:metadata.errors===null?0:1};
    validateSstUpdateMetadata(metadata,id,runId);observed.metadataVerified=true;
    return observed;
  }catch(error){error.lambdaPathObservation=observed;throw error;}
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
    const observed=await captureSstHistory(q,{before,runId,runCommand,eventKeys:after.pathState.eventKeys});
    try{
      if(!observed.metadataVerified)throw Error('SST update metadata differs from this successful attempt');
      const scope=sstArtifactScope(before,after,{...q.environment,version:q.toolVersion.reported});
      if(scope.appName!==q.nativeAppName||scope.stage!==q.stage||scope.assetBucket!==q.nativeAssetBucket)throw Error('SST artifact scope differs from qualification');
      observed.scope=scope;
      validatePulumiEvents(observed,scope);
      return observed;
    }catch(error){error.lambdaPathObservation=observed;throw error;}
  }
  const outputs=await Promise.all(logs.flatMap(l=>[readFile(l.stdoutFile,'utf8'),readFile(l.stderrFile,'utf8')]));
  if(provider==='cdk'){
    const output=outputs.join('\n').replace(/\x1b\[[0-9;]*m/g,'');
    if(!logs.some(l=>l.argv.includes('--hotswap'))||! /hotswapping resources:/i.test(output)||/non-hotswappable changes were found|no hotswappable changes/i.test(output))throw Error('CDK native command did not prove a complete hotswap');
    if(q.toolVersion?.reported!=='2.1145.0'||!before.nativeTemplate?.stableSHA256||before.nativeTemplate.stableSHA256!==after.nativeTemplate?.stableSHA256)throw Error('CDK needs its pinned native hotswap and unchanged non-code template');
    return {kind:'cdk-hotswap',ignoredChanges:[],functions:after.functions.map(f=>f.name),nonCodeTemplateSHA256:after.nativeTemplate.stableSHA256};
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
  const started=Date.parse(record.startedAt),completed=Date.parse(record.nativeCompletion?.finishedAt||record.pipelineCompletion?.verifiedAt);
  if(!Number.isFinite(started)||!Number.isFinite(completed)||Date.parse(a.before?.observedAt)>started||!Number.isFinite(Date.parse(a.before?.observedAt))||!Number.isFinite(Date.parse(a.after?.observedAt))||Date.parse(a.after.observedAt)<completed)throw Error('Lambda update observations must surround native completion outside timing');
  const names=record.readiness.observations.map(o=>o.name);
  const compared=compareLambdaUpdate(a.before,a.after,{provider:record.provider,names});
  if(!isDeepStrictEqual(compared.updates,a.updates))throw Error('Lambda update summary differs from native observations');
  const expectedKind={candidate:'candidate-fast',cdk:'cdk-hotswap',sst:'sst-update',serverless:'serverless-function'}[record.provider];
  if(a.path?.kind!==expectedKind)throw Error('Lambda update proof lacks the provider’s native fast path');
  if(record.provider==='candidate'){
    if(a.path.predecessor!==a.before.pathState?.version||a.path.version!==a.after.pathState?.version||a.path.version===a.path.predecessor||a.path.target?.stackId!==a.after.cloudformation?.stackId||a.path.target?.accountId!==a.accountId||a.path.target?.region!==a.region||!isDeepStrictEqual(a.path.code?.map(c=>c.functionName).sort(),a.after.functions.map(f=>f.functionName).sort())||a.path.code.some(c=>c.codeSHA256!==a.after.functions.find(f=>f.functionName===c.functionName).codeSHA256))throw Error('Candidate admission differs from its observed fast release');
  }
  if(record.provider==='sst'){
    if(a.path.version!=='4.17.2'||a.path.metadataVerified!==true||a.path.metadataFailureCount!==0||a.path.runId!==record.runId||a.path.command!=='deploy'||!Number.isFinite(Date.parse(a.path.timeCompleted))||!Number.isFinite(Date.parse(a.path.timeStarted))||Date.parse(a.path.timeCompleted)<Date.parse(a.path.timeStarted)||!/^([a-f0-9]{64})$/.test(a.path.eventSHA256||'')||!/^([a-f0-9]{64})$/.test(a.path.updateSHA256||''))throw Error('SST admission differs from its successful native resource update');
    const scope=sstArtifactScope(a.before,a.after,{accountId:a.accountId,region:a.region,version:record.toolVersion.reported});
    if(!isDeepStrictEqual(a.path.scope,scope)||scope.stage!==record.stage)throw Error('SST artifact scope differs from its original observations');
    // Pinned SST stores RFC3339 whole seconds; compare its start at that same
    // precision rather than rejecting a command launched mid-second.
    if(Date.parse(a.path.timeStarted)<Math.floor(started/1000)*1000||Date.parse(a.path.timeCompleted)>Date.parse(a.after.observedAt))throw Error('SST native history falls outside this observed attempt');
    validatePulumiEvents(a.path,scope);
  }
  if(record.provider==='cdk'&&(!isDeepStrictEqual(a.path.ignoredChanges,[])||!isDeepStrictEqual([...a.path.functions].sort(),[...names].sort())||record.toolVersion.reported!=='2.1145.0'||!a.before.nativeTemplate?.stableSHA256||a.before.nativeTemplate.stableSHA256!==a.after.nativeTemplate?.stableSHA256||a.path.nonCodeTemplateSHA256!==a.after.nativeTemplate.stableSHA256))throw Error('CDK admission must cover every function without ignored changes');
  if(record.provider==='serverless'&&(!isDeepStrictEqual(a.path.functions?.map(f=>f.function).sort(),[...names].sort())||a.path.functions.some(f=>!f.success||f.exitCode!==0)))throw Error('Serverless admission must include every successful native child');
  if(!a.proof?.file||!/^[a-f0-9]{64}$/.test(a.proof.sha256||'')||!record.evidence.some(e=>isDeepStrictEqual(e,a.proof)))throw Error('Lambda update admission requires an immutable proof sidecar');
  if(!Array.isArray(a.nativeLogEvidence)||!a.nativeLogEvidence.length||a.nativeLogEvidence.some(e=>!record.evidence.some(item=>isDeepStrictEqual(item,e))))throw Error('Lambda native command logs must be bound to admission');
}
export async function verifyImportedLambdaAdmission(record,{base,qualification}) {
  if(record.kind!=='deploy'||!record.scenario.includes('lambda-')||record.status!=='passed')return;
  validateLambdaAdmission(record);
  if(record.provider==='sst'){
    if(!qualification)throw Error('Imported SST admission requires its reviewed qualification bindings');
    validateLambdaBindings(qualification,'sst');
    const a=record.lambdaUpdateAdmission;
    if(a.before.assetBucket.name!==qualification.nativeAssetBucket||a.before.assetBucket.owner!==qualification.nativeBindings.owner||a.path.scope.appName!==qualification.nativeAppName||a.path.scope.stage!==qualification.stage||qualification.nativeResources.some(r=>a.before.functions.find(f=>f.name===r.name)?.arn!==r.arn)||qualification.nativeResources.length!==a.before.functions.length)throw Error('Imported SST native resources/asset bucket differ from qualification');
  }
  const a=record.lambdaUpdateAdmission,bytes=await readFile(path.resolve(base,a.proof.file));
  if(createHash('sha256').update(bytes).digest('hex')!==a.proof.sha256)throw Error('Lambda update admission checksum mismatch');
  const {proof,...expected}=a;
  if(!isDeepStrictEqual(JSON.parse(bytes),expected))throw Error('Imported Lambda admission differs from its original observations');
  for(const evidence of a.nativeLogEvidence)if(createHash('sha256').update(await readFile(path.resolve(base,evidence.file))).digest('hex')!==evidence.sha256)throw Error('Lambda native command evidence checksum mismatch');
}

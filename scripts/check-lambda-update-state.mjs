import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {sanitizeLambdaState,compareLambdaUpdate,captureLambdaState,sanitizePulumiEvents,validateSstUpdateMetadata,sstArtifactScope,validatePulumiEvents,captureLambdaPath,captureSstHistory,verifyImportedLambdaAdmission,validateLambdaAdmission} from './lambda-update-state.mjs';
const accountId='123456789012',region='eu-west-1',owner='commerce-offline';
const q={environment:{accountId,region},nativeBindings:{owner},nativeStackName:'commerce-offline',stage:'bench'};
const resource={name:'report',type:'lambda',arn:`arn:aws:lambda:${region}:${accountId}:function:report`};
const data={Configuration:{FunctionArn:resource.arn,FunctionName:'report',CodeSha256:'old-code',State:'Active',LastUpdateStatus:'Successful',Runtime:'nodejs22.x',MemorySize:512,Timeout:30,Role:'existing-role',Handler:'index.handler',Environment:{Variables:{PRIVATE_VALUE:'must-never-be-retained'}},Layers:[{Arn:'existing-layer'}]},Tags:{'benchmark-owner':owner},Code:{Location:'https://secret-download.invalid/token'}};
const beforeFunction=sanitizeLambdaState(data,resource,q,'cdk');assert.equal(JSON.stringify(beforeFunction).includes('must-never-be-retained'),false);assert.equal(JSON.stringify(beforeFunction).includes('secret-download'),false);
const next=structuredClone(data);next.Configuration.CodeSha256='new-code';next.Configuration.LastModified='new-time';const afterFunction=sanitizeLambdaState(next,resource,q,'cdk');assert.equal(beforeFunction.configurationSHA256,afterFunction.configurationSHA256);
const managedUpdate=structuredClone(next);managedUpdate.Configuration.RuntimeVersionConfig={RuntimeVersionArn:'new-managed-runtime'};const managedState=sanitizeLambdaState(managedUpdate,resource,q,'cdk');assert.equal(managedState.configurationSHA256,beforeFunction.configurationSHA256);assert.equal(managedState.runtimeVersionArn,'new-managed-runtime');
managedUpdate.Configuration.RuntimeVersionConfig.Error={ErrorCode:'runtime-error',Message:'private-error-detail'};assert.throws(()=>sanitizeLambdaState(managedUpdate,resource,q,'cdk'),/managed-runtime error/);
const cloudformation={stackId:'existing-stack',creationTime:'earlier',lastUpdatedTime:null,inventory:[{logicalId:'Report',type:'AWS::Lambda::Function',physicalId:'report'}]};
const before={functions:[beforeFunction],cloudformation},after={functions:[afterFunction],cloudformation};
assert.equal(compareLambdaUpdate(before,after,{provider:'cdk',names:['report']}).verified,true);
assert.throws(()=>compareLambdaUpdate(before,before,{provider:'cdk',names:['report']}),/did not change/);
const replaced=structuredClone(after);replaced.functions[0].arn+='-replacement';assert.throws(()=>compareLambdaUpdate(before,replaced,{provider:'cdk',names:['report']}),/identity\/configuration/);
const drift=structuredClone(next);drift.Configuration.Environment.Variables.PRIVATE_VALUE='changed-secret';const drifted={...after,functions:[sanitizeLambdaState(drift,resource,q,'cdk')]};assert.throws(()=>compareLambdaUpdate(before,drifted,{provider:'cdk',names:['report']}),/configuration/);
assert.throws(()=>compareLambdaUpdate(before,{...after,cloudformation:{...cloudformation,lastUpdatedTime:'later'}},{provider:'cdk',names:['report']}),/CloudFormation/);
const wrongOwner=structuredClone(data);wrongOwner.Tags['benchmark-owner']='someone-else';assert.throws(()=>sanitizeLambdaState(wrongOwner,resource,q,'cdk'),/ownership/);
const updating=structuredClone(data);updating.Configuration.LastUpdateStatus='InProgress';assert.throws(()=>sanitizeLambdaState(updating,resource,q,'cdk'),/active/);
const events=[{sequence:1,resourcePreEvent:{metadata:{op:'update',urn:'existing-lambda',type:'aws:lambda/function:Function',new:{id:'report',inputs:{secret:'never-retain-inputs'}}}}},{sequence:2,summaryEvent:{maybeCorrupt:false,isPreview:false,resourceChanges:{same:3,update:1}}}];const projection=sanitizePulumiEvents(events.map(e=>JSON.stringify(e)).join('\n'));assert.equal(projection.operations[0].op,'update');assert.equal(JSON.stringify(projection).includes('never-retain-inputs'),false);
assert.equal(sanitizePulumiEvents([...events,{sequence:3,cancelEvent:{}}].map(e=>JSON.stringify(e)).join('\n')).operations.length,1);
for(const event of [{resOpFailedEvent:{}},{errorEvent:{error:'internal'}},{diagnosticEvent:{severity:'error',message:'native failure'}}])assert.throws(()=>sanitizePulumiEvents([...events,event].map(e=>JSON.stringify(e)).join('\n')),/native resource\/engine failure/);
const preview=structuredClone(events);preview[1].summaryEvent.isPreview=true;assert.throws(()=>sanitizePulumiEvents(preview.map(e=>JSON.stringify(e)).join('\n')),/non-preview/);
const metadata={version:'4.17.2',id:'native-update',runID:'attempt-001',command:'deploy',timeStarted:'2026-10-14T01:00:00Z',timeCompleted:'2026-10-14T01:00:05Z',errors:null};
validateSstUpdateMetadata(metadata,'native-update','attempt-001');validateSstUpdateMetadata({...metadata,errors:[]},'native-update','attempt-001');
for(const errors of [[{urn:'failed-function',message:'native failure'}],{},'',undefined])assert.throws(()=>validateSstUpdateMetadata({...metadata,errors},'native-update','attempt-001'),/successful attempt/);
assert.throws(()=>validateSstUpdateMetadata({...metadata,runID:'different-attempt'},'native-update','attempt-001'),/successful attempt/);
for(const op of ['create','delete','replace','create-replacement','delete-replaced','unknown']){const changed=structuredClone(events);changed[0].resourcePreEvent.metadata.op=op;assert.throws(()=>sanitizePulumiEvents(changed.map(e=>JSON.stringify(e)).join('\n')),/created, replaced, deleted/);}
for(const count of [1,25]){
 const resources=Array.from({length:count},(_,i)=>({...resource,name:'function-'+i,arn:resource.arn+'-'+i}));const qualified={...q,nativeResources:resources,baselineProbes:resources.map(r=>({name:r.name}))};let active=0,maximum=0;
 const observed=await captureLambdaState(qualified,'cdk',async argv=>{
  active++;maximum=Math.max(maximum,active);await new Promise(r=>setTimeout(r,1));active--;
  const operation=argv[2];let value;
  if(operation==='get-function'){const r=resources.find(r=>r.arn===argv[argv.indexOf('--function-name')+1]);value=structuredClone(data);value.Configuration.FunctionArn=r.arn;value.Configuration.FunctionName=r.name;}
  else if(operation==='describe-stacks')value={Stacks:[{StackId:`arn:aws:cloudformation:${region}:${accountId}:stack/commerce-offline/id`,CreationTime:'earlier',Tags:[{Key:'benchmark-owner',Value:owner}]}]};
  else value={StackResourceSummaries:resources.map(r=>({LogicalResourceId:r.name,ResourceType:'AWS::Lambda::Function',PhysicalResourceId:r.name}))};
  return {exitCode:0,stdout:JSON.stringify(value)};
 });assert.equal(observed.functions.length,count);assert.ok(maximum<=4);assert.equal(JSON.stringify(observed).includes('must-never-be-retained'),false);
}
const project=await mkdtemp(path.join(os.tmpdir(),'cdk-template-admission-'));
try{
 await mkdir(path.join(project,'cdk.out'));
 const template={Resources:{Report:{Type:'AWS::Lambda::Function',Properties:{FunctionName:'report',Code:{S3Bucket:'owned-assets',S3Key:'old-code.zip'},Environment:{Variables:{PRIVATE_VALUE:'never-retain-template-value'}}},Metadata:{'aws:asset:path':'old-generated-path'}}},Outputs:{ReportArn:{Value:resource.arn}}};
 const qualified={...q,nativeResources:[resource],baselineProbes:[{name:'report'}]};
 const runCommand=async argv=>({exitCode:0,stdout:JSON.stringify(argv[2]==='get-function'?data:argv[2]==='describe-stacks'?{Stacks:[{StackId:`arn:aws:cloudformation:${region}:${accountId}:stack/commerce-offline/id`,CreationTime:'earlier',Tags:[{Key:'benchmark-owner',Value:owner}]}]}:{StackResourceSummaries:[]})});
 const observe=async value=>{await writeFile(path.join(project,'cdk.out',q.nativeStackName+'.template.json'),JSON.stringify(value));return await captureLambdaState(qualified,'cdk',runCommand,{project});};
 const first=await observe(template);template.Resources.Report.Properties.Code.S3Key='new-code.zip';template.Resources.Report.Metadata['aws:asset:path']='new-generated-path';const codeOnly=await observe(template);assert.equal(first.nativeTemplate.stableSHA256,codeOnly.nativeTemplate.stableSHA256);assert.equal(JSON.stringify(codeOnly).includes('never-retain-template-value'),false);
 template.Outputs.NewUnappliedOutput={Value:'unsupported-output-change'};const ignored=await observe(template);assert.notEqual(ignored.nativeTemplate.stableSHA256,codeOnly.nativeTemplate.stableSHA256);
}finally{await rm(project,{recursive:true,force:true});}
// Native SST creates new hash-named upload objects and retires the old objects.
// Its logical ReplaceStep counts once; physical create/delete steps do not.
const assetBucket={name:'commerce-owned-assets',accountId,region,ownerTagKey:'benchmark:owner',owner};
const sstQ={...q,nativeAppName:'commerce-offline',nativeStateBucket:'commerce-owned-state',nativeAssetBucket:assetBucket.name,toolVersion:{reported:'4.17.2'},nativeResources:[resource],baselineProbes:[{name:'report'}]};
const sstData=structuredClone(data);sstData.Tags={'benchmark:owner':owner,'sst:app':sstQ.nativeAppName,'sst:stage':q.stage};sstData.Configuration.CodeSha256=Buffer.alloc(32,1).toString('base64');
const sstNext=structuredClone(sstData);sstNext.Configuration.CodeSha256=Buffer.alloc(32,2).toString('base64');
const sstBefore={observedAt:'2026-10-14T01:00:00Z',functions:[sanitizeLambdaState(sstData,resource,sstQ,'sst')],assetBucket,pathState:{eventKeys:[]}};
const sstAfter={...sstBefore,observedAt:'2026-10-14T01:00:10Z',functions:[sanitizeLambdaState(sstNext,resource,sstQ,'sst')],pathState:{eventKeys:[`eventlog/${sstQ.nativeAppName}/${q.stage}/native-update.json`]}};
const scope=sstArtifactScope(sstBefore,sstAfter,{accountId,region,version:'4.17.2'}),f=scope.functions[0],type='aws:s3/bucketObjectv2:BucketObjectv2';
const objectKey=(kind,side)=>kind==='Code'?`assets/report-code-${f[side+'CodeSHA256']}.zip`:`sourcemap/${f.logGroupArn}/${f[side+'CodeSHA256']}.index.mjs.map`;
const nativeEvents=[];let sequence=0;
const event=(op,phase,urn,eventType,old,newState)=>nativeEvents.push({sequence:sequence++,timestamp:1791939600,[phase==='pre'?'resourcePreEvent':'resOutputsEvent']:{metadata:{op,urn,type:eventType,logical:op==='replace'||op==='update',old,new:newState}}});
for(const kind of ['Code','Sourcemap0']){
 const urn=`urn:pulumi:bench::${sstQ.nativeAppName}::sst:aws:Function$${type}::report${kind}`;
 const old={id:'old-object',inputs:{bucket:assetBucket.name,key:objectKey(kind,'old'),secret:'never-retain-native-input'},outputs:{bucket:assetBucket.name,key:objectKey(kind,'old')}},next={id:'new-object',inputs:{bucket:assetBucket.name,key:objectKey(kind,'new'),secret:'never-retain-native-input'},outputs:{bucket:assetBucket.name,key:objectKey(kind,'new')}};
 for(const op of ['create-replacement','replace','delete-replaced'])for(const phase of ['pre','outputs'])event(op,phase,urn,type,old,op==='delete-replaced'?null:next);
}
for(const phase of ['pre','outputs'])event('update',phase,`urn:pulumi:bench::${sstQ.nativeAppName}::sst:aws:Function$aws:lambda/function:Function::reportFunction`,'aws:lambda/function:Function',{id:'report'},{id:'report'});
nativeEvents.push({sequence:sequence++,summaryEvent:{maybeCorrupt:false,isPreview:false,resourceChanges:{replace:2,update:1}}},{sequence:sequence++,cancelEvent:{}});
const textOf=value=>value.map(e=>JSON.stringify(e)).join('\n');
const nativeProjection=sanitizePulumiEvents(textOf(nativeEvents),scope);
assert.equal(nativeProjection.resourceChanges.replace,2);assert.equal(JSON.stringify(nativeProjection).includes('never-retain-native-input'),false);
assert.equal(compareLambdaUpdate(sstBefore,sstAfter,{provider:'sst',names:['report']}).verified,true);
for(const mutation of [
 es=>{es[0].resourcePreEvent.metadata.new.inputs.bucket='foreign';es[0].resourcePreEvent.metadata.new.outputs.bucket='foreign';},
 es=>{es[0].resourcePreEvent.metadata.old.inputs.key='assets/report-code-'+Buffer.alloc(32,3).toString('hex')+'.zip';es[0].resourcePreEvent.metadata.old.outputs.key=es[0].resourcePreEvent.metadata.old.inputs.key;},
 es=>{es[6].resourcePreEvent.metadata.new.inputs.key='sourcemap/'+f.logGroupArn+'/'+f.oldCodeSHA256+'.index.mjs.map';es[6].resourcePreEvent.metadata.new.outputs.key=es[6].resourcePreEvent.metadata.new.inputs.key;},
 es=>{es[0].resourcePreEvent.metadata.urn=es[0].resourcePreEvent.metadata.urn.replace('reportCode','unselectedCode');},
 es=>{es[0].resourcePreEvent.metadata.urn=es[0].resourcePreEvent.metadata.urn.replace(':bench::',':foreign::');},
 es=>{es[0].resourcePreEvent.metadata.type='aws:iam/role:Role';},
 es=>{es[0].resourcePreEvent.metadata.urn=es[0].resourcePreEvent.metadata.urn.replace('reportCode','reportFunction');es[0].resourcePreEvent.metadata.type='aws:lambda/function:Function';},
 es=>{es[0].resourcePreEvent.metadata.op='create';},
 es=>{es.splice(5,1);},
 es=>{es.find(e=>e.summaryEvent).summaryEvent.resourceChanges.replace=1;},
 es=>{es.find(e=>e.summaryEvent).summaryEvent.resourceChanges['create-replacement']=2;},
 es=>{es.push({sequence:99,resOpFailedEvent:{metadata:{inputs:{secret:'never-retain-error'}}}});}
]){const bad=structuredClone(nativeEvents);mutation(bad);assert.throws(()=>sanitizePulumiEvents(textOf(bad),scope));}
try{sanitizePulumiEvents(textOf([...nativeEvents,{sequence:99,diagnosticEvent:{severity:'error',message:'never-retain-native-error'}}]),scope);assert.fail('Failed history admitted');}catch(error){assert.ok(error.lambdaPathObservation.operations.length);assert.equal(JSON.stringify(error.lambdaPathObservation).includes('never-retain-native-error'),false);assert.equal(error.lambdaPathObservation.failures,1);}
assert.throws(()=>sanitizePulumiEvents(textOf(nativeEvents)+'\nnot-json',scope),/summary/);
assert.throws(()=>sanitizePulumiEvents(textOf(nativeEvents)+'\nnull',scope),/summary/);
const observedCalls=[];
const sstAws=async argv=>{
 observedCalls.push(argv);assert.equal(argv[argv.indexOf('--expected-bucket-owner')+1],accountId);
 let value;
 if(argv[2]==='get-object'){
  const key=argv[argv.indexOf('--key')+1];value=key.startsWith('eventlog/')?textOf(nativeEvents):JSON.stringify(metadata);
  await writeFile(argv[argv.indexOf('--expected-bucket-owner')+2],value);return {exitCode:0,stdout:'{}'};
 }
 if(argv[2]==='list-objects-v2')value={Contents:sstAfter.pathState.eventKeys.map(Key=>({Key}))};
 else if(argv[2]==='head-bucket')return {exitCode:0,stdout:''};
 else if(argv[2]==='get-bucket-location')value={LocationConstraint:region};
 else if(argv[2]==='get-bucket-tagging')value={TagSet:[{Key:'benchmark:owner',Value:owner},{Key:'private',Value:'never-retain-bucket-tag'}]};
 else assert.fail('Unexpected AWS operation');
 return {exitCode:0,stdout:JSON.stringify(value)};
};
const captured=await captureLambdaPath(sstQ,'sst',{before:sstBefore,after:sstAfter,runId:metadata.runID,logs:[],runCommand:sstAws});
assert.equal(captured.metadataVerified,true);validatePulumiEvents(captured,scope);
const failedAws=async argv=>{if(argv[2]==='get-object'&&argv[argv.indexOf('--key')+1].startsWith('eventlog/')){await writeFile(argv[argv.indexOf('--expected-bucket-owner')+2],textOf([...nativeEvents,{sequence:99,errorEvent:{message:'private-engine-error'}}]));return {exitCode:0,stdout:'{}'};}return sstAws(argv);};
await assert.rejects(()=>captureLambdaPath(sstQ,'sst',{before:sstBefore,after:sstAfter,runId:metadata.runID,logs:[],runCommand:failedAws}),error=>{assert.equal(error.lambdaPathObservation.failures,1);assert.ok(error.lambdaPathObservation.updateSHA256);assert.equal(JSON.stringify(error.lambdaPathObservation).includes('private-engine-error'),false);return true;});
const failedMetadataAws=async argv=>{if(argv[2]==='get-object'&&argv[argv.indexOf('--key')+1].startsWith('update/')){await writeFile(argv[argv.indexOf('--expected-bucket-owner')+2],JSON.stringify({...metadata,errors:[{message:'private-metadata-error'}]}));return {exitCode:0,stdout:'{}'};}return sstAws(argv);};
await assert.rejects(()=>captureSstHistory(sstQ,{before:sstBefore,runId:metadata.runID,runCommand:failedMetadataAws}),error=>{assert.ok(error.lambdaPathObservation.operations.length);assert.equal(error.lambdaPathObservation.metadataVerified,false);assert.equal(JSON.stringify(error.lambdaPathObservation).includes('private-metadata-error'),false);return true;});
const bucketObserver=async argv=>argv[2]==='get-function'?{exitCode:0,stdout:JSON.stringify(sstData)}:sstAws(argv);
const observedBucket=await captureLambdaState(sstQ,'sst',bucketObserver);assert.deepEqual(observedBucket.assetBucket,assetBucket);assert.equal(JSON.stringify(observedBucket).includes('never-retain-bucket-tag'),false);
await assert.rejects(()=>captureLambdaState(sstQ,'sst',async argv=>argv[2]==='get-bucket-tagging'?{exitCode:0,stdout:JSON.stringify({TagSet:[{Key:'benchmark:owner',Value:'foreign'}]})}:bucketObserver(argv)),/ownership/);
const importRoot=await mkdtemp(path.join(os.tmpdir(),'sst-admission-import-'));
try{
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),nativeLog='Native deployment succeeded';await writeFile(path.join(importRoot,'native.log'),nativeLog);
 const logEvidence={file:'native.log',sha256:sha(nativeLog)};
 const admission={schemaVersion:1,...compareLambdaUpdate(sstBefore,sstAfter,{provider:'sst',names:['report']}),provider:'sst',runId:metadata.runID,sourceCommit:'a'.repeat(40),appId:'commerce-offline',stage:'bench',accountId,region,before:sstBefore,after:sstAfter,path:captured,nativeLogEvidence:[logEvidence]};
 const body=JSON.stringify(admission);await writeFile(path.join(importRoot,'admission.json'),body);const proof={file:'admission.json',sha256:sha(body)};
 const record={kind:'deploy',scenario:'cli-lambda-1',status:'passed',provider:'sst',runId:metadata.runID,sourceCommit:admission.sourceCommit,appId:admission.appId,stage:admission.stage,environment:{accountId,region},startedAt:'2026-10-14T01:00:00.500Z',nativeCompletion:{finishedAt:'2026-10-14T01:00:06Z'},readiness:{observations:[{name:'report'}]},toolVersion:sstQ.toolVersion,evidence:[proof,logEvidence],lambdaUpdateAdmission:{...admission,proof}};
 validateLambdaAdmission(record);const staleTime=structuredClone(record);staleTime.lambdaUpdateAdmission.path.timeStarted='2026-10-14T00:59:59Z';assert.throws(()=>validateLambdaAdmission(staleTime),/outside/);await verifyImportedLambdaAdmission(record,{base:importRoot,qualification:sstQ});
 const tampered=structuredClone(record);tampered.lambdaUpdateAdmission.path.operations[0].new.bucket='foreign';assert.throws(()=>validateLambdaAdmission(tampered),/bucket/);
 const invalidTime=structuredClone(record);invalidTime.lambdaUpdateAdmission.path.timeCompleted='not-a-date';assert.throws(()=>validateLambdaAdmission(invalidTime),/successful native/);
 await assert.rejects(()=>verifyImportedLambdaAdmission(record,{base:importRoot,qualification:{...sstQ,nativeAssetBucket:'self-declared'}}),/qualification/);
 await assert.rejects(()=>verifyImportedLambdaAdmission(record,{base:importRoot}),/qualification/);
 await writeFile(path.join(importRoot,'admission.json'),body+' ');await assert.rejects(()=>verifyImportedLambdaAdmission(record,{base:importRoot,qualification:sstQ}),/checksum/);
}finally{await rm(importRoot,{recursive:true,force:true});}
console.log('Lambda ownership, stable configuration, fast code updates, no-replacement proof and safe native event observations passed. No cloud requests.');

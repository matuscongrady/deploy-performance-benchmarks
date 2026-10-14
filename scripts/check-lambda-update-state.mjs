import assert from 'node:assert/strict';
import {sanitizeLambdaState,compareLambdaUpdate,captureLambdaState,sanitizePulumiEvents,validateSstUpdateMetadata} from './lambda-update-state.mjs';
const accountId='123456789012',region='eu-west-1',owner='commerce-offline';
const q={environment:{accountId,region},nativeBindings:{owner},nativeStackName:'commerce-offline',stage:'bench'};
const resource={name:'report',type:'lambda',arn:`arn:aws:lambda:${region}:${accountId}:function:report`};
const data={Configuration:{FunctionArn:resource.arn,FunctionName:'report',CodeSha256:'old-code',State:'Active',LastUpdateStatus:'Successful',Runtime:'nodejs22.x',MemorySize:512,Timeout:30,Role:'existing-role',Handler:'index.handler',Environment:{Variables:{PRIVATE_VALUE:'must-never-be-retained'}},Layers:[{Arn:'existing-layer'}]},Tags:{'benchmark-owner':owner},Code:{Location:'https://secret-download.invalid/token'}};
const beforeFunction=sanitizeLambdaState(data,resource,q,'cdk');assert.equal(JSON.stringify(beforeFunction).includes('must-never-be-retained'),false);assert.equal(JSON.stringify(beforeFunction).includes('secret-download'),false);
const next=structuredClone(data);next.Configuration.CodeSha256='new-code';next.Configuration.LastModified='new-time';const afterFunction=sanitizeLambdaState(next,resource,q,'cdk');assert.equal(beforeFunction.configurationSHA256,afterFunction.configurationSHA256);
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
const metadata={id:'native-update',runID:'attempt-001',command:'deploy',timeStarted:'2026-10-14T01:00:00Z',timeCompleted:'2026-10-14T01:00:05Z',errors:null};
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
console.log('Lambda ownership, stable configuration, fast code updates, no-replacement proof and safe native event observations passed. No cloud requests.');

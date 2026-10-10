import {command} from './lib.mjs';
export function validateExistingApplication(q,provider) {
  if(provider!=='sst'){if(typeof q.nativeStackName!=='string'||!q.nativeStackName)throw Error('Qualification must identify its existing CloudFormation stack');return;}
  if(!Array.isArray(q.nativeResources)||q.nativeResources.length!==q.baselineProbes.length)throw Error('SST qualification needs every existing Lambda/ECS resource');
  const names=q.baselineProbes.map(p=>p.name).sort();
  if(JSON.stringify(q.nativeResources.map(r=>r.name).sort())!==JSON.stringify(names))throw Error('SST resource names differ from the qualified application');
  const prefix=`arn:aws:`;
  for(const r of q.nativeResources){
    const service=r.type==='lambda'?'lambda':r.type==='ecs'?'ecs':null;
    if(!service||!r.arn?.startsWith(`${prefix}${service}:${q.environment.region}:${q.environment.accountId}:`))throw Error('SST resource ARN differs from the qualified account/region');
    if(r.type==='ecs'&&!r.clusterArn?.startsWith(`${prefix}ecs:${q.environment.region}:${q.environment.accountId}:cluster/`))throw Error('SST ECS resource needs its existing cluster ARN');
  }
}
export async function verifyExistingApplication({q,provider,appName,region},runCommand=command) {
  validateExistingApplication(q,provider);
  if(provider!=='sst'){
    const r=await runCommand(['aws','cloudformation','describe-stacks','--stack-name',q.nativeStackName,'--region',region,'--output','json'],{timeoutMs:30000});
    if(r.exitCode!==0||!JSON.parse(r.stdout).Stacks?.length)throw Error('The qualified baseline CloudFormation stack must already exist');
    return {verified:true,kind:'cloudformation',stackName:q.nativeStackName};
  }
  const resources=await Promise.all(q.nativeResources.map(async resource=>{
    const argv=resource.type==='lambda'?['aws','lambda','get-function','--function-name',resource.arn,'--region',region,'--output','json']:['aws','ecs','describe-services','--cluster',resource.clusterArn,'--services',resource.arn,'--include','TAGS','--region',region,'--output','json'];
    const response=await runCommand(argv,{timeoutMs:30000});if(response.exitCode!==0)throw Error('The qualified SST resource must already exist: '+resource.name);
    const data=JSON.parse(response.stdout);
    const found=resource.type==='lambda'?data.Configuration:data.services?.length===1?data.services[0]:null;
    const arn=resource.type==='lambda'?found?.FunctionArn:found?.serviceArn;
    const tags=resource.type==='lambda'?data.Tags:Object.fromEntries((found?.tags||[]).map(t=>[t.key,t.value]));
    if(arn!==resource.arn||data.failures?.length||resource.type==='ecs'&&found.status!=='ACTIVE'||tags?.['sst:app']!==appName||tags?.['sst:stage']!==q.stage)throw Error('Existing SST resource identity/app/stage differs from qualification: '+resource.name);
    return {name:resource.name,type:resource.type,arn};
  }));
  return {verified:true,kind:'sst-resources',appName,stage:q.stage,resources};
}

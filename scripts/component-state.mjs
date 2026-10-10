import {createHash} from 'node:crypto';
import {command} from './lib.mjs';
export async function captureComponents(specs) {
  if(!Array.isArray(specs)||specs.length!==5||new Set(specs.map(s=>s.name)).size!==5)throw Error('Five unique native component state commands are required');
  const observations=[];
  for(const spec of specs){const result=await command(spec.argv,{cwd:spec.cwd,timeoutMs:60000});if(result.exitCode!==0)throw Error('Native component state failed: '+spec.name);const state=JSON.parse(result.stdout);if(!state.deploymentId||!state.configurationHash||!Array.isArray(state.artifactIds)||!state.artifactIds.length)throw Error('Missing native deployment, configuration or artifact identity for '+spec.name);observations.push({name:spec.name,observedAt:new Date().toISOString(),...state});}
  return observations;
}
export function compareUnchanged(before,after) {
  const evidence=[];
  for(const name of ['inventory','webhooks']) {const a=before.find(s=>s.name===name),b=after.find(s=>s.name===name);if(!a||!b)throw Error('Missing unchanged component state: '+name);const equal=a.deploymentId===b.deploymentId&&a.configurationHash===b.configurationHash&&JSON.stringify([...a.artifactIds].sort())===JSON.stringify([...b.artifactIds].sort());if(!equal)throw Error('Unchanged service deployment/artifact/configuration was replaced: '+name);evidence.push({name,unchanged:true,before:a,after:b});}
  return {verified:true,observations:evidence};
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
 try{
  const [kind,region,cluster,service]=process.argv.slice(2);if(kind!=='ecs'||!region||!cluster||!service)throw Error('Usage: node scripts/component-state.mjs ecs REGION CLUSTER SERVICE');
  async function aws(args){const r=await command(['aws',...args,'--region',region,'--output','json','--no-cli-pager'],{timeoutMs:60000});if(r.exitCode!==0)throw Error('AWS ECS state read failed');return JSON.parse(r.stdout);}
  const described=await aws(['ecs','describe-services','--cluster',cluster,'--services',service]);if(described.failures?.length||described.services?.length!==1)throw Error('Service lookup failed');const live=described.services[0];
  const task=(await aws(['ecs','describe-task-definition','--task-definition',live.taskDefinition])).taskDefinition;
  const listed=await aws(['ecs','list-tasks','--cluster',cluster,'--service-name',live.serviceName,'--desired-status','RUNNING']);if(!listed.taskArns?.length)throw Error('No running service tasks');
  const running=await aws(['ecs','describe-tasks','--cluster',cluster,'--tasks',...listed.taskArns]);if(running.failures?.length||running.tasks.length!==listed.taskArns.length)throw Error('Incomplete running task state');
  const images=running.tasks.flatMap(t=>t.containers||[]).map(c=>c.imageDigest);if(images.some(v=>!v))throw Error('A running container has no immutable image digest');
  const configurationHash=createHash('sha256').update(JSON.stringify({taskDefinition:live.taskDefinition,desiredCount:live.desiredCount,loadBalancers:live.loadBalancers,networkConfiguration:live.networkConfiguration,taskCpu:task.cpu,taskMemory:task.memory,containers:task.containerDefinitions,executionRole:task.executionRoleArn,taskRole:task.taskRoleArn})).digest('hex');
  console.log(JSON.stringify({deploymentId:live.deployments.find(d=>d.status==='PRIMARY')?.id,configurationHash,artifactIds:[...new Set(images)].sort(),serviceArn:live.serviceArn,taskDefinition:live.taskDefinition}));
 }catch(e){console.error(e.message);process.exitCode=1;}
}

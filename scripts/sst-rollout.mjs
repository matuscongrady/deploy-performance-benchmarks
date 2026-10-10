import {command} from './lib.mjs';
import {validateExistingApplication} from './existing-app.mjs';
import {probe} from './probe.mjs';

export function needsSstRollout(scenario,provider) {
  return provider==='sst'&&scenario.kind==='deploy'&&!scenario.fixture.startsWith('lambda-');
}
export function validateSstRolloutBindings(q) {
  validateExistingApplication(q,'sst');
  if(q.nativeResources.some(r=>r.type!=='ecs'))throw Error('SST container admission needs existing ECS service bindings');
}
async function serviceState(q,resource,runCommand,timeoutMs=30000) {
  const argv=['aws','ecs','describe-services','--cluster',resource.clusterArn,'--services',resource.arn,'--region',q.environment.region,'--output','json','--no-cli-pager'];
  const response=await runCommand(argv,{timeoutMs});
  if(response.exitCode!==0)throw Error('SST rollout state read failed: '+resource.name);
  const data=JSON.parse(response.stdout),service=data.services?.[0];
  if(data.failures?.length||data.services?.length!==1||service.serviceArn!==resource.arn)throw Error('SST rollout service identity differs: '+resource.name);
  return service;
}
function stable(service) {
  return service.deployments?.length===1&&service.deployments[0].status==='PRIMARY'&&service.deployments[0].rolloutState==='COMPLETED'&&service.desiredCount>0&&service.runningCount===service.desiredCount&&service.pendingCount===0;
}
function changedProbes(q) {return q.probes.filter(p=>p.expected.revision!==q.baselineProbes.find(b=>b.name===p.name).expected.revision);}
export async function captureSstRolloutBaseline(q,{runCommand=command}={}) {
  validateSstRolloutBindings(q);
  return await Promise.all(changedProbes(q).map(async p=>{
    const resource=q.nativeResources.find(r=>r.name===p.name);
    const service=await serviceState(q,resource,runCommand);
    if(!stable(service)||!service.deployments[0].id)throw Error('SST baseline must have a completed ECS rollout before timing: '+p.name);
    return {name:p.name,serviceArn:resource.arn,deploymentId:service.deployments[0].id,taskDefinition:service.taskDefinition,observedAt:new Date().toISOString()};
  }));
}
export async function admitSstRollout(q,{baseline,runCommand=command,businessProbe=probe,timeoutMs=q.timeoutMs||900000,intervalMs=5000}={}) {
  validateSstRolloutBindings(q);
  const changed=changedProbes(q);
  if(!Array.isArray(baseline)||baseline.length!==changed.length||new Set(baseline.map(b=>b.name)).size!==changed.length||changed.some(p=>!baseline.find(b=>b.name===p.name)?.deploymentId))throw Error('SST admission needs its observed pre-timer deployment IDs');
  const deadline=performance.now()+timeoutMs;
  const latest=new Map();let cancelled=false;
  try {
  const observations=await Promise.all(changed.map(async p=>{
    const resource=q.nativeResources.find(r=>r.name===p.name);
    const before=baseline.find(b=>b.name===p.name);
    while(!cancelled&&performance.now()<deadline) {
      const service=await serviceState(q,resource,runCommand,Math.max(1,Math.min(30000,deadline-performance.now())));
      const primary=service.deployments?.find(d=>d.status==='PRIMARY');
      latest.set(p.name,{name:p.name,serviceArn:resource.arn,beforeDeploymentId:before.deploymentId,deploymentId:primary?.id,taskDefinition:service.taskDefinition,rolloutState:primary?.rolloutState,observedAt:new Date().toISOString()});
      if(primary?.rolloutState==='FAILED')throw Error('SST ECS rollout failed: '+p.name);
      if(primary?.id&&primary.id!==before.deploymentId&&stable(service)) {
        return latest.get(p.name);
      }
      await new Promise(resolve=>setTimeout(resolve,Math.min(intervalMs,Math.max(0,deadline-performance.now()))));
    }
    throw Error('SST ECS rollout did not complete: '+p.name);
  }));
  // A rollback can restore a stable old deployment. Recheck business revisions after stability.
  const postRolloutReadiness=await businessProbe(q.probes,{timeoutMs:Math.max(1,Math.min(30000,deadline-performance.now()))});
  if(postRolloutReadiness.verified!==true)throw Error('SST post-rollout business verification failed');
  return {verified:true,observations,postRolloutReadiness,verifiedAt:new Date().toISOString(),outsideReadinessTimer:true};
  }catch(error){cancelled=true;error.rolloutAdmission={verified:false,observations:[...latest.values()],failure:error.message,outsideReadinessTimer:true};throw error;}
}

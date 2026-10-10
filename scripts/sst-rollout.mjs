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
export async function admitSstRollout(q,{runCommand=command,businessProbe=probe,timeoutMs=q.timeoutMs||900000,intervalMs=5000}={}) {
  validateSstRolloutBindings(q);
  const changed=q.probes.filter(p=>p.expected.revision!==q.baselineProbes.find(b=>b.name===p.name).expected.revision);
  const deadline=performance.now()+timeoutMs;
  const latest=new Map();let cancelled=false;
  try {
  const observations=await Promise.all(changed.map(async p=>{
    const resource=q.nativeResources.find(r=>r.name===p.name);
    while(!cancelled&&performance.now()<deadline) {
      const argv=['aws','ecs','describe-services','--cluster',resource.clusterArn,'--services',resource.arn,'--region',q.environment.region,'--output','json','--no-cli-pager'];
      const response=await runCommand(argv,{timeoutMs:Math.max(1,Math.min(30000,deadline-performance.now()))});
      if(response.exitCode!==0)throw Error('SST rollout state read failed: '+p.name);
      const data=JSON.parse(response.stdout),service=data.services?.[0];
      if(data.failures?.length||data.services?.length!==1||service.serviceArn!==resource.arn)throw Error('SST rollout service identity differs: '+p.name);
      const primary=service.deployments?.find(d=>d.status==='PRIMARY');
      latest.set(p.name,{name:p.name,serviceArn:resource.arn,deploymentId:primary?.id,taskDefinition:service.taskDefinition,rolloutState:primary?.rolloutState,observedAt:new Date().toISOString()});
      if(primary?.rolloutState==='FAILED')throw Error('SST ECS rollout failed: '+p.name);
      if(primary?.id&&primary.rolloutState==='COMPLETED'&&service.deployments.length===1&&service.desiredCount>0&&service.runningCount===service.desiredCount&&service.pendingCount===0) {
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

import {command} from './lib.mjs';
export async function waitForPipeline(spec,sourceCommit,{timeoutMs=1800000,intervalMs=2000}={}) {
  if(!Array.isArray(spec?.argv)||!spec.argv.length)throw Error('Git tests require a native pipeline completion command');
  const deadline=performance.now()+timeoutMs;const attempts=[];
  while(performance.now()<deadline){
    const run=await command(spec.argv,{cwd:spec.cwd,timeoutMs:Math.max(1,Math.min(30000,deadline-performance.now()))});
    attempts.push({finishedAt:run.finishedAt,exitCode:run.exitCode,stdout:run.stdout,stderr:run.stderr});
    if(run.exitCode===0){let state;try{state=JSON.parse(run.stdout);}catch{throw Error('Native pipeline completion must return JSON');}
      if(state.sourceCommit!==sourceCommit)throw Error('Native pipeline completion refers to a different source commit');
      if(state.status==='failed'||state.status==='cancelled')throw Error('Native deployment pipeline '+state.status);
      if(state.status==='succeeded'){if(!state.runId)throw Error('Native pipeline completion needs its run/deployment ID');return {verified:true,...state,verifiedAt:new Date().toISOString(),attempts};}
    }
    await new Promise(resolve=>setTimeout(resolve,Math.min(intervalMs,Math.max(0,deadline-performance.now()))));
  }
  throw Error('Native deployment pipeline did not complete successfully');
}

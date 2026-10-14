// Observe first business readiness while the native command is still running.
// Native completion and the final rollback/stability checks admit the result separately.
export async function measureDeployment({runNative,probeReady,clock:providedClock}) {
  const clock=providedClock||await localClock();
  const controller=new AbortController();
  const start=clock.mark();
  // Start the command before the first probe, without awaiting its completion.
  const native=Promise.resolve().then(runNative).then(value=>{
    value.completedMonotonicNs=clock.mark().monotonicNs;
    if(!value.passed)controller.abort(Error(value.failure||'Native command failed'));
    return value;
  },error=>{controller.abort(error);return {passed:false,failure:error.message,completedMonotonicNs:clock.mark().monotonicNs};});
  const observed=Promise.resolve().then(()=>probeReady(controller.signal)).then(readiness=>({readiness,end:clock.mark()}),error=>({readiness:{verified:false},failure:error.message,end:clock.mark()}));
  const [completion,first]=await Promise.all([native,observed]);
  const timing=intervalTiming(clock,start,first.end);
  return {startedAt:start.observedAt,finishedAt:first.end.observedAt,durationMs:timing.durationMs,timing,readiness:first.readiness,completion,status:completion.passed&&first.readiness.verified?'passed':'failed',failure:completion.passed?first.failure:completion.failure};
}
import {localClock,intervalTiming} from './clock.mjs';

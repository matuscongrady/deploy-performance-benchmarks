// Observe first business readiness while the native command is still running.
// Native completion and the final rollback/stability checks admit the result separately.
export async function measureDeployment({runNative,probeReady}) {
  const controller=new AbortController();
  const startedAt=new Date().toISOString(),start=performance.now();
  // Start the command before the first probe, without awaiting its completion.
  const native=Promise.resolve().then(runNative).then(value=>{
    if(!value.passed)controller.abort(Error(value.failure||'Native command failed'));
    return value;
  },error=>{controller.abort(error);return {passed:false,failure:error.message};});
  const observed=Promise.resolve().then(()=>probeReady(controller.signal)).then(readiness=>({readiness,finishedAt:new Date().toISOString(),durationMs:performance.now()-start}),error=>({readiness:{verified:false},failure:error.message}));
  const [completion,first]=await Promise.all([native,observed]);
  const finishedAt=first.finishedAt||new Date().toISOString();
  return {startedAt,finishedAt,durationMs:first.durationMs??performance.now()-start,readiness:first.readiness,completion,status:completion.passed&&first.readiness.verified?'passed':'failed',failure:completion.passed?first.failure:completion.failure};
}

import {command} from './lib.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID,createHmac} from 'node:crypto';
function matches(value, expected) { if(Array.isArray(expected)) return Array.isArray(value)&&value.length===expected.length&&expected.every((v,i)=>matches(value[i],v)); if(expected&&typeof expected==='object') return value&&typeof value==='object'&&Object.entries(expected).every(([k,v])=>matches(value[k],v)); return value===expected; }
export async function probe(specs,{timeoutMs=900000,intervalMs=500,signal}={}) {
  if(!Array.isArray(specs)||!specs.length) throw Error('At least one runtime probe is required');
  if(specs.some(s=>!s.expected||typeof s.expected!=='object'||!('revision' in s.expected))) throw Error('Every probe must assert a runtime revision');
  const deadline=performance.now()+timeoutMs;
  const pending=new Set(specs.map((_,i)=>i)); const observations=[];
  while(pending.size&&performance.now()<deadline) {
    signal?.throwIfAborted();
    await Promise.all([...pending].map(async i=>{
      const spec=specs[i];let value;const body=spec.body?structuredClone(spec.body):undefined;const expected=structuredClone(spec.expected);
      if(body&&Object.hasOwn(body,'jobId')){body.jobId='probe-'+randomUUID();expected.jobId=body.jobId;}
      if(body&&spec.sign==='signature'){if(typeof body.payload!=='string')throw Error('Signed webhook needs a string payload');body.signature=createHmac('sha256','fixture-only-not-a-secret').update(body.payload).digest('hex');}
      try {
        const remaining=Math.max(1,Math.min(10000,deadline-performance.now()));
        if(spec.url) {const response=await fetch(spec.url,{method:spec.method||'GET',headers:body?{'content-type':'application/json',...spec.headers}:spec.headers,body:body?JSON.stringify(body):undefined,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(Math.ceil(remaining))]):AbortSignal.timeout(Math.ceil(remaining))});if(!response.ok)return;value=await response.json();}
        else if(spec.argv) {const response=await command(spec.argv,{cwd:spec.cwd,timeoutMs:remaining,signal});if(response.exitCode!==0)return;value=JSON.parse(response.stdout);}
        else throw Error('Probe needs url or argv');
        if(matches(value,expected)){observations.push({name:spec.name||String(i),expected,observed:value,observedAt:new Date().toISOString()});pending.delete(i);}
      }catch{/* Transient replacement responses remain pending. */}
    }));
    signal?.throwIfAborted();
    if(pending.size)await delay(Math.min(intervalMs,Math.max(0,deadline-performance.now())),undefined,{signal});
  }
  if(pending.size)throw Error('Runtime revisions were not ready: '+[...pending].map(i=>specs[i].name||i).join(', '));
  return {verified:true,observations};
}

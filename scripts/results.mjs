import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {root,json,validateRecord} from './lib.mjs';
export function summarizeResults(records) {
  const groups=new Map();
  for(const record of records){const r=validateRecord(record);const key=[r.scenario,r.provider,r.artifacts?.format||'deployment',r.cacheEvidence?.series||'unknown-cache',JSON.stringify(r.toolVersion),JSON.stringify(r.settings),r.environment?.region,r.environment?.plan,JSON.stringify({cpu:r.environment?.cpu,cores:r.environment?.cores,memoryBytes:r.environment?.memoryBytes,arch:r.environment?.arch,node:r.environment?.node,buildCapacity:r.environment?.buildCapacity})].join(' | ');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  const median=values=>values.length?(values.length%2?values[Math.floor(values.length/2)]:(values[values.length/2-1]+values[values.length/2])/2):null;
  return [...groups].map(([key,runs])=>{const passed=runs.filter(r=>r.status==='passed');const times=passed.map(r=>r.durationMs/1000).sort((a,b)=>a-b);const sizes=passed.filter(r=>r.kind==='package'&&r.artifacts.sizeAvailable!==false&&Number.isSafeInteger(r.artifacts.bytes)&&r.artifacts.bytes>0).map(r=>r.artifacts.bytes).sort((a,b)=>a-b);return {test:key,attempts:runs.length,passed:passed.length,failed:runs.filter(r=>r.status==='failed').length,unqualified:runs.filter(r=>r.status==='unqualified').length,medianSeconds:median(times),minSeconds:times[0]??null,maxSeconds:times.at(-1)??null,sizeSamples:sizes.length,medianBytes:median(sizes),minBytes:sizes[0]??null,maxBytes:sizes.at(-1)??null,publishable:passed.length>=10,sizePublishable:sizes.length>=10};});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const dir=process.argv[2]||path.join(root,'results/raw');
  let files;try{files=(await readdir(dir)).filter(f=>f.endsWith('.json'));}catch{console.log('No measured results yet.');process.exit(0);}
  const records=await Promise.all(files.map(file=>json(path.join(dir,file))));
  for(const result of summarizeResults(records))console.log(JSON.stringify(result,null,2));
}

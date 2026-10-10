import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {root,json,validateRecord} from './lib.mjs';
const dir=process.argv[2]||path.join(root,'results/raw');
let files; try {files=(await readdir(dir)).filter(f=>f.endsWith('.json'));} catch {console.log('No measured results yet.');process.exit(0);}
const groups=new Map();
for(const file of files){const r=validateRecord(await json(path.join(dir,file)));const key=[r.scenario,r.provider,r.artifacts?.format||'deployment',r.cacheEvidence?.series||'unknown-cache',JSON.stringify(r.toolVersion),JSON.stringify(r.settings),r.environment?.region,r.environment?.plan].join(' | ');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
for(const [key,runs] of groups){const passed=runs.filter(r=>r.status==='passed');const times=passed.map(r=>r.durationMs/1000).sort((a,b)=>a-b);const middle=Math.floor(times.length/2);const median=times.length?(times.length%2?times[middle]:(times[middle-1]+times[middle])/2):null;console.log(JSON.stringify({test:key,attempts:runs.length,passed:passed.length,failed:runs.filter(r=>r.status==='failed').length,unqualified:runs.filter(r=>r.status==='unqualified').length,medianSeconds:median,minSeconds:times[0]??null,maxSeconds:times.at(-1)??null,publishable:passed.length>=10},null,2));}

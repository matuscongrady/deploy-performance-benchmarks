import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
export async function save(file, value) { await mkdir(path.dirname(file), {recursive:true}); await writeFile(file, JSON.stringify(value,null,2)+'\n'); }
export async function saveResult(file, value) { await mkdir(path.dirname(file), {recursive:true}); await writeFile(file, JSON.stringify(value,null,2)+'\n',{flag:'wx'}); }
export async function refuseExistingResult(file) { try { await access(file); } catch(e) { if(e.code==='ENOENT') return; throw e; } throw Error('Result already exists; use a new run ID: '+file); }
export async function scenarios() { return (await json(path.join(root,'scenarios/index.json'))).scenarios; }
export async function scenarioById(id) { const value=(await scenarios()).find(s=>s.id===id); if(!value) throw Error('Unknown test: '+id); return value; }
export function parseArgs(args) { const positional=[]; const flags={}; for(let i=0;i<args.length;i++) { if(args[i].startsWith('--')) { const key=args[i].slice(2); if(['execute'].includes(key)) flags[key]=true; else { if(!args[i+1]||args[i+1].startsWith('--')) throw Error('Missing value for --'+key); flags[key]=args[++i]; } } else positional.push(args[i]); } return {positional,flags}; }
export async function sha256(file) { return createHash('sha256').update(await readFile(file)).digest('hex'); }
export async function command(argv,{cwd=root,env={},stdoutFile,stderrFile,timeoutMs=1800000}={}) {
  if(!Array.isArray(argv)||!argv.length||argv.some(a=>typeof a!=='string')) throw Error('Commands must be argv arrays');
  const started=performance.now(); const wallStarted=new Date().toISOString();
  return await new Promise((resolve,reject)=>{
    const child=spawn(argv[0],argv.slice(1),{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
    const out=[],err=[]; let timedOut=false; let spawnError; let killTimer;
    const kill=(signal)=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{}};
    const timer=setTimeout(()=>{timedOut=true;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),1000);},timeoutMs);
    child.stdout.on('data',b=>out.push(b)); child.stderr.on('data',b=>err.push(b));
    child.on('error',e=>{spawnError=e.message;err.push(Buffer.from(e.message));});
    child.on('close',async(code,signal)=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer); const stdout=Buffer.concat(out).toString(),stderr=Buffer.concat(err).toString(); try {if(stdoutFile) await writeFile(stdoutFile,stdout); if(stderrFile) await writeFile(stderrFile,stderr); resolve({argv,cwd,exitCode:spawnError?127:code,signal,timedOut,spawnError,startedAt:wallStarted,finishedAt:new Date().toISOString(),durationMs:performance.now()-started,stdout,stderr});} catch(e){reject(e);} });
  });
}
export function safeId(value,label='identifier') { if(!/^[a-z0-9][a-z0-9-]{2,60}$/.test(value)) throw Error('Invalid '+label+': use 3–61 lowercase letters, digits and hyphens'); return value; }
export function validateRecord(r) {
  if(r.schemaVersion!==1||!['package','deploy'].includes(r.kind)||!['passed','failed','unqualified'].includes(r.status)) throw Error('Invalid result schema/kind/status');
  for(const key of ['scenario','provider','runId','sourceCommit','startedAt','finishedAt']) if(typeof r[key]!=='string'||!r[key]) throw Error('Missing '+key);
  if(!Number.isFinite(Date.parse(r.startedAt))||!Number.isFinite(Date.parse(r.finishedAt))||Date.parse(r.finishedAt)<Date.parse(r.startedAt)) throw Error('Invalid timer timestamps');
  if(!/^[a-f0-9]{40}$/.test(r.sourceCommit)) throw Error('sourceCommit must be a full Git SHA');
  if(r.status==='passed') {
    if(!Number.isFinite(r.durationMs)||r.durationMs<0) throw Error('Invalid duration');
    if(Math.abs(Date.parse(r.finishedAt)-Date.parse(r.startedAt)-r.durationMs)>1000)throw Error('Elapsed duration differs from observed timer boundaries');
    if(!r.toolVersion||!r.environment||!r.cacheEvidence||!Array.isArray(r.evidence)||!r.evidence.length) throw Error('Passed results require versions, environment, cache evidence and source evidence');
    if(r.kind==='deploy') {
      if(r.scenario.includes('-git-')&&(r.pipelineCompletion?.verified!==true||r.pipelineCompletion.sourceCommit!==r.sourceCommit||r.pipelineCompletion.status!=='succeeded'||!r.pipelineCompletion.runId))throw Error('Git results require successful native pipeline completion for the pushed SHA');
      if(r.scenario.includes('five-services')&&(r.reuse?.verified!==true||r.reuse.observations?.length!==2||!['inventory','webhooks'].every(name=>r.reuse.observations.some(s=>s.name===name&&s.unchanged===true))))throw Error('Five-service results need verified unchanged native component identities');
      const expectedCount=r.scenario.includes('five-services')?5:Number(r.scenario.match(/lambda-(1|5|25)-/)?.[1]||1);
      const observations=r.readiness?.observations;
      if(r.readiness?.verified!==true||!Array.isArray(observations)||observations.length!==expectedCount||new Set(observations.map(o=>o.name)).size!==expectedCount||observations.some(o=>!o.expected?.revision||o.observed?.revision!==o.expected.revision)) throw Error('Deployment needs verified business/revision observations for every component');
    }
    if(r.kind==='package') {
      if(r.artifacts?.complete!==true||!Number.isSafeInteger(r.artifacts.bytes)||r.artifacts.bytes<=0||!['lambda-zip','oci-compressed','heroku-slug'].includes(r.artifacts.format))throw Error('Packaging needs complete deployable artifacts');
      if(r.artifacts.format==='oci-compressed'){const blobs=r.artifacts.blobs;if(!Array.isArray(blobs)||!blobs.length||new Set(blobs.map(b=>b.digest)).size!==blobs.length||blobs.some(b=>!/^sha256:[a-f0-9]{64}$/.test(b.digest)||!Number.isSafeInteger(b.size)||b.size<=0)||blobs.reduce((sum,b)=>sum+b.size,0)!==r.artifacts.bytes||!r.artifacts.manifestDigest)throw Error('OCI size requires a complete compressed blob manifest');}
      const expectedCount=Number(r.scenario.match(/lambda-(1|5|25)$/)?.[1]);if(expectedCount) {const functions=r.artifacts.files?.filter(f=>f.role==='function');if(r.artifacts.format!=='lambda-zip'||functions?.length!==expectedCount)throw Error('Every selected function ZIP is required');const probes=r.artifacts.businessVerification?.completeZipBusinessProbes;if(!Array.isArray(probes)||probes.length!==expectedCount||new Set(probes.map(p=>p.name)).size!==expectedCount||probes.some(p=>!p.revision))throw Error('Every complete Lambda ZIP needs a business/revision verification');}
    }
  }
  return r;
}

import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {root,json,scenarioById,safeId} from './lib.mjs';
export async function targets(scenario) {
  const manifest=await json(path.join(root,'fixtures/manifest.json'));
  if(scenario.fixture.startsWith('lambda-')) { const workload=manifest.lambda.workloads.find(w=>w.id===scenario.fixture); return manifest.lambda.functions.filter(f=>workload.changedFunctions.includes(f.name)).map(f=>f.revisionFile); }
  if(scenario.fixture==='five-services') return manifest.fiveServices.services.filter(s=>manifest.fiveServices.changedServices.includes(s.name)).map(s=>s.revisionFile);
  return [manifest.containers.find(c=>c.id==='container-'+scenario.fixture).revisionFile];
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
  try { const scenario=await scenarioById(process.argv[2]); const revision=safeId(process.argv[3],'revision');
    for(const relative of await targets(scenario)) {const file=path.join(root,relative);const source=await readFile(file,'utf8');const next=source.replace(/(['"])(?:baseline|[a-z0-9][a-z0-9-]{2,60})\1/,JSON.stringify(revision));if(next===source) throw Error('Cannot replace revision in '+relative);await writeFile(file,next);console.log(relative);}
  } catch(e){console.error(e.message);process.exitCode=1;}
}

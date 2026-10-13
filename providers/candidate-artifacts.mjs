import {readFile,readdir,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from '../scripts/lib.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function inside(project,file) {const target=await realpath(path.resolve(project,file)),relative=path.relative(project,target);if(relative==='..'||relative.startsWith('../')||path.isAbsolute(relative))throw Error('Native artifact/input path escapes the generated project');return target;}
async function zipFiles(directory) {try{return (await readdir(directory,{withFileTypes:true})).filter(e=>e.isFile()&&e.name.endsWith('.zip')).map(e=>path.join(directory,e.name));}catch(error){if(error.code==='ENOENT')return [];throw error;}}
export async function observeCandidateArtifacts({project=process.cwd(),qualifiedFile,configFile='candidate.yml',artifactRoot,attempt}) {
  project=await realpath(project);
  if(attempt.provider!=='candidate'||!/^[a-f0-9]{40}$/.test(attempt.sourceCommit||'')||!attempt.runId||!Number.isFinite(Date.parse(attempt.startedAt))||!Number.isFinite(Date.parse(attempt.commandFinishedAt)))throw Error('Bind the actual candidate package attempt and timer boundaries');
  const start=Date.parse(attempt.startedAt),finish=Date.parse(attempt.commandFinishedAt);if(finish<start)throw Error('Invalid native package interval');
  const qualification=JSON.parse(await readFile(qualifiedFile,'utf8')),spec=qualification.artifacts||qualification;
  if(spec.qualified!==true||spec.format!=='lambda-zip'||!Array.isArray(spec.files)||![1,5,25].includes(spec.functionCount))throw Error('Supply the qualified complete Lambda binding contract');
  const functions=spec.files.filter(f=>(f.role||'function')==='function'),layers=spec.files.filter(f=>f.role==='layer');
  if(functions.length!==spec.functionCount||new Set(functions.map(f=>f.name)).size!==functions.length||functions.some(f=>f.handler!=='index.handler'||f.module!=='index.js'))throw Error('Qualified native handler or selected function count differs');
  const configPath=await inside(project,configFile),configBytes=await readFile(configPath),config=JSON.parse(configBytes);
  const resources=Object.entries(config.resources||{}).filter(([,r])=>r.type==='function');
  if(resources.length!==functions.length)throw Error('Current native config has another function selection');
  const bindings=[];
  for(const f of functions) {
    const resourceName=f.resourceName||f.name.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase()),resource=config.resources[resourceName];
    const entry=resource?.properties?.packaging?.properties?.entryfilePath;
    if(!/^[A-Za-z0-9]+$/.test(resourceName)||resource?.type!=='function'||resource.properties.packaging.type!=='js-bundle'||typeof entry!=='string'||path.basename(entry,path.extname(entry))!==f.name)throw Error('Native resource key does not bind the selected original fixture source');
    const entryFile=await inside(project,entry);bindings.push({name:f.name,resourceName,entry,entrySHA256:hash(await readFile(entryFile)),handler:f.handler,module:f.module});
  }
  if(!artifactRoot) {
    const parts=functions[0].path?.replaceAll('\\','/').split('/'),marker=parts?.lastIndexOf('build');
    if(marker===undefined||marker<2||parts[marker+1]!=='lambdas')throw Error('Supply the qualified native artifactRoot or a prior native archive path');
    artifactRoot=parts.slice(0,marker-1).join('/');
  }
  artifactRoot=await inside(project,artifactRoot);
  const attempts=[];
  for(const directory of await readdir(artifactRoot,{withFileTypes:true})) {
    if(!directory.isDirectory())continue;
    const invocation=path.join(artifactRoot,directory.name),functionZips=await zipFiles(path.join(invocation,'build/lambdas')),layerZips=await zipFiles(path.join(invocation,'build/layers'));
    const all=[...functionZips,...layerZips],fresh=[];
    for(const file of all){const info=await stat(file);if(info.mtimeMs+1>=start&&info.mtimeMs<=finish+1)fresh.push(file);}
    if(fresh.length)attempts.push({invocation,functionZips,layerZips,fresh});
  }
  if(attempts.length!==1)throw Error('Require exactly one native invocation with archives written during this package attempt');
  const current=attempts[0];if(current.fresh.length!==current.functionZips.length+current.layerZips.length)throw Error('A current native invocation contains stale archives');
  if(current.functionZips.length!==functions.length||current.layerZips.length!==layers.length)throw Error('Current native archive count differs from the qualified function/layer contract');
  const files=[];
  async function capture(file,binding) {const target=await inside(project,file),bytes=await readFile(target),info=await stat(target);if(!bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))throw Error('Native archive is not an actual ZIP');files.push({...binding,path:path.relative(project,target),bytes:bytes.length,sha256:hash(bytes),mtimeMs:info.mtimeMs});}
  for(const f of bindings){const matches=current.functionZips.filter(file=>new RegExp('^'+f.resourceName+'-[a-f0-9]{40,64}\\.zip$').test(path.basename(file)));if(matches.length!==1)throw Error('Missing or ambiguous current native function ZIP');await capture(matches[0],{name:f.name,resourceName:f.resourceName,role:'function',handler:f.handler,module:f.module});}
  for(const layer of layers){if(!/^layer-\d+$/.test(layer.name||''))throw Error('Bind each native layer by its stable native layer name');const matches=current.layerZips.filter(file=>path.basename(file)===layer.name+'.zip');if(matches.length!==1)throw Error('Missing or ambiguous required native layer ZIP');await capture(matches[0],{name:layer.name,role:'layer'});}
  return {schemaVersion:1,...attempt,functionCount:functions.length,config:{path:path.relative(project,configPath),sha256:hash(configBytes)},inputs:bindings.map(({name,resourceName,entry,entrySHA256})=>({name,resourceName,entry,entrySHA256})),invocation:path.relative(project,current.invocation),files};
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
  try {const {flags}=parseArgs(process.argv.slice(2));if(!flags.qualified)throw Error('Supply --qualified FILE with the native artifact binding contract');const result=await observeCandidateArtifacts({project:flags.project||process.cwd(),qualifiedFile:path.resolve(flags.qualified),configFile:flags.config||'candidate.yml',artifactRoot:flags['artifact-root'],attempt:{provider:process.env.BENCH_PROVIDER,runId:process.env.BENCH_RUN_ID,sourceCommit:process.env.BENCH_SOURCE_COMMIT,startedAt:process.env.BENCH_STARTED_AT,commandFinishedAt:process.env.BENCH_COMMAND_FINISHED_AT}});console.log(JSON.stringify(result,null,2));}catch(error){console.error(error.message);process.exitCode=1;}
}

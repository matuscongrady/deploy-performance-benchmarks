import {readFile,mkdtemp,rm,mkdir,symlink,realpath} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const [manifestFile,fixtureFile,fixtureId,projectArg=process.cwd(),sourceRootArg='app']=process.argv.slice(2);
if(!manifestFile||!fixtureFile||!/^lambda-(1|5|25)$/.test(fixtureId||''))throw Error('Usage: node check-lambda-zips.mjs ARTIFACT_BINDINGS FIXTURE_MANIFEST lambda-1|lambda-5|lambda-25 [PROJECT_DIR] [SOURCE_ROOT]');
const project=await realpath(projectArg),spec=JSON.parse(await readFile(resolve(project,manifestFile),'utf8'));
const manifest=JSON.parse(await readFile(resolve(fixtureFile),'utf8'));
const workload=manifest.lambda.workloads.find(w=>w.id===fixtureId);
if(!workload)throw Error('Unknown fixture workload');
const entries=Array.isArray(spec.artifacts)?spec.artifacts:spec.files || spec.artifacts?.files;
if(!Array.isArray(entries)||!entries.length)throw Error('Complete qualified artifact bindings are required');
const functions=entries.filter(a=>(a.role||'function')==='function');
const layers=entries.filter(a=>a.role==='layer');
assert.deepEqual(functions.map(a=>a.name).sort(),[...workload.functions].sort(),'Every selected function requires exactly one ZIP binding');
for(const a of functions)if(!/^[\w./-]+\.[\w$]+$/.test(a.handler||'') || !/^[\w./-]+\.(mjs|cjs|js)$/.test(a.module||''))throw Error('Every function binding requires the actual runtime handler and module filename');
const temporary=await mkdtemp(join(tmpdir(),'lambda-zip-probe-'));
const tested=[];
try{
 const opt=join(temporary,'opt');await mkdir(opt,{recursive:true});
 for(const a of layers)unzip(await contained(a.path),opt);
 for(const a of functions){
  const f=manifest.lambda.functions.find(f=>f.name===a.name);
  const dir=join(temporary,a.name);await mkdir(dir);
  unzip(await contained(a.path),dir);
  // Emulate the standard Node layer module lookup without modifying /opt on the host.
  const layerModules=join(opt,'nodejs/node_modules');
  try{await realpath(layerModules);try{await symlink(layerModules,join(dir,'node_modules'),'dir');}catch(e){if(e.code!=='EEXIST')throw e;}}catch(e){if(e.code!=='ENOENT')throw e;}
  const revisionModule=await import(pathToFileURL(join(project,spec.sourceRoot||'app','handlers',a.name+'.revision.mjs')).href);
  if(typeof revisionModule.revision!=='string')throw Error('Source revision is missing');
  const exportName=a.handler.slice(a.handler.lastIndexOf('.')+1);
  // Run each ZIP in a clean Node process so imports, cwd and caches are isolated.
  const code=`const {pathToFileURL}=await import('node:url');const m=await import(pathToFileURL(process.argv[1]).href);const r=await m[process.argv[2]](JSON.parse(process.argv[3]));console.log(JSON.stringify(r));`;
  const run=spawnSync(process.env.BENCH_NODE || process.execPath,['--input-type=module','-e',code,join(dir,a.module),exportName,JSON.stringify(f.probe.input)],{cwd:dir,env:{...process.env,BENCH_ZIP_RUNTIME_ROOT:temporary,NODE_PATH:layerModules,LAMBDA_TASK_ROOT:dir},encoding:'utf8',maxBuffer:8*1024*1024});
  if(run.status!==0)throw Error(`Packaged handler ${a.name} failed: ${run.stderr.slice(-2000)}`);
  let response;try{response=JSON.parse(run.stdout.trim().split('\n').at(-1));}catch{throw Error('Packaged handler returned no parseable JSON response');}
  subset(response,f.probe.expected);assert.equal(response.revision,revisionModule.revision,'Packaged revision differs from the current source: '+a.name);
  tested.push({name:a.name,revision:response.revision});
 }
 console.log(JSON.stringify({fixture:fixtureId,completeZipBusinessProbes:tested,cloudRequests:false,nodeExecutable:process.env.BENCH_NODE||process.execPath}));
}finally{await rm(temporary,{recursive:true,force:true});}
async function contained(p){const file=await realpath(resolve(project,p));const rel=relative(project,file);if(isAbsolute(rel)||rel==='..'||rel.startsWith('../'))throw Error('Artifact path must remain inside the native project');return file;}
function unzip(zip,dir){
 const py=`import zipfile,sys,pathlib\nroot=pathlib.Path(sys.argv[2]).resolve()\nwith zipfile.ZipFile(sys.argv[1]) as z:\n for info in z.infolist():\n  p=(root/info.filename).resolve()\n  if not p.is_relative_to(root): raise ValueError('ZIP entry escapes extraction root')\n z.extractall(root)\n`;
 const p=spawnSync('python3',['-c',py,zip,dir],{encoding:'utf8'});if(p.status!==0)throw Error('Cannot unpack actual function/layer ZIP: '+p.stderr.slice(-1000));
}
function subset(actual,expected){
 if(Array.isArray(expected)){assert.ok(Array.isArray(actual));assert.equal(actual.length,expected.length);expected.forEach((v,i)=>subset(actual[i],v));}
 else if(expected&&typeof expected==='object'){assert.ok(actual&&typeof actual==='object');for(const [k,v]of Object.entries(expected))subset(actual[k],v);}
 else assert.deepEqual(actual,expected);
}

import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

export const buildTimingDefaults=Object.freeze({
 serverless:{configurationFiles:['serverless.yml','.benchmark-instrumentation/build-timing.mjs','.benchmark-instrumentation/serverless-build-stage.cjs'],instrumentationFiles:['providers/build-timing.mjs','providers/serverless-build-stage.cjs'],nativeMethodSha256:Object.freeze({_build:'eecb88710ffe243f86e27de2244fc667fe218dfe617fbf2c83478fa36bd1b388',_preparePackageJson:'97d633336cea57949480f87cf33254270b3ae61de6c85c4d41857513fb4a3ca9',_package:'39bd6800a595c8204dd4f47bd9d98c174e646ad666b0e6aa73b754fc2a6ea1cd',_writeArchive:'5c4e528eeb23f3faa90a9fa25f5d3ac2adc8c129227ea9077c9726cfa8ed541e'})},
 sst:{configurationFiles:['sst.config.ts','sst-build-inputs.json'],instrumentationFiles:['providers/build-timing.mjs','providers/package-sst.mjs','providers/sst-native-main.go','providers/install-sst-bridge.mjs']},
 cdk:{configurationFiles:['cdk.json','cdk-app.mjs'],instrumentationFiles:['providers/build-timing.mjs','providers/package-cdk.mjs']}
});
export const buildClock='linux-clock-monotonic-nanoseconds';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const identityFields=['provider','runId','sourceCommit','appId','fixture'];
const envNames={provider:'BENCH_PROVIDER',runId:'BENCH_RUN_ID',sourceCommit:'BENCH_SOURCE_COMMIT',appId:'BENCH_APP_ID',fixture:'BENCH_FIXTURE'};
export function monotonicNs(){if(process.platform!=='linux')throw Error('Qualified build clocks require Linux CLOCK_MONOTONIC');return process.hrtime.bigint().toString();}
function ns(value){if(typeof value!=='string'||!/^[1-9][0-9]*$/.test(value))throw Error('Native marker needs positive monotonic nanoseconds');return BigInt(value);}
async function contained(root,relative){if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe build input/output path');const target=await realpath(path.resolve(root,relative));const rel=path.relative(root,target);if(rel==='..'||rel.startsWith('../')||path.isAbsolute(rel))throw Error('Build input/output escapes its root');return target;}
export async function createBuildTiming(provider,{cwd=process.cwd(),env=process.env}={}) {
 const file=env.BENCH_BUILD_TIMING_FILE;
 if(!file)return {enabled:false,start(){},finish(){},async commit(){},async readStart(){}};
 if(process.platform!=='linux'||!buildTimingDefaults[provider])throw Error('Unsupported native build timing provider/clock');
 if(!path.isAbsolute(file)||!path.isAbsolute(env.BENCH_BUILD_INPUT_MANIFEST||''))throw Error('Build timing needs absolute unique proof/input paths');
 const raw=await readFile(env.BENCH_BUILD_INPUT_MANIFEST);const inputManifestSha256=digest(raw);
 if(inputManifestSha256!==env.BENCH_BUILD_INPUT_MANIFEST_SHA256)throw Error('Build input manifest checksum differs');
 const input=JSON.parse(raw),identity=Object.fromEntries(identityFields.map(key=>[key,env[envNames[key]]]));
 if(input.schemaVersion!==1||input.scope!=='native-build-and-archive'||identity.provider!==provider||!/^[a-f0-9]{40}$/.test(identity.sourceCommit||'')||!identity.runId||!identity.appId||!/^lambda-(1|5|25)$/.test(identity.fixture||''))throw Error('Current native build identity is missing or invalid');
 for(const key of identityFields)if(input[key]!==identity[key])throw Error('Build input manifest differs from current '+key);
 const project=await realpath(cwd);
 if(input.roots?.project!==project||!path.isAbsolute(input.roots?.repository||'')||await realpath(input.roots.repository)!==input.roots.repository)throw Error('Build input manifest roots differ from current native project');
 if(!Array.isArray(input.files)||!input.files.length)throw Error('Build input manifest files are missing');
 const ordering=input.files.map(f=>`${f.base}/${f.path}`),seen=new Set();
 if(JSON.stringify(ordering)!==JSON.stringify([...ordering].sort()))throw Error('Build input descriptors are not in canonical order');
 for(const descriptor of input.files){
  if(!['project','repository'].includes(descriptor.base)||!['configuration','source','lock','instrumentation'].includes(descriptor.role)||seen.has(`${descriptor.base}/${descriptor.path}`))throw Error('Invalid or repeated build input descriptor');
  seen.add(`${descriptor.base}/${descriptor.path}`);
  const target=await contained(input.roots[descriptor.base],descriptor.path),bytes=await readFile(target);
  if(descriptor.bytes!==bytes.length||descriptor.sha256!==digest(bytes))throw Error('Native build input differs from the declared source/configuration');
 }
 const config=input.files.filter(f=>f.role==='configuration');
 if(config.some(f=>f.base!=='project')||JSON.stringify(config.map(f=>f.path).sort())!==JSON.stringify([...buildTimingDefaults[provider].configurationFiles].sort()))throw Error('Native configuration input selection differs');
 const configurationSha256=digest(JSON.stringify(config));
 if(configurationSha256!==input.configurationSha256||configurationSha256!==env.BENCH_BUILD_CONFIG_SHA256)throw Error('Native configuration checksum differs');
 for(const file of buildTimingDefaults[provider].instrumentationFiles)if(!input.files.some(f=>f.base==='repository'&&f.path===file&&f.role==='instrumentation'))throw Error('Native instrumentation source is not bound');
 if(provider==='serverless'){
  for(const name of ['build-timing.mjs','serverless-build-stage.cjs']){const copied=input.files.find(f=>f.base==='project'&&f.path==='.benchmark-instrumentation/'+name&&f.role==='configuration'),source=input.files.find(f=>f.base==='repository'&&f.path==='providers/'+name&&f.role==='instrumentation');if(!copied||!source||copied.sha256!==source.sha256||copied.bytes!==source.bytes)throw Error('Actual Serverless observer copy differs from its reviewed source');}
  const methods=input.nativeMethodSha256,keys=['_build','_package','_preparePackageJson','_writeArchive'];if(!methods||JSON.stringify(Object.keys(methods).sort())!==JSON.stringify(keys)||Object.values(methods).some(v=>! /^[a-f0-9]{64}$/.test(v||'')))throw Error('Serverless needs qualified native lifecycle method fingerprints');
 }
 if(!input.files.some(f=>f.role==='source')||!input.files.some(f=>f.role==='lock'))throw Error('Native build needs bound source and dependency locks');
 const markers=[];let committed=false;
 const base={schemaVersion:1,scope:'native-build-and-archive',...identity,clock:buildClock,configurationSha256,inputManifestSha256};
 function start(value=monotonicNs()){if(markers.length||ns(value)>ns(monotonicNs()))throw Error('Missing/duplicate or future native build start');markers.push({name:'build:start',monotonicNs:value});}
 function finish(value=monotonicNs()){if(markers.length!==1||ns(value)<=ns(markers[0].monotonicNs)||ns(value)>ns(monotonicNs()))throw Error('Missing/duplicate/reversed native artifact readiness');markers.push({name:'artifacts:ready',monotonicNs:value});}
 return {enabled:true,file,base,start,finish,expectedNativeMethodSha256:input.nativeMethodSha256,async readStart(){const startProof=JSON.parse(await readFile(file+'.start.json','utf8'));for(const [key,value]of Object.entries(base))if(startProof[key]!==value)throw Error('Child native build marker identity differs');start(startProof.monotonicNs);},async commit(bindings,details={}){
  if(committed||markers.length!==2)throw Error('Native build needs exactly one start and readiness marker');
  if(!Array.isArray(bindings)||!bindings.length)throw Error('Complete native output bindings are missing');
  const files=[],paths=new Set(),functions=new Set(),layers=new Set();
  for(const binding of bindings){
   const role=binding.role||'function';if(!['function','layer','source-map'].includes(role)||typeof binding.name!=='string'||!binding.name)throw Error('Invalid native output role/name');
   const relative=path.isAbsolute(binding.path)?path.relative(project,binding.path):binding.path,target=await contained(project,relative),bytes=await readFile(target),sha256=digest(bytes);
   if(paths.has(target)||binding.bytes!==undefined&&binding.bytes!==bytes.length||binding.sha256&&binding.sha256!==sha256)throw Error('Native output counted twice or differs from its captured bytes');paths.add(target);
   if(role==='source-map'){const map=JSON.parse(bytes);if(map.version!==3||!Array.isArray(map.sources))throw Error('Native source map is not version 3 JSON');}
   else if(!bytes.subarray(0,4).equals(Buffer.from([80,75,3,4])))throw Error('Native output is not a final ZIP');
   if(role==='function'){if(functions.has(binding.name))throw Error('Native function output repeated');functions.add(binding.name);}
   if(role==='layer'){if(layers.has(sha256))throw Error('Native layer output counted twice');layers.add(sha256);}
   const entry={name:binding.name,role,path:relative,bytes:bytes.length,sha256,...role==='source-map'&&{uploadedSeparately:true}};
   if(binding.nativeOutputPath){const nativeRelative=path.isAbsolute(binding.nativeOutputPath)?path.relative(project,binding.nativeOutputPath):binding.nativeOutputPath,native=await contained(project,nativeRelative);if(digest(await readFile(native))!==sha256)throw Error('Observer copy differs from native completed ZIP');entry.nativeOutputPath=nativeRelative;}
   files.push(entry);
  }
  if(functions.size!==Number(identity.fixture.slice(7))||files.some(f=>f.role==='source-map'&&!functions.has(f.name)))throw Error('Native artifact readiness did not cover every selected function');
  const proof={...base,startNs:markers[0].monotonicNs,endNs:markers[1].monotonicNs,outcome:'ok',markers,files,details};
  await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(proof,null,2)+'\n',{flag:'wx'});committed=true;return proof;
 }};
}
// Called in the native CDK child immediately before the first NodejsFunction.
export async function writeBuildStart(provider){const stage=await createBuildTiming(provider);if(!stage.enabled)return;const monotonicNs=process.hrtime.bigint().toString();await mkdir(path.dirname(stage.file),{recursive:true});await writeFile(stage.file+'.start.json',JSON.stringify({...stage.base,monotonicNs})+'\n',{flag:'wx'});}

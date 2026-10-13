import { createRequire } from 'node:module';
import { readdir, readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {createBuildTiming,monotonicNs} from './build-timing.mjs';
const [toolRoot]=process.argv.slice(2);
if(!toolRoot)throw new Error('Usage: node providers/package-cdk.mjs TOOL_ROOT');
const stage=await createBuildTiming('cdk');
const synth=spawnSync(process.execPath,['cdk-app.mjs'],{cwd:process.cwd(),env:{...process.env,CDK_OUTDIR:join(process.cwd(),'cdk.out'),BENCH_BUILD_STAGE_HELPER:new URL('./build-timing.mjs',import.meta.url).href},stdio:'inherit'});
if(synth.status!==0)throw new Error('Native CDK application synthesis failed');
await stage.readStart();
const require=createRequire(join(resolve(toolRoot),'package.json'));
const {AssetManifest}=require('@aws-cdk/cdk-assets-lib');
const {FileAssetHandler}=require(join(dirname(require.resolve('@aws-cdk/cdk-assets-lib')),'private/handlers/files.js'));
const out=resolve('cdk.out');
const capture=resolve('package-artifacts');await mkdir(capture,{recursive:true});
const templates=await Promise.all((await readdir(out)).filter(n=>n.endsWith('.template.json')).map(async n=>JSON.parse(await readFile(join(out,n),'utf8'))));
const plan=JSON.parse(await readFile('provider-plan.json','utf8'));
const selected=plan.readiness.functions;
if(!Array.isArray(selected)||!selected.length)throw Error('Native function bindings are missing');
const usage=new Map();
for(const template of templates)for(const [name,resource]of Object.entries(template.Resources || {})){
 if(!['AWS::Lambda::Function','AWS::Lambda::LayerVersion'].includes(resource.Type))continue;
 const selectedFunction=selected.find(f=>f.functionName===resource.Properties?.FunctionName);
 if(resource.Type==='AWS::Lambda::Function' && !selectedFunction)continue;
 const code=resource.Type==='AWS::Lambda::Function' ? resource.Properties?.Code : resource.Properties?.Content;
 const key=code?.S3Key;
 const assetId=typeof key==='string' && /^[a-f0-9]{64}\.zip$/.test(key) ? key.slice(0,-4) : null;
 if(!assetId)throw new Error('Selected Lambda resource has no recognized native file asset');
 const consumers=usage.get(assetId) || [];
 consumers.push({name:selectedFunction?.name,logicalId:name,functionName:resource.Properties?.FunctionName,kind:resource.Type==='AWS::Lambda::Function'?'function':'layer'});
 usage.set(assetId,consumers);
}
const artifacts=[];const seen=new Set();const jobs=[];const readyTimes=[];
const host={aws:new Proxy({}, {get(){throw new Error('AWS access is forbidden in the packaging-only adapter');}}),emitMessage(){},aborted:false};
for(const name of(await readdir(out)).filter(n=>n.endsWith('.assets.json'))){
 const manifest=AssetManifest.fromFile(join(out,name));
 for(const asset of manifest.files){
  if(seen.has(asset.id.assetId) || !usage.has(asset.id.assetId))continue;
  if(asset.source.executable)throw new Error('External file asset executable is outside the selected packaging recipe');
  seen.add(asset.id.assetId);
  jobs.push(async()=>{
  const handler=new FileAssetHandler(manifest.directory,asset,host);
  if(typeof handler.packageFile!=='function')throw new Error('Pinned CDK native archive API changed');
  const built=await handler.packageFile(asset.source);
  if(stage.enabled)readyTimes.push(monotonicNs());
  const consumers=usage.get(asset.id.assetId);
  if(consumers.length!==1)throw Error('Selected recipe unexpectedly shares a code asset; qualify its distinct consumer binding before proceeding');
  const consumer=consumers[0];
  const target=join(capture,(consumer.name||asset.id.assetId)+'.zip');await copyFile(built.packagedPath,target);
  const bytes=await readFile(target);
  artifacts.push({name:consumer.name,role:consumer.kind,handler:consumer.kind==='function'?'index.handler':undefined,module:consumer.kind==='function'?'index.js':undefined,runtime:'nodejs22.x',consumers,path:target,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),assetId:asset.id.assetId,...stage.enabled&&{nativeOutputPath:built.packagedPath}});
  });
 }
}
// The pinned CDK CLI uses eight asset-publish jobs; file zipping happens inside that phase.
let next=0;await Promise.all(Array.from({length:Math.min(8,jobs.length)},async()=>{while(next<jobs.length)await jobs[next++]();}));
artifacts.sort((a,b)=>selected.findIndex(f=>f.name===a.name)-selected.findIndex(f=>f.name===b.name));
if(artifacts.length!==usage.size || !artifacts.length)throw new Error('Native ZIP capture did not cover all application function/layer assets');
if(stage.enabled){stage.finish(readyTimes.reduce((a,b)=>BigInt(a)>BigInt(b)?a:b));await stage.commit(artifacts,{startBoundary:'immediately before first native NodejsFunction construction',endBoundary:'last native FileAssetHandler.packageFile completion',nativeArchiveMethodSha256:createHash('sha256').update(FileAssetHandler.prototype.packageFile.toString()).digest('hex')});}
await writeFile(join(capture,'manifest.json'),JSON.stringify({provider:'cdk',sourceRoot:plan.readiness.sourceRoot||'app',method:'native application synthesis plus pinned native FileAssetHandler.packageFile; no publish',qualificationRequired:true,archiveConcurrency:8,artifacts,totalCompressedBytes:artifacts.reduce((n,a)=>n+a.bytes,0)},null,2)+'\n');
console.log(JSON.stringify({artifacts:artifacts.length,totalCompressedBytes:artifacts.reduce((n,a)=>n+a.bytes,0)}));

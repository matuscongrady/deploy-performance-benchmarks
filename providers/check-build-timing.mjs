import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {buildTimingDefaults,createBuildTiming,monotonicNs} from './build-timing.mjs';
const repository=path.resolve(new URL('..',import.meta.url).pathname),root=await mkdtemp(path.join(os.tmpdir(),'native-build-clock-')),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
let id=0;
async function environment(provider){
 const project=path.join(root,'project-'+(++id));await mkdir(project,{recursive:true});await mkdir(path.join(project,'app'));
 for(const file of buildTimingDefaults[provider].configurationFiles){await mkdir(path.dirname(path.join(project,file)),{recursive:true});await writeFile(path.join(project,file),file.startsWith('.benchmark-instrumentation/')?await readFile(path.join(repository,'providers',path.basename(file))):'native config '+file);}
 await writeFile(path.join(project,'app/report.mjs'),'export function handler(){return {revision:"current"}}');await writeFile(path.join(project,'app/package-lock.json'),'{}');
 const files=[];for(const [base,paths,role]of [['project',buildTimingDefaults[provider].configurationFiles,'configuration'],['project',['app/report.mjs'],'source'],['project',['app/package-lock.json'],'lock'],['repository',buildTimingDefaults[provider].instrumentationFiles,'instrumentation']])for(const file of paths){const bytes=await readFile(path.join(base==='project'?project:repository,file));files.push({base,path:file,role,bytes:bytes.length,sha256:hash(bytes)});}
 files.sort((a,b)=>`${a.base}/${a.path}`<`${b.base}/${b.path}`?-1:1);const configurationSha256=hash(JSON.stringify(files.filter(f=>f.role==='configuration')));
 const identity={provider,runId:'native-'+id,sourceCommit:'a'.repeat(40),appId:'commerce-report',fixture:'lambda-1'},manifest={schemaVersion:1,scope:'native-build-and-archive',...identity,roots:{project,repository},configurationSha256,...provider==='serverless'&&{nativeMethodSha256:buildTimingDefaults.serverless.nativeMethodSha256},files},input=path.join(root,'input-'+id+'.json');await writeFile(input,JSON.stringify(manifest));
 const env={BENCH_BUILD_TIMING_FILE:path.join(root,'evidence-'+id+'.json'),BENCH_BUILD_INPUT_MANIFEST:input,BENCH_BUILD_INPUT_MANIFEST_SHA256:hash(await readFile(input)),BENCH_BUILD_CONFIG_SHA256:configurationSha256,BENCH_PROVIDER:provider,BENCH_RUN_ID:identity.runId,BENCH_SOURCE_COMMIT:identity.sourceCommit,BENCH_APP_ID:identity.appId,BENCH_FIXTURE:identity.fixture};return {project,env,manifest};
}
async function zip(project){const file=path.join(project,'report.zip');const made=spawnSync('python3',['-c','import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("index.js","exports.handler=()=>({revision: \'current\'})"); z.close()',file],{encoding:'utf8'});assert.equal(made.status,0,made.stderr);return {name:'report',role:'function',path:'report.zip'};}
async function deferredObserverRegression(){
 const syncFs=await import('node:fs');
 const preload=path.join(root,'observe-file-io.mjs');
 await writeFile(preload,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
 const record=(name,file)=>fs.appendFileSync(process.env.EVENT_LOG,JSON.stringify({name,file:String(file),ns:process.hrtime.bigint().toString()})+'\\n');
 for(const method of ['copyFile','readFile']){const original=fs.promises[method];fs.promises[method]=async function(...args){const file=String(args[method==='copyFile'?1:0]);if(file.endsWith('.zip')&&file.includes('package-artifacts')||file.endsWith('.native-map.json')){record('observer:'+method,file);await new Promise(r=>setTimeout(r,3));}return original.apply(this,args);};}syncBuiltinESMExports();`);
 async function refresh(context){
  context.manifest.fixture='lambda-25';context.env.BENCH_FIXTURE='lambda-25';
  for(const d of context.manifest.files){const bytes=await readFile(path.join(d.base==='project'?context.project:repository,d.path));d.bytes=bytes.length;d.sha256=hash(bytes);}
  context.manifest.configurationSha256=hash(JSON.stringify(context.manifest.files.filter(d=>d.role==='configuration')));context.env.BENCH_BUILD_CONFIG_SHA256=context.manifest.configurationSha256;
  await writeFile(context.env.BENCH_BUILD_INPUT_MANIFEST,JSON.stringify(context.manifest));context.env.BENCH_BUILD_INPUT_MANIFEST_SHA256=hash(await readFile(context.env.BENCH_BUILD_INPUT_MANIFEST));
 }
 async function spawnAdapter(provider,context,arg,eventLog){
  await refresh(context);
  const env={...process.env,...context.env,EVENT_LOG:eventLog};delete env.NODE_OPTIONS;
  const native=spawnSync(process.execPath,['--import',preload,path.join(repository,'providers','package-'+provider+'.mjs'),arg],{cwd:context.project,env,encoding:'utf8',timeout:30000});
  assert.equal(native.status,0,native.stderr+'\n'+native.stdout);
  const events=(await readFile(eventLog,'utf8')).trim().split('\n').map(JSON.parse),done=events.filter(e=>e.name==='native:done'),observer=events.filter(e=>e.name.startsWith('observer:'));
  assert.equal(done.length,25);assert.ok(observer.length>=25);
  const firstObserver=events.findIndex(e=>e.name.startsWith('observer:'));
  assert.equal(events.slice(0,firstObserver).filter(e=>e.name==='native:done').length,25,'Every native archive must finish before observer I/O starts');
  const proof=JSON.parse(await readFile(context.env.BENCH_BUILD_TIMING_FILE));assert.equal(proof.files.filter(f=>f.role==='function').length,25);
  assert.ok(BigInt(proof.endNs)>=BigInt(done.at(-1).ns)&&BigInt(proof.endNs)<BigInt(observer[0].ns),'Readiness uses the native completion clock before deferred observation');
  const manifest=JSON.parse(await readFile(path.join(context.project,'package-artifacts/manifest.json')));
  for(const binding of manifest.artifacts){assert.equal(binding.sha256,hash(await readFile(binding.path)));if(binding.role==='function')assert.equal((await readFile(binding.path)).toString('hex'),Buffer.concat([Buffer.from([80,75,3,4]),Buffer.from(binding.name)]).toString('hex'));}
  return events;
 }
 const cdk=await environment('cdk'),tool=path.join(root,'fake-cdk'),assetsLib=path.join(tool,'node_modules/@aws-cdk/cdk-assets-lib');await mkdir(path.join(assetsLib,'private/handlers'),{recursive:true});await writeFile(path.join(tool,'package.json'),'{}');await writeFile(path.join(assetsLib,'package.json'),JSON.stringify({main:'index.cjs'}));
 await writeFile(path.join(assetsLib,'index.cjs'),`const fs=require('node:fs'),path=require('node:path');exports.AssetManifest={fromFile(file){return {directory:path.dirname(file),files:JSON.parse(fs.readFileSync(file)).files}}};`);
 await writeFile(path.join(assetsLib,'private/handlers/files.js'),`const fs=require('node:fs'),path=require('node:path');exports.FileAssetHandler=class{constructor(directory,asset){this.directory=directory;this.asset=asset;}async packageFile(){const name=this.asset.source.name;fs.appendFileSync(process.env.EVENT_LOG,JSON.stringify({name:'native:start',ns:process.hrtime.bigint().toString()})+'\\n');await new Promise(r=>setTimeout(r,4+Number(name.split('-')[1])%5));const packagedPath=path.join(this.directory,name+'.zip');await fs.promises.writeFile(packagedPath,Buffer.concat([Buffer.from([80,75,3,4]),Buffer.from(name)]));fs.appendFileSync(process.env.EVENT_LOG,JSON.stringify({name:'native:done',ns:process.hrtime.bigint().toString()})+'\\n');return {packagedPath};}};`);
 await writeFile(path.join(cdk.project,'cdk-app.mjs'),`import {mkdir,writeFile} from 'node:fs/promises';import path from 'node:path';const {writeBuildStart}=await import(process.env.BENCH_BUILD_STAGE_HELPER);await writeBuildStart('cdk');const out=process.env.CDK_OUTDIR;await mkdir(out,{recursive:true});const Resources={},files=[];for(let i=0;i<25;i++){const assetId=i.toString(16).padStart(64,'0');Resources['Function'+i]={Type:'AWS::Lambda::Function',Properties:{FunctionName:'native-'+i,Code:{S3Key:assetId+'.zip'}}};files.push({id:{assetId},source:{name:'function-'+i}});}await writeFile(path.join(out,'app.template.json'),JSON.stringify({Resources}));await writeFile(path.join(out,'app.assets.json'),JSON.stringify({files}));`);
 await writeFile(path.join(cdk.project,'provider-plan.json'),JSON.stringify({readiness:{sourceRoot:'app',functions:Array.from({length:25},(_,i)=>({name:'function-'+i,functionName:'native-'+i}))}}));
 const cdkEvents=await spawnAdapter('cdk',cdk,tool,path.join(root,'cdk-observer-events.jsonl'));
 let active=0,maxActive=0;for(const e of cdkEvents){if(e.name==='native:start')maxActive=Math.max(maxActive,++active);if(e.name==='native:done')active--;assert.ok(active>=0&&active<=8);}assert.equal(maxActive,8);assert.equal(active,0);
 const sst=await environment('sst'),fakeRepo=path.join(root,'fake-sst-repo'),cache=path.join(fakeRepo,'.work/sst-native');await mkdir(path.join(cache,'source'),{recursive:true});await mkdir(path.join(fakeRepo,'providers/tools/sst/node_modules'),{recursive:true});await writeFile(path.join(fakeRepo,'providers/tools/sst/package.json'),'{}');
 for(const name of ['archiver','glob']){const dir=path.join(fakeRepo,'providers/tools/sst/node_modules',name);await mkdir(dir);await writeFile(path.join(dir,'package.json'),'{}');await writeFile(path.join(dir,'index.js'),'module.exports={}');}
 const helper=await readFile(path.join(repository,'providers/sst-native-main.go'));await writeFile(path.join(fakeRepo,'providers/sst-native-main.go'),helper);
 const binary=path.join(cache,'source/native-package');await writeFile(binary,`#!${process.execPath}\nconst fs=require('node:fs'),path=require('node:path');let text='';process.stdin.on('data',b=>text+=b);process.stdin.on('end',async()=>{const inputs=JSON.parse(text);console.log(JSON.stringify({event:'build-stage-start',clock:'linux-clock-monotonic-nanoseconds',monotonicNs:process.hrtime.bigint().toString()}));for(let index=0;index<inputs.length;index++){const map=path.resolve(inputs[index].functionID+'.native-map.json');fs.writeFileSync(map,JSON.stringify({version:3,sources:['source.js']}));console.log(JSON.stringify({index,output:{out:inputs[index].functionID,handler:'index.handler',sourcemaps:[map]}}));await new Promise(r=>setTimeout(r,1));}});`);syncFs.chmodSync(binary,0o755);
 const body=`fs.appendFileSync(process.env.EVENT_LOG,JSON.stringify({name:'native:start',ns:process.hrtime.bigint().toString()})+'\\n');await new Promise(r=>setTimeout(r,4+Number(bundle.split('-')[1])%5));await fs.promises.writeFile(zipPath,Buffer.concat([Buffer.from([80,75,3,4]),Buffer.from(bundle)]));fs.appendFileSync(process.env.EVENT_LOG,JSON.stringify({name:'native:done',ns:process.hrtime.bigint().toString()})+'\\n');`;
 await writeFile(path.join(cache,'archive-body.js'),body);await writeFile(path.join(cache,'bridge.json'),JSON.stringify({archiveBodySha:hash(body),binarySha:hash(await readFile(binary)),helperSha:hash(helper)}));
 await writeFile(path.join(sst.project,'sst-build-inputs.json'),JSON.stringify(Array.from({length:25},(_,i)=>({functionID:'function-'+i,handler:'app/handlers/function-'+i+'.mjs'}))));
 sst.env.SST_PACKAGE_ENCRYPTION_KEY=Buffer.alloc(32).toString('base64');
 const sstEvents=await spawnAdapter('sst',sst,fakeRepo,path.join(root,'sst-observer-events.jsonl'));assert.ok(sstEvents.some(e=>e.name==='observer:readFile'&&e.file.endsWith('.native-map.json')));
 const sstProof=JSON.parse(await readFile(sst.env.BENCH_BUILD_TIMING_FILE));assert.equal(sstProof.files.filter(f=>f.role==='source-map').length,25);
 console.log('Spawned 25-job CDK/SST adapters defer all observer copy/read/hash work until native readiness; CDK retains eight workers and native bytes/maps are unchanged. No cloud requests.');
}

try{
 await deferredObserverRegression();
 const context=await environment('cdk'),stage=await createBuildTiming('cdk',{cwd:context.project,env:context.env});
 const before=monotonicNs(),child=spawnSync(process.execPath,['--input-type=module','-e',`const {writeBuildStart}=await import(${JSON.stringify(new URL('./build-timing.mjs',import.meta.url).href)});await writeBuildStart('cdk');`],{cwd:context.project,env:{...process.env,...context.env},encoding:'utf8'});assert.equal(child.status,0,child.stderr);const after=monotonicNs();await stage.readStart();const binding=await zip(context.project);stage.finish();const proof=await stage.commit([binding]);assert.ok(BigInt(proof.startNs)>=BigInt(before)&&BigInt(proof.startNs)<=BigInt(after));assert.equal(proof.markers.length,2);assert.equal(proof.files[0].sha256,hash(await readFile(path.join(context.project,'report.zip'))));await assert.rejects(stage.commit([binding]),/exactly one/);
 const omitted=await environment('cdk'),missing=await createBuildTiming('cdk',{cwd:omitted.project,env:omitted.env});await assert.rejects(missing.readStart(),{code:'ENOENT'});assert.throws(()=>missing.finish(),/Missing/);await assert.rejects(missing.commit([await zip(omitted.project)]),/exactly one/);
 const reversed=await environment('cdk'),order=await createBuildTiming('cdk',{cwd:reversed.project,env:reversed.env});const start=monotonicNs();order.start(start);assert.throws(()=>order.start(),/duplicate/);assert.throws(()=>order.finish((BigInt(start)-1n).toString()),/reversed/);
 const wrong=await environment('sst');await assert.rejects(createBuildTiming('sst',{cwd:wrong.project,env:{...wrong.env,BENCH_SOURCE_COMMIT:'b'.repeat(40)}}),/sourceCommit/);await writeFile(path.join(wrong.project,'sst.config.ts'),'changed config');await assert.rejects(createBuildTiming('sst',{cwd:wrong.project,env:wrong.env}),/differs from/);
 const copied=await environment('cdk'),copyStage=await createBuildTiming('cdk',{cwd:copied.project,env:copied.env});copyStage.start();const code=await zip(copied.project);copyStage.finish();await writeFile(path.join(copied.project,'native.zip'),'different archive');await assert.rejects(copyStage.commit([{...code,nativeOutputPath:'native.zip'}]),/copy differs/);
 const sls=await environment('serverless'),originalEnv={...process.env},originalCwd=process.cwd();
 try{
  Object.assign(process.env,sls.env);process.chdir(sls.project);await zip(sls.project);
  const calls=[],nativeResult={unchanged:true};
  const native={hooks:{'before:package:createDeploymentArtifacts':()=>{}},async _build(){calls.push('build');await delay(10);return 'native-build-result';},async _preparePackageJson(){calls.push('install');await delay(15);return 'native-dependency-result';},async _writeArchive({zipPath}){calls.push('archive');await delay(10);assert.ok((await stat(zipPath)).size>0);return {native:true};},async _package(){await this._writeArchive({zipPath:path.join(sls.project,'report.zip')});return nativeResult;}};
  const serverless={version:'4.43.0',pluginManager:{plugins:[native]},service:{package:{individually:true},functions:{report:{package:{artifact:path.join(sls.project,'report.zip')}}}}};
  const originalMethods={...native};sls.manifest.nativeMethodSha256=Object.fromEntries(['_build','_preparePackageJson','_package','_writeArchive'].map(name=>[name,hash(native[name].toString())]));await writeFile(sls.env.BENCH_BUILD_INPUT_MANIFEST,JSON.stringify(sls.manifest));sls.env.BENCH_BUILD_INPUT_MANIFEST_SHA256=hash(await readFile(sls.env.BENCH_BUILD_INPUT_MANIFEST));process.env.BENCH_BUILD_INPUT_MANIFEST_SHA256=sls.env.BENCH_BUILD_INPUT_MANIFEST_SHA256;
  const Plugin=createRequire(import.meta.url)('./serverless-build-stage.cjs');await new Plugin(serverless).hooks.initialize();assert.equal(await native._build(),'native-build-result');assert.equal(await native._preparePackageJson(),'native-dependency-result');assert.equal(await native._package(),nativeResult);assert.deepEqual(calls,['build','install','archive']);
  const observed=JSON.parse(await readFile(sls.env.BENCH_BUILD_TIMING_FILE));assert.ok(Number(BigInt(observed.endNs)-BigInt(observed.startNs))/1e6>=30);assert.equal(observed.endNs,observed.details.nativeEvents.find(e=>e.name==='native-archive:closed').monotonicNs);assert.ok(BigInt(observed.endNs)<BigInt(observed.details.nativeEvents.at(-1).monotonicNs));await assert.rejects(native._build(),/order\/count/);
  const altered={...originalMethods,async _build(){return 'changed native implementation';}};serverless.pluginManager.plugins=[altered];await assert.rejects(new Plugin(serverless).hooks.initialize(),/differs from its reviewed qualification/);
  const copiedHelper='.benchmark-instrumentation/build-timing.mjs';await writeFile(path.join(sls.project,copiedHelper),'changed actual project helper');await assert.rejects(createBuildTiming('serverless',{cwd:sls.project,env:sls.env}),/differs from the declared/);
  // Even a coherently rewritten local-copy descriptor cannot replace the reviewed repository source.
  const d=sls.manifest.files.find(f=>f.base==='project'&&f.path===copiedHelper),changed=await readFile(path.join(sls.project,copiedHelper));d.bytes=changed.length;d.sha256=hash(changed);sls.manifest.configurationSha256=hash(JSON.stringify(sls.manifest.files.filter(f=>f.role==='configuration')));await writeFile(sls.env.BENCH_BUILD_INPUT_MANIFEST,JSON.stringify(sls.manifest));sls.env.BENCH_BUILD_INPUT_MANIFEST_SHA256=hash(await readFile(sls.env.BENCH_BUILD_INPUT_MANIFEST));sls.env.BENCH_BUILD_CONFIG_SHA256=sls.manifest.configurationSha256;await assert.rejects(createBuildTiming('serverless',{cwd:sls.project,env:sls.env}),/observer copy differs/);
 }finally{process.chdir(originalCwd);for(const key of Object.keys(process.env))if(!(key in originalEnv))delete process.env[key];Object.assign(process.env,originalEnv);}
 console.log('Native build identity/configuration, shared child clock, missing/reversed/duplicate markers, native-copy parity and builder/install/archive lifecycle checks passed. No cloud requests.');
}finally{await rm(root,{recursive:true,force:true});}

// Transparent observation of the pinned Framework builder, not a replacement.
const {createHash}=require('node:crypto');
const path=require('node:path');
const hash=value=>createHash('sha256').update(value).digest('hex');
module.exports=class NativeBuildStage {
 constructor(serverless,options){this.serverless=serverless;this.options=options||{};this.hooks={initialize:()=>this.observe()};}
 async observe(){
  if(!process.env.BENCH_BUILD_TIMING_FILE)return;
  const {createBuildTiming,monotonicNs}=await import('./build-timing.mjs');
  const stage=await createBuildTiming('serverless');
  const version=this.serverless.version;
  if(version!=='4.43.0'||this.options.function||this.serverless.service.package?.individually!==true)throw Error('Build timing requires the qualified Framework 4.43.0 individual package command');
  const candidates=this.serverless.pluginManager.plugins.filter(p=>['_build','_preparePackageJson','_package','_writeArchive'].every(name=>typeof p[name]==='function')&&typeof p.hooks?.['before:package:createDeploymentArtifacts']==='function');
  if(candidates.length!==1)throw Error('Pinned native esbuild lifecycle is missing or ambiguous');
  const native=candidates[0],methods=Object.fromEntries(['_build','_preparePackageJson','_package','_writeArchive'].map(name=>[name,native[name]]));
  const methodSha256=Object.fromEntries(Object.entries(methods).map(([name,fn])=>[name,hash(fn.toString())]));
  if(Object.entries(methodSha256).some(([name,value])=>stage.expectedNativeMethodSha256?.[name]!==value))throw Error('Native Framework lifecycle method differs from its reviewed qualification');
  const events=[],archives=new Map();let buildCalls=0,installCalls=0,packageCalls=0,buildDone=false,installDone=false,lastReady;
  native._build=async function(...args){if(++buildCalls!==1||installCalls||packageCalls)throw Error('Unexpected native build lifecycle order/count');stage.start();events.push({name:'native-build:invoked',monotonicNs:monotonicNs()});const result=await methods._build.apply(this,args);buildDone=true;events.push({name:'native-build:returned',monotonicNs:monotonicNs()});return result;};
  native._preparePackageJson=async function(...args){if(!buildDone||++installCalls!==1||packageCalls)throw Error('Native dependency preparation is outside the observed build lifecycle');events.push({name:'native-dependencies:invoked',monotonicNs:monotonicNs()});const result=await methods._preparePackageJson.apply(this,args);installDone=true;events.push({name:'native-dependencies:returned',monotonicNs:monotonicNs()});return result;};
  native._writeArchive=async function(...args){if(!installDone||packageCalls!==1||typeof args[0]?.zipPath!=='string')throw Error('Native archive is outside the observed package lifecycle');const file=args[0].zipPath;if(archives.has(file))throw Error('Native archive path repeated');archives.set(file,null);const result=await methods._writeArchive.apply(this,args),ready=monotonicNs();archives.set(file,ready);if(!lastReady||BigInt(ready)>BigInt(lastReady))lastReady=ready;events.push({name:'native-archive:closed',path:path.relative(process.cwd(),file),monotonicNs:ready});return result;};
  const serverless=this.serverless;
  native._package=async function(...args){if(!installDone||++packageCalls!==1)throw Error('Unexpected native package lifecycle order/count');events.push({name:'native-package:invoked',monotonicNs:monotonicNs()});const result=await methods._package.apply(this,args);events.push({name:'native-package:returned',monotonicNs:monotonicNs()});
   const selected=Object.entries(serverless.service.functions||{}),files=selected.map(([name,f])=>({name,role:'function',path:f.package?.artifact}));
   if(!selected.length||files.some(f=>typeof f.path!=='string'||!archives.get(f.path))||archives.size!==files.length)throw Error('Native archives did not cover every selected function exactly once');
   stage.finish(lastReady);await stage.commit(files,{frameworkVersion:version,startBoundary:'native esbuild _build invocation',endBoundary:'last native _writeArchive promise completion after output close',methodSha256,nativeEvents:events});return result;
  };
 }
};

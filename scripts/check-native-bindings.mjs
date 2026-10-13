// Exercise native config generation and isolated Serverless CLI contexts offline.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,chmod,symlink} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {prepare} from '../providers/index.mjs';
import {root as repo} from './lib.mjs';
const tmp=await mkdtemp(path.join(os.tmpdir(),'native-bindings-check-'));
const catalogue=JSON.parse(await readFile(path.join(repo,'fixtures/manifest.json'),'utf8'));
const workload=catalogue.lambda?.workloads.find(w=>w.id==='lambda-5')||catalogue.lambda?.workloads[0];
function run(argv,cwd=tmp,env={}){const r=spawnSync(argv[0],argv.slice(1),{cwd,env:{...process.env,...env},encoding:'utf8'});return r;}
try {
 const scenario={id:'deploy-'+(workload?.id||'lambda-5')+'-cli',fixture:workload?.id||'lambda-5',kind:'deploy',journey:'cli'},owner='commerce-offline';
 if(workload)for(const provider of ['candidate','serverless','sst','cdk']){
  const outputDir=path.join(tmp,'generated',provider),nativeBindings={owner,...provider==='serverless'&&{serverless:{deploymentBucket:'bench-cli-offline-bucket'}},...provider==='cdk'&&{cdk:{qualifier:'boffline',toolkitStackName:'bench-toolkit-offline'}}};
  const options={provider,scenario,outputDir,repoRoot:repo,runId:'five-cli-offline-'+provider,nativeBindings};
  const first=await prepare(options);const files=provider==='candidate'?['candidate.yml']:provider==='serverless'?['serverless.yml']:provider==='sst'?['sst.config.ts']:['cdk.json','cdk-app.mjs'];const before=await Promise.all(files.map(f=>readFile(path.join(outputDir,f),'utf8')));const second=await prepare(options);assert.deepEqual(before,await Promise.all(files.map(f=>readFile(path.join(outputDir,f),'utf8'))));assert.deepEqual(first.nativeBindings,second.nativeBindings);
  for(const file of files.filter(f=>/\.(mjs|ts)$/.test(f))){const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:await readFile(path.join(outputDir,file),'utf8'),encoding:'utf8'});assert.equal(syntax.status,0,syntax.stderr);}
  if(provider==='candidate')assert.equal(JSON.parse(before[0]).stackConfig.tags[0].name,'benchmark-owner');
  if(provider==='serverless'){const c=JSON.parse(before[0]);assert.equal(c.provider.deploymentBucket.name,nativeBindings.serverless.deploymentBucket);assert.equal(c.provider.tags['benchmark-owner'],owner);}
  if(provider==='sst')assert.ok(before[0].includes("'benchmark:owner'"));
  if(provider==='cdk'){assert.equal(JSON.parse(before[0]).context['@aws-cdk/core:bootstrapQualifier'],'boffline');assert.ok(before[1].includes("Tags.of(stack).add('benchmark-owner'"));assert.ok(second.commands.update[0].includes('bench-toolkit-offline'));}
  await assert.rejects(prepare({...options,nativeBindings:{owner,serverless:{deploymentBucket:'../outside'}}}),/owned Serverless/);
  await assert.rejects(prepare({...options,nativeBindings:{owner,cdk:{qualifier:'bad/value',toolkitStackName:'bench-toolkit-offline'}}}),/CDK bootstrap/);
 }
 if(workload){
 const source=path.join(tmp,'source');await mkdir(path.join(source,'app/handlers'),{recursive:true});const names=['report','product-lookup','cart-pricing','create-order','notification'];await writeFile(path.join(source,'serverless.yml'),'native-config-one');await writeFile(path.join(source,'obsolete.mjs'),'stale');for(const name of names)await writeFile(path.join(source,'app/handlers',name+'.revision.mjs'),'first');
 const fake=path.join(tmp,'native-fixture.mjs');await writeFile(fake,`#!${process.execPath}\nimport {mkdir,readFile,writeFile} from 'node:fs/promises';\nconst name=process.argv[process.argv.indexOf('--function')+1];const dir='.serverless/build';await mkdir(dir+'/node_modules',{recursive:true});let hit=true;try{await readFile(dir+'/node_modules/retained')}catch{hit=false;await writeFile(dir+'/node_modules/retained','native-installed-deps');await writeFile(dir+'/package-lock.json','native-installed-lock');}console.log(JSON.stringify({name,hit,revision:await readFile('app/handlers/'+name+'.revision.mjs','utf8')}));if(name===process.env.FAIL_NATIVE_NAME)process.exitCode=1;\n`);await chmod(fake,0o755);
 const wrapper=path.join(repo,'providers/parallel-functions.mjs');let result=run([process.execPath,wrapper,fake,'bench','eu-west-1',...names],source);assert.equal(result.status,0,result.stderr);
 await rm(path.join(source,'obsolete.mjs'));await writeFile(path.join(source,'serverless.yml'),'native-config-two');for(const name of names)await writeFile(path.join(source,'app/handlers',name+'.revision.mjs'),'second');result=run([process.execPath,wrapper,fake,'bench','eu-west-1',...names],source);assert.equal(result.status,0,result.stderr);
 const observations=result.stdout.trim().split('\n').map(l=>JSON.parse(l)).filter(v=>v.name);assert.equal(observations.length,5);assert.ok(observations.every(v=>v.hit&&v.revision==='second'));
 for(const name of names){const ctx=path.join(source,'.parallel-functions',name);assert.equal(await readFile(path.join(ctx,'.serverless/build/node_modules/retained'),'utf8'),'native-installed-deps');assert.equal(await readFile(path.join(ctx,'.serverless/build/package-lock.json'),'utf8'),'native-installed-lock');assert.equal(await readFile(path.join(ctx,'serverless.yml'),'utf8'),'native-config-two');await assert.rejects(readFile(path.join(ctx,'obsolete.mjs')),{code:'ENOENT'});}
 result=run([process.execPath,wrapper,fake,'bench','eu-west-1',...names],source,{FAIL_NATIVE_NAME:'notification'});assert.equal(result.status,1);const statuses=JSON.parse(result.stdout.trim().split('\n').at(-1));assert.equal(statuses.functions.length,5);assert.equal(statuses.functions.find(v=>v.function==='notification').success,false);
 result=run([process.execPath,wrapper,fake,'bench','eu-west-1','../escape'],source);assert.notEqual(result.status,0);assert.match(result.stderr,/Usage/);
 const outside=path.join(tmp,'outside');await mkdir(outside);await rm(path.join(source,'.parallel-functions/report'),{recursive:true});await symlink(outside,path.join(source,'.parallel-functions/report'));result=run([process.execPath,wrapper,fake,'bench','eu-west-1',...names],source);assert.notEqual(result.status,0);assert.match(result.stderr,/must not be a link/);
 await rm(path.join(source,'.parallel-functions'),{recursive:true});await symlink(outside,path.join(source,'.parallel-functions'));result=run([process.execPath,wrapper,fake,'bench','eu-west-1',...names],source);assert.notEqual(result.status,0);assert.match(result.stderr,/owned directory/);
 }
 console.log('Native ownership/bucket/bootstrap regeneration, source refresh, dependency-cache retention and failed-child/path checks passed. No cloud requests.');
}finally{await rm(tmp,{recursive:true,force:true});}

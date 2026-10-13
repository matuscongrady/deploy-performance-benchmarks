import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {root} from '../scripts/lib.mjs';
import {projectHerokuSource,verifyHerokuSourceMap} from './heroku-source.mjs';
import {createHerokuApi,setupHeroku,activateHeroku,herokuCompletion,herokuCurrent,captureHerokuBuild,herokuSnapshot,cleanupHeroku} from './heroku.mjs';
import {prepare} from './index.mjs';
import {herokuPushCommands} from './heroku-git.mjs';

const exec=promisify(execFile),temporary=await mkdtemp(path.join(os.tmpdir(),'heroku-check-'));
async function git(directory,...args){return (await exec('git',['-C',directory,...args],{maxBuffer:32*1024*1024})).stdout.trim();}
try {
  const original=path.join(temporary,'original');await exec('git',['clone','--no-hardlinks','--quiet',root,original]);
  await git(original,'config','user.name','Benchmark fixture');await git(original,'config','user.email','fixture@example.invalid');
  const baseline=await git(original,'rev-parse','HEAD'),five=path.join(temporary,'five');
  const a=await projectHerokuSource({repoRoot:original,outputDir:five,fixture:'five-services',sourceCommit:baseline});
  assert.equal(a.mapping.services.length,5);assert.ok(a.mapping.services.every(s=>s.changed));
  assert.ok(a.mapping.services.every(s=>!s.files.some(f=>f.nativePath.includes('Dockerfile'))));
  for(const name of ['api','reporting','notifications']){const file=path.join(original,'fixtures/containers/five-services',name,'revision.mjs');await writeFile(file,(await readFile(file,'utf8')).replace('baseline','test-update'));}
  await git(original,'add','fixtures');await git(original,'commit','-m','Change three fixture revisions');const updated=await git(original,'rev-parse','HEAD');
  const b=await projectHerokuSource({repoRoot:original,outputDir:five,fixture:'five-services',sourceCommit:updated});
  assert.deepEqual(b.mapping.services.filter(s=>s.changed).map(s=>s.name).sort(),['api','notifications','reporting']);
  for(const name of ['inventory','webhooks'])assert.equal(b.mapping.services.find(s=>s.name===name).nativeCommit,a.mapping.services.find(s=>s.name===name).nativeCommit);
  assert.equal((await projectHerokuSource({repoRoot:original,outputDir:five,fixture:'five-services',sourceCommit:updated})).mappingSHA256,b.mappingSHA256);
  const bad=structuredClone(b.mapping);bad.services.find(s=>s.name==='api').changed=false;
  await assert.rejects(verifyHerokuSourceMap({repoRoot:original,mapping:bad,mappingDir:five}),/changed\/unchanged identity/);
  const python=await projectHerokuSource({repoRoot:original,outputDir:path.join(temporary,'python'),fixture:'python',sourceCommit:updated,selectors:{python:'3.11'}});
  assert.equal(python.mapping.runtimeSelectors.python,'3.11');assert.ok(python.mapping.services[0].files.some(f=>f.nativePath==='Procfile'));
  const outputDir=path.join(temporary,'node');
  await prepare({provider:'heroku',scenario:{kind:'deploy',fixture:'node',journey:'cli'},outputDir,repoRoot:original,runId:'heroku-test-app'});
  const plan=JSON.parse(await readFile(path.join(outputDir,'heroku-plan.json'),'utf8'));
  const node=await projectHerokuSource({repoRoot:original,outputDir,fixture:'node',sourceCommit:updated});
  const cli=await exec(process.execPath,[path.join(root,'providers/heroku-source.mjs'),'project','--repo',original,'--fixture','node','--output',outputDir,'--plan',path.join(outputDir,'heroku-plan.json'),'--source',updated],{timeout:30000});
  assert.equal(JSON.parse(cli.stdout).sourceCommit,updated);assert.equal(JSON.parse(await readFile(path.join(outputDir,'heroku-update-commands.json'),'utf8')).length,1);
  const source=node.mapping.services[0],appId='11111111-1111-1111-1111-111111111111',owner='22222222-2222-2222-2222-222222222222',buildId='33333333-3333-3333-3333-333333333333',releaseId='44444444-4444-4444-4444-444444444444',slugId='55555555-5555-5555-5555-555555555555';
  const bytes=gzipSync(Buffer.from('native compressed fixture artifact')),sha=createHash('sha256').update(bytes).digest('hex');let app,formation=[],deleted=false,creates=0;
  const build={id:buildId,app:{id:appId},status:'succeeded',generation:'cedar',source_blob:{version:source.nativeCommit,url:'https://private.example.invalid/source?credential=fixture-only'},created_at:'2026-10-13T12:00:01.000Z',updated_at:'2026-10-13T12:00:10.000Z',release:{id:releaseId},slug:{id:slugId},stack:'heroku-24',output_stream_url:'https://logs.example.invalid/build',buildpacks:[{name:'heroku/nodejs',url:'https://github.com/heroku/heroku-buildpack-nodejs'}]};
  const release={id:releaseId,app:{id:appId},status:'succeeded',current:true,slug:{id:slugId},version:1,updated_at:'2026-10-13T12:00:11.000Z'};
  const slug={id:slugId,commit:source.nativeCommit,size:bytes.length,checksum:'SHA256:'+sha,stack:{name:'heroku-24'},process_types:{web:'npm start'},blob:{method:'GET',url:'https://private.example.invalid/slug?credential=fixture-only'}};
  const api={request:async(method,route,body)=>{
    if(route==='/account')return {id:owner,verified:true};
    if(route==='/apps'&&method==='POST'){creates++;app={id:appId,name:body.name,owner:{id:owner},generation:{name:'cedar'},stack:{name:'heroku-24'},region:{name:'eu'},space:null};return app;}
    if(route==='/apps/'+appId){if(method==='DELETE'){deleted=true;return null;}if(deleted){const error=Error('absent');error.status=404;throw error;}return app;}
    if(route.endsWith('/buildpack-installations'))return [{buildpack:{name:'heroku/nodejs'},ordinal:0}];
    if(route.endsWith('/formation/web')){formation=[{type:'web',size:body.size,quantity:body.quantity}];return formation[0];}
    if(route.endsWith('/formation'))return formation;
    if(route.endsWith('/builds/'+buildId))return build;
    if(route.endsWith('/builds'))return [build];
    if(route.endsWith('/releases/'+releaseId))return release;
    if(route.endsWith('/releases'))return [release];
    if(route.endsWith('/slugs/'+slugId))return slug;
    if(route.endsWith('/config-vars'))return {};
    if(route.endsWith('/addons'))return [];
    throw Error('Unexpected mocked API operation');
  },download:async url=>url===build.output_stream_url?Buffer.from('Native log\nhttps://registry.example.invalid/pkg?signature=fixture-only\nAuthorization: Bearer public-fixture-value\nSet-Cookie: public-fixture-cookie\n'):bytes};
  await setupHeroku(plan,api);await setupHeroku(plan,api);assert.equal(creates,1);await activateHeroku(plan,api);
  assert.equal(herokuPushCommands(plan,node.mapping)[0].nativeCommit,source.nativeCommit);
  assert.deepEqual(herokuPushCommands(plan,node.mapping)[0].argv.slice(0,4),['env','-u','GIT_CURL_VERBOSE','git']);
  const fivePlan={...plan,outputDir:five,services:b.mapping.services.map(s=>({name:s.name,appName:'bench-'+s.name}))};
  assert.equal(herokuPushCommands(fivePlan,b.mapping).length,3);
  assert.throws(()=>herokuPushCommands(plan,node.mapping,{destination:'github'}),/Bind a neutral app-only/);
  const completion=await herokuCompletion(plan,node.mapping,api,{after:'2026-10-13T12:00:00.000Z'});assert.equal(completion.status,'succeeded');assert.equal(completion.sourceCommit,updated);assert.equal(completion.runId,buildId);
  assert.equal((await herokuCurrent(plan,node.mapping,api)).latest,true);assert.equal((await herokuCurrent(plan,node.mapping,api)).finishedAt,release.updated_at);
  const oldVersion=build.source_blob.version;build.source_blob.version='a'.repeat(40);assert.equal((await herokuCompletion(plan,node.mapping,api,{after:'2026-10-13T12:00:00.000Z'})).status,'pending');build.source_blob.version=oldVersion;
  build.status='failed';await assert.rejects(herokuCurrent(plan,node.mapping,api),/Latest native build differs/);build.status='succeeded';
  const oldCommit=slug.commit;slug.commit='b'.repeat(40);await assert.rejects(herokuCompletion(plan,node.mapping,api,{after:'2026-10-13T12:00:00.000Z'}),/projected commit/);slug.commit=oldCommit;
  slug.blob.method='get';
  const proof=await captureHerokuBuild(plan,node.mapping,'api',buildId,api,{outputDir:path.join(temporary,'capture'),downloadSlug:true});assert.equal(proof.artifact.bytes,bytes.length);assert.equal(proof.artifact.sha256,sha);assert.equal(proof.phaseTiming.qualified,false);assert.equal(proof.cache.restored,null);
  slug.blob.method='POST';await assert.rejects(captureHerokuBuild(plan,node.mapping,'api',buildId,api,{outputDir:path.join(temporary,'invalid-method'),downloadSlug:true}),/read-only download/);slug.blob.method='get';
  const saved=await readFile(path.join(temporary,'capture/native-build.json'),'utf8'),log=await readFile(path.join(temporary,'capture/build.log'),'utf8');assert.ok(!saved.includes('credential=fixture-only'));assert.ok(!log.includes('signature=fixture-only'));assert.ok(!log.includes('public-fixture-value'));assert.ok(!log.includes('public-fixture-cookie'));
  const snapshot=await herokuSnapshot(plan,'api',api);assert.equal(snapshot.deploymentId,releaseId);assert.deepEqual(snapshot.artifactIds,[slugId]);
  await cleanupHeroku(plan,api);await cleanupHeroku(plan,api);assert.equal(JSON.parse(await readFile(path.join(outputDir,'owned-apps.json'),'utf8')).apps[0].phase,'deleted');
  const auth=createHerokuApi({tokenProvider:async()=> 'public-test-fixture',fetchImpl:async(url,options)=>{assert.equal(url,'https://api.heroku.com/account');assert.equal(options.headers.Authorization,'Bearer public-test-fixture');return {status:200,ok:true,json:async()=>({verified:true})};}});assert.equal((await auth.request('GET','/account')).verified,true);
  console.log('Heroku app-only source, unchanged commits, exact build/slug attribution, ownership and cleanup checks passed. No network or cloud calls.');
} finally {await rm(temporary,{recursive:true,force:true});}

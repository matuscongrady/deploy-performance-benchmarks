import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parseArgs} from '../scripts/lib.mjs';
import {verifyHerokuSourceMap} from './heroku-source.mjs';
import {herokuPushCommands} from './heroku-git.mjs';

const exec=promisify(execFile),json=v=>JSON.stringify(v,null,2)+'\n',digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const appName=value=>{if(!/^[a-z][a-z0-9-]{1,28}[a-z0-9]$/.test(value||''))throw Error('Invalid neutral Heroku app name');return value;};
const uuid=value=>{if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value||''))throw Error('A recorded Heroku resource ID is required');return value;};
async function save(file,value,{immutable=false}={}){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,json(value),immutable?{flag:'wx'}:{});}
export function createHerokuApi({fetchImpl=fetch,tokenProvider=async()=>{if(process.env.HEROKU_API_KEY)return process.env.HEROKU_API_KEY;try{return (await exec(process.env.HEROKU_CLI||'heroku',['auth:token'],{maxBuffer:1024*1024})).stdout.trim();}catch{throw Error('Heroku authentication command failed');}}}={}) {
  let token;
  async function request(method,route,body,headers={}) {
    if(!/^\/(?:account|apps|builds|stacks)(?:\/|$)/.test(route))throw Error('Unrecognized native Heroku API route');
    token??=await tokenProvider();if(!token)throw Error('Heroku authentication is missing');
    let response;try{response=await fetchImpl('https://api.heroku.com'+route,{method,headers:{Accept:'application/vnd.heroku+json; version=3',Authorization:'Bearer '+token,'Content-Type':'application/json',...headers},...body&&{body:JSON.stringify(body)},signal:AbortSignal.timeout(30000)});}catch{throw Error('Heroku native API request failed');}
    if(response.status===404){const error=Error('Heroku resource is absent');error.status=404;throw error;}
    if(!response.ok)throw Error('Heroku native API returned HTTP '+response.status);
    if(response.status===204)return null;try{return await response.json();}catch{throw Error('Heroku native API returned invalid JSON');}
  }
  async function download(url) {
    let location;try{location=new URL(url);}catch{throw Error('Native artifact download URL is invalid');}
    if(location.protocol!=='https:'||location.username||location.password)throw Error('Native download must use HTTPS without embedded credentials');
    const headers={};if(location.origin==='https://api.heroku.com'){token??=await tokenProvider();headers.Authorization='Bearer '+token;}
    let response;try{response=await fetchImpl(url,{headers,signal:AbortSignal.timeout(60000)});}catch{throw Error('Native Heroku download failed');}if(!response.ok)throw Error('Native Heroku download returned HTTP '+response.status);return Buffer.from(await response.arrayBuffer());
  }
  return {request,download};
}
async function stateFile(plan){return path.join(plan.outputDir,'owned-apps.json');}
async function verifyPlanSource(plan,mapping) {
  if(plan.fixture!==mapping.fixture||plan.services.length!==mapping.services.length||mapping.services.some(s=>!plan.services.some(p=>p.name===s.name&&p.sourceRoot===s.sourceRoot)))throw Error('Native app bindings differ from the selected source fixture');
  return verifyHerokuSourceMap({repoRoot:plan.repoRoot,mapping,mappingDir:plan.outputDir});
}
async function ownedApps(plan,api,{allowDeleted=false,checkRuntime=true,allowPartial=false}={}) {
  const state=JSON.parse(await readFile(await stateFile(plan),'utf8')),account=await api.request('GET','/account');
  if(state.ownerAccountId!==account.id||state.appId!==plan.appId)throw Error('Heroku ownership ledger belongs to another account or application');
  if(!Array.isArray(state.apps)||new Set(state.apps.map(a=>a.service)).size!==state.apps.length||state.apps.some(a=>!plan.services.some(s=>s.name===a.service&&s.appName===a.name)))throw Error('Heroku ownership ledger has unexpected or duplicate applications');
  for(const service of plan.services) {
    const entry=state.apps.find(a=>a.service===service.name);if(!entry?.id){if(allowPartial)continue;throw Error('Every native app needs its recorded owned ID');}
    let app;try{app=await api.request('GET','/apps/'+uuid(entry.id));}catch(error){if(allowDeleted&&error.status===404){entry.absent=true;continue;}throw error;}
    if(entry.phase==='deleted')throw Error('An app recorded as deleted is present again');
    if(app.id!==entry.id||app.name!==entry.name||app.owner?.id!==state.ownerAccountId||checkRuntime&&(app.space||app.generation?.name!=='cedar'||app.stack?.name!=='heroku-24'||app.region?.name!==plan.region))throw Error('Recorded app owner, generation, stack or runtime scope differs');
  }
  return state;
}
export async function setupHeroku(plan,api) {
  if(plan.generation!=='cedar'||plan.dyno!=='basic'||plan.stack!=='heroku-24'||!['eu','us'].includes(plan.region))throw Error('This recipe requires Cedar Common Runtime Basic');
  if(plan.services.some(s=>s.buildpack!==(plan.fixture==='python'?'heroku/python':'heroku/nodejs')))throw Error('Use the selected fixture\'s official native buildpack');
  const account=await api.request('GET','/account');if(account.verified!==true)throw Error('Heroku billing verification is required');
  const file=await stateFile(plan);let state;
  try{state=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;state={schemaVersion:1,appId:plan.appId,ownerAccountId:account.id,apps:[]};await save(file,state,{immutable:true});}
  if(state.appId!==plan.appId||state.ownerAccountId!==account.id)throw Error('Heroku ownership ledger differs from the authenticated account');
  for(const service of plan.services) {
    let entry=state.apps.find(a=>a.service===service.name),app;
    if(entry){if(!entry.id||entry.phase==='deleted'||entry.name!==service.appName)throw Error('A recorded incomplete app creation needs owned recovery before setup');app=await api.request('GET','/apps/'+uuid(entry.id));}
    else{entry={service:service.name,name:appName(service.appName),phase:'creating',requestedAt:new Date().toISOString()};state.apps.push(entry);await save(file,state);app=await api.request('POST','/apps',{name:entry.name,region:plan.region,stack:plan.stack});entry.id=uuid(app.id);entry.phase='created';entry.createdAt=app.created_at;await save(file,state);}
    if(app.owner?.id!==account.id||app.space||app.generation?.name!=='cedar'||app.stack?.name!==plan.stack)throw Error('Created app differs from the approved runtime; use its recorded ID for cleanup');
    entry.webUrl=app.web_url||null;await save(file,state);
    await api.request('PUT','/apps/'+entry.id+'/buildpack-installations',{updates:[{buildpack:service.buildpack}]});entry.phase='configured';await save(file,state);
    await save(path.join(plan.outputDir,'native-outputs.json'),{services:Object.fromEntries(state.apps.filter(a=>a.id).map(a=>[a.service,{appId:a.id,appName:a.name,url:a.webUrl}]))});
  }
  return {status:'configured',apps:state.apps.map(({service,id,name,webUrl})=>({service,id,name,webUrl})),next:'Push the baseline, then activate Basic dynos and verify every business probe'};
}
export async function activateHeroku(plan,api) {
  const state=await ownedApps(plan,api);
  for(const entry of state.apps) {
    await api.request('PATCH','/apps/'+entry.id+'/formation/web',{quantity:1,size:'basic'});
    const formation=await api.request('GET','/apps/'+entry.id+'/formation');
    if(formation.filter(f=>f.type==='web'&&f.quantity===1&&f.size?.toLowerCase()==='basic').length!==1||formation.some(f=>f.type!=='web'&&f.quantity))throw Error('Native Basic web formation differs');
    entry.phase='active';await save(await stateFile(plan),state);
  }
  return {status:'active',dyno:'basic',webDynos:state.apps.length};
}
export async function pushHeroku(plan,mapping,{destination='heroku',api,runCommand=async argv=>{try{const env={...process.env,GIT_TERMINAL_PROMPT:'0',GIT_TRACE:'0',GIT_TRACE_CURL:'0',GIT_TRACE_REDACT:'1'};delete env.GIT_CURL_VERBOSE;const r=await exec(argv[0],argv.slice(1),{maxBuffer:16*1024*1024,env});return {exitCode:0,stdout:r.stdout,stderr:r.stderr};}catch(error){return {exitCode:typeof error.code==='number'?error.code:1,stdout:error.stdout||'',stderr:error.stderr||''};}}}={}) {
  await verifyPlanSource(plan,mapping);await ownedApps(plan,api);
  const commands=herokuPushCommands(plan,mapping,{destination});if(!commands.length)throw Error('This source mapping has no changed application tree');
  const push={sourceCommit:mapping.sourceCommit,runId:process.env.BENCH_RUN_ID||null,provider:'heroku',destination,startedAt:new Date().toISOString(),services:commands.map(({name,nativeCommit})=>({name,nativeCommit}))};
  await save(path.join(plan.outputDir,'push-state.json'),push);
  const results=await Promise.all(commands.map(async command=>{const result=await runCommand(command.argv);const stdout=sanitizeLog(result.stdout),stderr=sanitizeLog(result.stderr);return {name:command.name,nativeCommit:command.nativeCommit,exitCode:result.exitCode,stdout,stderr};}));
  push.finishedAt=new Date().toISOString();push.results=results;await save(path.join(plan.outputDir,'push-state.json'),push);
  if(results.some(r=>r.exitCode!==0))throw Error('At least one native Git push failed; preserve push-state.json');return {status:'pushed',...push};
}
export function sanitizeBuild(build) {return {id:build.id,appId:build.app?.id,status:build.status,generation:build.generation,createdAt:build.created_at,updatedAt:build.updated_at,sourceVersion:build.source_blob?.version,sourceChecksum:build.source_blob?.checksum,releaseId:build.release?.id,slugId:build.slug?.id,stack:build.stack,buildpacks:build.buildpacks?.map(b=>({name:b.name,url:sanitizeLog(b.url)}))};}
export async function herokuCompletion(plan,mapping,api,{after}={}) {
  await verifyPlanSource(plan,mapping);const state=await ownedApps(plan,api);
  if(!Number.isFinite(Date.parse(after)))throw Error('Bind the actual push start before observing native completion');
  const nativeRuns=[];let status='succeeded';
  for(const source of mapping.services.filter(s=>s.changed)) {
    const app=state.apps.find(a=>a.service===source.name),builds=await api.request('GET','/apps/'+app.id+'/builds',undefined,{Range:'started_at ..; order=desc,max=100'});
    const matches=builds.filter(b=>b.source_blob?.version===source.nativeCommit&&Date.parse(b.created_at)>=Date.parse(after));
    if(matches.length>1)throw Error('Multiple native builds match this exact source and push; bind one build ID');
    if(!matches.length){status=status==='failed'?status:'pending';continue;}
    const build=matches[0],run={name:source.name,nativeCommit:source.nativeCommit,...sanitizeBuild(build)};
    if(build.app?.id!==app.id||build.generation!=='cedar')throw Error('Native build belongs to another app or generation');
    if(build.status==='failed')status='failed';else if(build.status!=='succeeded')status=status==='failed'?status:'pending';
    else {
      if(!build.release?.id||!build.slug?.id)throw Error('Successful native build is missing its release or slug');
      const release=await api.request('GET','/apps/'+app.id+'/releases/'+uuid(build.release.id));
      const slug=await api.request('GET','/apps/'+app.id+'/slugs/'+uuid(build.slug.id));
      if(slug.commit!==source.nativeCommit||release.slug?.id!==slug.id||release.app?.id!==app.id)throw Error('Native release/slug does not match the projected commit');
      if(['failed','expired'].includes(release.status))status='failed';else if(release.status!=='succeeded')status=status==='failed'?status:'pending';
      run.releaseStatus=release.status;run.releaseFinishedAt=release.updated_at;run.compressedSlugBytes=slug.size;run.slugChecksum=slug.checksum;
    }
    nativeRuns.push(run);
  }
  if(!mapping.services.some(s=>s.changed))throw Error('No changed native inputs were pushed');
  const finishedAt=status==='succeeded'?new Date(Math.max(...nativeRuns.map(r=>Math.max(Date.parse(r.updatedAt),Date.parse(r.releaseFinishedAt))))).toISOString():undefined;
  return {sourceCommit:mapping.sourceCommit,status,runId:nativeRuns.map(r=>r.id).sort().join('+')||undefined,finishedAt,nativeRuns,pushStartedAt:after};
}
export async function herokuSnapshot(plan,name,api) {
  const state=await ownedApps(plan,api),app=state.apps.find(a=>a.service===name);if(!app)throw Error('Unbound component');
  const releases=await api.request('GET','/apps/'+app.id+'/releases',undefined,{Range:'version ..; order=desc,max=100'}),current=releases.filter(r=>r.current===true);
  if(current.length!==1||current[0].status!=='succeeded'||!current[0].slug?.id)throw Error('No single successful current native release');
  const release=current[0],slug=await api.request('GET','/apps/'+app.id+'/slugs/'+uuid(release.slug.id)),formation=await api.request('GET','/apps/'+app.id+'/formation'),buildpacks=await api.request('GET','/apps/'+app.id+'/buildpack-installations'),vars=await api.request('GET','/apps/'+app.id+'/config-vars');
  const varsHash=digest(json(Object.fromEntries(Object.entries(vars).sort(([a],[b])=>a.localeCompare(b)))));
  return {deploymentId:release.id,configurationHash:digest(json({generation:'cedar',stack:plan.stack,region:plan.region,formation:formation.map(f=>({type:f.type,size:f.size,quantity:f.quantity})).sort((a,b)=>a.type.localeCompare(b.type)),buildpacks,varsHash})),artifactIds:[slug.id],appId:app.id,nativeCommit:slug.commit,compressedSlugBytes:slug.size};
}
export async function herokuCurrent(plan,mapping,api) {
  await verifyPlanSource(plan,mapping);const state=await ownedApps(plan,api),nativeRuns=[];
  for(const source of mapping.services) {
    const app=state.apps.find(a=>a.service===source.name),builds=await api.request('GET','/apps/'+app.id+'/builds',undefined,{Range:'started_at ..; order=desc,max=100'});
    const latest=[...builds].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at))[0];
    if(!latest||!Number.isFinite(Date.parse(latest.created_at))||latest.source_blob?.version!==source.nativeCommit||latest.status!=='succeeded'||latest.app?.id!==app.id||latest.generation!=='cedar')throw Error('Latest native build differs from the admitted source or is not successful');
    const releases=await api.request('GET','/apps/'+app.id+'/releases',undefined,{Range:'version ..; order=desc,max=100'}),current=releases.filter(r=>r.current===true);
    if(current.length!==1||current[0].status!=='succeeded'||current[0].id!==latest.release?.id||current[0].slug?.id!==latest.slug?.id)throw Error('Latest native build is not the current successful release');
    const slug=await api.request('GET','/apps/'+app.id+'/slugs/'+uuid(latest.slug.id));if(slug.commit!==source.nativeCommit)throw Error('Current slug differs from the admitted native source');
    nativeRuns.push({name:source.name,nativeCommit:source.nativeCommit,...sanitizeBuild(latest),releaseFinishedAt:current[0].updated_at});
  }
  const changed=nativeRuns.filter(r=>mapping.services.find(s=>s.name===r.name).changed);if(!changed.length)throw Error('Admitted source map has no changed build identity');
  return {verified:true,latest:true,status:'succeeded',sourceCommit:mapping.sourceCommit,runId:changed.map(r=>r.id).sort().join('+'),finishedAt:new Date(Math.max(...changed.map(r=>Math.max(Date.parse(r.updatedAt),Date.parse(r.releaseFinishedAt))))).toISOString(),observedAt:new Date().toISOString(),nativeRuns};
}
function sanitizeLog(text) {return String(text||'').replace(/((?:proxy-)?authorization|(?:set-)?cookie)(\s*:\s*)[^\r\n]*/gi,'$1$2[private header removed]').replace(/https?:\/\/[^\s"'<>]+/g,match=>{try{const url=new URL(match);if(url.username||url.password||url.search){url.username='';url.password='';url.search='';return url.href+'[private URL details removed]';}return match;}catch{return '[unparseable URL removed]';}});}
export async function captureHerokuBuild(plan,mapping,appNameOrService,buildId,api,{outputDir,downloadSlug=false}={}) {
  await verifyPlanSource(plan,mapping);const state=await ownedApps(plan,api),app=state.apps.find(a=>a.service===appNameOrService),source=mapping.services.find(s=>s.name===appNameOrService);if(!app||!source||!outputDir)throw Error('Bind the selected native app, source map and evidence directory');
  const build=await api.request('GET','/apps/'+app.id+'/builds/'+uuid(buildId));
  if(build.status!=='succeeded'||build.app?.id!==app.id||build.generation!=='cedar'||build.source_blob?.version!==source.nativeCommit||!build.slug?.id)throw Error('Capture a successful exact-source native Cedar build');
  const slug=await api.request('GET','/apps/'+app.id+'/slugs/'+uuid(build.slug.id));if(slug.commit!==source.nativeCommit||!Number.isSafeInteger(slug.size)||slug.size<=0)throw Error('Native slug identity or compressed size differs');
  const log=sanitizeLog((await api.download(build.output_stream_url)).toString());await mkdir(outputDir,{recursive:true});
  await writeFile(path.join(outputDir,'build.log'),log,{flag:'wx'});
  const record={schemaVersion:1,provider:'heroku',sourceCommit:mapping.sourceCommit,nativeCommit:source.nativeCommit,appId:app.id,name:source.name,...sanitizeBuild(build),slug:{id:slug.id,commit:slug.commit,checksum:slug.checksum,compressedBytes:slug.size,stack:slug.stack?.name,processTypes:slug.process_types},log:{file:'build.log',sha256:digest(log)},phaseTiming:{qualified:false,reason:'created_at/updated_at are build lifecycle timestamps; qualify the actual packaging phase from native timestamped events'},cache:{restored:null,state:'requires qualified native cache evidence'}};
  if(downloadSlug) {
    if(typeof slug.blob?.method!=='string'||slug.blob.method.toUpperCase()!=='GET')throw Error('Native slug has no read-only download');const bytes=await api.download(slug.blob.url),sha=digest(bytes);
    if(bytes.length!==slug.size||bytes[0]!==0x1f||bytes[1]!==0x8b||slug.checksum&&!new RegExp('^SHA256:'+sha+'$','i').test(slug.checksum))throw Error('Downloaded compressed slug differs from the native metadata');
    await writeFile(path.join(outputDir,'api.tgz'),bytes,{flag:'wx'});record.artifact={name:source.name,format:'heroku-slug',path:'api.tgz',bytes:bytes.length,sha256:sha};
  }
  await save(path.join(outputDir,'native-build.json'),record,{immutable:true});return record;
}
export async function purgeHerokuCache(plan,api,{runCommand=async argv=>{try{const result=await exec(argv[0],argv.slice(1),{maxBuffer:1024*1024});return {exitCode:0,stdout:result.stdout,stderr:result.stderr};}catch{return {exitCode:1};}},outputDir}={}) {
  const state=await ownedApps(plan,api);if(!outputDir)throw Error('Save immutable native cache-purge evidence outside the timer');const observations=[];
  for(const app of state.apps){const argv=[process.env.HEROKU_CLI||'heroku','builds:cache:purge','--app',app.name,'--confirm',app.name],result=await runCommand(argv);const observation={service:app.service,appId:app.id,command:argv,exitCode:result.exitCode,purgedAt:new Date().toISOString(),stdout:sanitizeLog(result.stdout),stderr:sanitizeLog(result.stderr)};observations.push(observation);await save(path.join(outputDir,app.service+'-cache-purge.json'),observation,{immutable:true});if(result.exitCode!==0)throw Error('Native cache purge failed');}
  return {status:'purged',observations};
}
export async function cleanupHeroku(plan,api) {
  const state=await ownedApps(plan,api,{allowDeleted:true,checkRuntime:false,allowPartial:true});
  for(const entry of state.apps) {
    if(!entry.id)continue;
    if(entry.absent){entry.phase='deleted';entry.deletedAt??=new Date().toISOString();delete entry.absent;await save(await stateFile(plan),state);continue;}
    const addons=await api.request('GET','/apps/'+entry.id+'/addons');if(addons.length)throw Error('An unexpected add-on needs explicit owned recovery before app deletion');
    await api.request('DELETE','/apps/'+entry.id);let absent=false;try{await api.request('GET','/apps/'+entry.id);}catch(error){if(error.status!==404)throw error;absent=true;}if(!absent)throw Error('Destroyed native app is still present');
    entry.phase='deleted';entry.deletedAt=new Date().toISOString();await save(await stateFile(plan),state);
  }
  if(state.apps.some(a=>!a.id))throw Error('Recorded app creation has no returned ID; inspect its reserved name and recover ownership before declaring cleanup complete');
  return {status:'deleted-and-verified',apps:state.apps.map(({service,id})=>({service,id}))};
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
  try {
    const {positional,flags}=parseArgs(process.argv.slice(2)),operation=positional[0];if(!flags.plan)throw Error('Supply --plan HEROKU_PLAN');const plan=JSON.parse(await readFile(flags.plan,'utf8'));
    if(['setup','activate','push','purge','cleanup'].includes(operation)&&!flags.execute){console.log(json({preparedOnly:true,operation,services:plan.services.map(s=>s.name)}));process.exit(0);}
    const api=createHerokuApi();let mapping;if(['push','completion','capture','current'].includes(operation)){if(!flags.mapping)throw Error('Supply --mapping IMMUTABLE_SOURCE_MAP');mapping=JSON.parse(await readFile(flags.mapping,'utf8'));}
    let result;
    if(operation==='setup')result=await setupHeroku(plan,api);
    else if(operation==='activate')result=await activateHeroku(plan,api);
    else if(operation==='push')result=await pushHeroku(plan,mapping,{destination:flags.destination||'heroku',api});
    else if(operation==='completion'){let after=flags.after;if(!after){const push=JSON.parse(await readFile(path.join(plan.outputDir,'push-state.json'),'utf8'));if(push.sourceCommit!==mapping.sourceCommit)throw Error('Push state refers to another source');after=push.startedAt;}result=await herokuCompletion(plan,mapping,api,{after});}
    else if(operation==='snapshot')result=await herokuSnapshot(plan,flags.service,api);
    else if(operation==='current')result=await herokuCurrent(plan,mapping,api);
    else if(operation==='capture')result=await captureHerokuBuild(plan,mapping,flags.service,flags.build,api,{outputDir:flags.output,downloadSlug:Boolean(flags['download-slug'])});
    else if(operation==='purge')result=await purgeHerokuCache(plan,api,{outputDir:flags.output});
    else if(operation==='cleanup')result=await cleanupHeroku(plan,api);
    else throw Error('Choose setup, activate, push, completion, current, snapshot, capture, purge or cleanup');
    console.log(json(result));
  }catch(error){console.error(error.message);process.exitCode=1;}
}

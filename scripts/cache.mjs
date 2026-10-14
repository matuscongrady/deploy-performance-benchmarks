import path from 'node:path';
import {root,parseArgs,safeId,json,saveResult,refuseExistingResult,command,observeCachePaths,verifyRetainedCache,sha256,scenarioById} from './lib.mjs';
const {positional,flags}=parseArgs(process.argv.slice(2));
try {
 const [provider]=positional,scenario=await scenarioById(flags.scenario);
 if(positional.length!==1||!scenario.providers.includes(provider))throw Error('Choose one provider supported by the selected scenario');
 const appId=safeId(flags['app-id'],'application ID'),runId=safeId(flags['run-id'],'run ID'),series=flags.series;
 if(!['clean','cached-source-edit','cli-existing-cache'].includes(series))throw Error('Choose --series clean, cached-source-edit or cli-existing-cache');
 const git=await command(['git','rev-parse','HEAD']);if(git.exitCode!==0)throw Error('Commit the benchmark source first');
 const dirty=await command(['git','status','--porcelain']);if(dirty.stdout.trim())throw Error('Commit source changes before capturing cache evidence');
 const sourceCommit=git.stdout.trim(),project=path.join(root,'.work',appId,provider);
 const qualification=flags.qualification?await json(flags.qualification):null;
 const defaults={serverless:['.serverless'],cdk:['cdk.out','package-artifacts'],sst:['.sst/artifacts','package-artifacts']};
 const paths=qualification?.cacheControl?.localPaths||defaults[provider];
 if(!Array.isArray(paths)||(!paths.length&&series!=='cli-existing-cache'&&qualification?.cacheControl?.nativeClean?.verified!==true))throw Error('Provider cache paths/native control have not been qualified');
 const file=path.join(root,'.work/evidence',runId,provider,'cache-control.json');await refuseExistingResult(file);
 const record={schemaVersion:1,mode:'local',provider,scenario:scenario.id,appId,runId,sourceCommit,series,capturedAt:new Date().toISOString(),paths:[],dependenciesRetained:true,remoteCachesCleared:false,dockerCacheCleared:false,reuseObserved:'unknown',nativeClean:qualification?.cacheControl?.nativeClean};
 if(series==='cached-source-edit'){
  if(!flags['retain-from'])throw Error('Cached source edits require --retain-from PREVIOUS_RESULT');
  record.retainedFrom={file:path.relative(root,path.resolve(flags['retain-from'])),sha256:await sha256(flags['retain-from'])};
  record.paths=paths.map(p=>({path:p}));await verifyRetainedCache(record,project);
 }
 record.paths=await observeCachePaths(project,paths,{reset:series==='clean'});
 await saveResult(file,record);console.log(JSON.stringify({file:path.relative(root,file),sha256:await sha256(file),...record},null,2));
}catch(e){console.error(e.message);process.exitCode=1;}

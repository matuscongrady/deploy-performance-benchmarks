import path from 'node:path';
import {readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {verifyImportedLambda} from './sizes.mjs';
import {verifyImportedPredecessor} from './git-predecessor.mjs';
import {root,json,validateRecord,verifyImportedAttempt} from './lib.mjs';
import {verifyImportedClock} from './clock.mjs';
import {verifyImportedBuildTiming} from './build-timing.mjs';
const capacity=r=>JSON.stringify({cpu:r.environment?.cpu,cores:r.environment?.cores,memoryBytes:r.environment?.memoryBytes,arch:r.environment?.arch,node:r.environment?.node,buildCapacity:r.environment?.buildCapacity});
const timerDomain=r=>r.timing?JSON.stringify({clock:r.timing.clock,bootId:r.timing.bootId,clocksource:r.timing.clocksource,host:r.timing.host}):'legacy-or-native-clock';
// These top-level fields describe an attempt's source projection, which is
// already bound to its original/projection evidence. They are not build modes.
const provenanceKeys=new Set(['sourceCommit','originalSourceCommit','nativeSourceCommit']);
const effectiveSettings=settings=>Object.fromEntries(Object.entries(settings||{}).filter(([key])=>!provenanceKeys.has(key)));
const cohort=r=>[r.scenario,r.cacheEvidence?.series,r.buildTiming?.campaignId,r.buildTiming?.scope,r.environment?.region,capacity(r),timerDomain(r)].join(' | ');
export function summarizeResults(records) {
  if(new Set(records.map(r=>`${r.provider}/${r.runId}`)).size!==records.length)throw Error('Duplicate provider/attempt records cannot increase the sample count');
  const groups=new Map();
  const matched=new Map();
  const providers=['candidate','serverless','sst','cdk'];
  for(const record of records){
    const r=validateRecord(record);
    const key=[r.scenario,r.provider,r.artifacts?.format||'deployment',r.cacheEvidence?.series||'unknown-cache',JSON.stringify(r.toolVersion),JSON.stringify(effectiveSettings(r.settings)),r.environment?.region,r.environment?.plan,capacity(r),r.buildTiming?.campaignId||'operation-only',timerDomain(r)].join(' | ');
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
    if(r.status!=='passed'||!r.buildTiming?.verified)continue;
    const k=cohort(r);if(!matched.has(k))matched.set(k,{providers:new Map(),quartets:new Map()});
    const c=matched.get(k);if(!c.providers.has(r.provider))c.providers.set(r.provider,{count:0,recipes:new Set()});
    const p=c.providers.get(r.provider);p.count++;p.recipes.add(JSON.stringify([r.toolVersion,effectiveSettings(r.settings),r.buildTiming.configurationSha256,r.buildTiming.instrumentationSha256,r.buildTiming.nativeMethodSha256,r.buildTiming.identitySession]));
    const sourceRound=`${r.runId}/${r.sourceCommit}`;if(!c.quartets.has(sourceRound))c.quartets.set(sourceRound,new Set());c.quartets.get(sourceRound).add(r.provider);
  }
  const median=values=>values.length?(values.length%2?values[Math.floor(values.length/2)]:(values[values.length/2-1]+values[values.length/2])/2):null;
  return [...groups].map(([key,runs])=>{
    const passed=runs.filter(r=>r.status==='passed'),times=passed.map(r=>r.durationMs/1000).sort((a,b)=>a-b);
    const buildTimes=passed.filter(r=>r.buildTiming?.verified).map(r=>r.buildTiming.durationMs/1000).sort((a,b)=>a-b),c=matched.get(cohort(runs[0]));
    const completeQuartet=q=>q.size===4&&providers.every(p=>q.has(p));
    const matchedSourceRounds=c?[...c.quartets.values()].filter(completeQuartet).length:0;
    const buildSampleCountEligible=buildTimes.length>=10&&matchedSourceRounds>=10&&[...c.quartets.values()].every(completeQuartet)&&providers.every(p=>(c.providers.get(p)?.count||0)>=10&&c.providers.get(p).recipes.size===1);
    const sizes=passed.filter(r=>r.kind==='package'&&r.artifacts.sizeAvailable!==false&&Number.isSafeInteger(r.artifacts.bytes)&&r.artifacts.bytes>0).map(r=>r.artifacts.bytes).sort((a,b)=>a-b);
    const lambda=passed.filter(r=>r.artifacts?.format==='lambda-zip'),codeSizes=lambda.map(r=>r.artifacts.codeBytes).sort((a,b)=>a-b),mapSizes=lambda.map(r=>r.artifacts.sourceMapBytes).sort((a,b)=>a-b);
    const clockPublicationQualified=passed.length>0&&passed.every(r=>r.kind==='package'&&r.artifacts?.format==='provider-native'||r.timing?.quality.publicationQualified===true);
    const sampleCountEligible=passed.length>=10;
    return {test:key,attempts:runs.length,passed:passed.length,failed:runs.filter(r=>r.status==='failed').length,unqualified:runs.filter(r=>r.status==='unqualified').length,
      operationMetric:runs[0].kind==='package'?'complete-recipe-invocation':'first-business-readiness',medianSeconds:median(times),minSeconds:times[0]??null,maxSeconds:times.at(-1)??null,
      medianOperationSeconds:median(times),minOperationSeconds:times[0]??null,maxOperationSeconds:times.at(-1)??null,
      timerProtocol:runs[0].timing?.clock||'legacy-or-native-clock',clockPublicationQualified,timingPublicationReady:clockPublicationQualified&&sampleCountEligible,clockQuality:clockPublicationQualified?'qualified-native-phase':'Local absolute clock-rate qualification is pending',wallOffsetChangeMs:passed.filter(r=>r.timing).map(r=>r.timing.quality.wallOffsetChangeMs),
      buildMetric:buildTimes.length?'native-build-and-archive':null,buildSamples:buildTimes.length,matchedSourceRounds,medianBuildSeconds:median(buildTimes),minBuildSeconds:buildTimes[0]??null,maxBuildSeconds:buildTimes.at(-1)??null,buildSampleCountEligible,buildPublishable:buildSampleCountEligible&&clockPublicationQualified,
      sizeMetric:passed.some(r=>r.artifacts?.format==='lambda-zip')?'total-application-upload-bytes':'native-compressed-artifact-bytes',sizeSamples:sizes.length,medianCodeBytes:median(codeSizes),medianSeparateSourceMapBytes:median(mapSizes),medianBytes:median(sizes),minBytes:sizes[0]??null,maxBytes:sizes.at(-1)??null,
      sampleCountEligible,publishable:sampleCountEligible&&clockPublicationQualified,operationPublishable:sampleCountEligible&&clockPublicationQualified,sizePublishable:sizes.length>=10};
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const dir=process.argv[2]||path.join(root,'results/raw');
  let files;try{files=(await readdir(dir)).filter(f=>f.endsWith('.json'));}catch{console.log('No measured results yet.');process.exit(0);}
  const records=await Promise.all(files.map(file=>json(path.join(dir,file))));
  for(const record of records){await verifyImportedClock(record,{base:root});await verifyImportedAttempt(record,{base:root});await verifyImportedPredecessor(record);await verifyImportedBuildTiming(record,{base:root});if(record.status==='passed'&&record.kind==='package'&&record.artifacts.format==='lambda-zip')await verifyImportedLambda(record);}
  for(const result of summarizeResults(records))console.log(JSON.stringify(result,null,2));
}

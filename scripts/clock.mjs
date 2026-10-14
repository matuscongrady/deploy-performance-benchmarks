import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import os from 'node:os';

export const elapsedClock='linux-clock-monotonic-nanoseconds';
const keys=['scenario','provider','runId','sourceCommit','appId','stage'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const ns=value=>typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value);
export function clockMarker(){return {monotonicNs:process.hrtime.bigint().toString(),observedAt:new Date().toISOString()};}
export async function localClock(){
  if(process.platform!=='linux')throw Error('Qualified local timing requires the reviewed Linux monotonic clock');
  const [bootId,clocksource]=await Promise.all([readFile('/proc/sys/kernel/random/boot_id','utf8'),readFile('/sys/devices/system/clocksource/clocksource0/current_clocksource','utf8')]);
  return {clock:elapsedClock,bootId:bootId.trim(),clocksource:clocksource.trim(),host:os.hostname(),node:process.version,mark:clockMarker};
}
export function intervalTiming(clock,start,end){
  const durationMs=Number(BigInt(end.monotonicNs)-BigInt(start.monotonicNs))/1e6;
  const wallElapsedMs=Date.parse(end.observedAt)-Date.parse(start.observedAt);
  return {schemaVersion:1,clock:clock.clock,bootId:clock.bootId,clocksource:clock.clocksource,host:clock.host,node:clock.node,start,end,durationMs,
    quality:{wallElapsedMs,wallOffsetChangeMs:wallElapsedMs-durationMs,absoluteRateQualified:false,publicationQualified:false,reason:'Independent host clock-rate qualification is required'}};
}
function validateInterval(timing){
  if(timing?.schemaVersion!==1||timing.clock!==elapsedClock||!/^[a-f0-9-]{36}$/.test(timing.bootId||'')||!timing.clocksource||!timing.host||!timing.node||!ns(timing.start?.monotonicNs)||!ns(timing.end?.monotonicNs)||BigInt(timing.end.monotonicNs)<BigInt(timing.start.monotonicNs)||!Number.isFinite(Date.parse(timing.start.observedAt))||!Number.isFinite(Date.parse(timing.end.observedAt)))throw Error('Invalid local monotonic clock anchors/domain');
  const expected=intervalTiming(timing,timing.start,timing.end);
  if(timing.durationMs!==expected.durationMs||!isDeepStrictEqual(timing.quality,expected.quality))throw Error('Local clock duration/quality differs from the original anchors');
  return timing;
}
export async function retainClockEvidence(timing,identity,{base,file}){
  // Retention precedes admission: even an invalid observed interval must leave
  // its original evidence available when the full attempt is rejected.
  const value={schemaVersion:1,identity:Object.fromEntries(keys.map(k=>[k,identity[k]])),timing};
  const bytes=JSON.stringify(value,null,2)+'\n';await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});
  return {...timing,proof:{file:path.relative(base,file),sha256:hash(bytes)}};
}
export function validateLocalTiming(record){
  if(!record.timing)return; // Historical originals keep their original protocol.
  const {proof,...timing}=record.timing;validateInterval(timing);
  if(record.durationMs!==timing.durationMs||record.startedAt!==timing.start.observedAt||record.finishedAt!==timing.end.observedAt)throw Error('Elapsed duration differs from its monotonic timer boundaries');
  if(record.kind==='deploy'&&record.readiness?.verified&&record.readiness.observations?.some(o=>!ns(o.observedMonotonicNs)||BigInt(o.observedMonotonicNs)<BigInt(timing.start.monotonicNs)||BigInt(o.observedMonotonicNs)>BigInt(timing.end.monotonicNs)))throw Error('Business readiness lies outside its observed monotonic interval');
  if(record.operationTiming&&(record.operationTiming.clock!==timing.clock||record.operationTiming.startNs!==timing.start.monotonicNs||record.operationTiming.endNs!==timing.end.monotonicNs))throw Error('Matched build envelope differs from the local operation clock');
  if(!proof?.file||!/^[a-f0-9]{64}$/.test(proof.sha256||'')||!record.evidence?.some(e=>isDeepStrictEqual(e,proof)))throw Error('Local timing needs its immutable clock evidence');
}
export async function verifyImportedClock(record,{base}){
  if(!record.timing)return;
  if(record.status==='passed')validateLocalTiming(record);
  const {proof,...timing}=record.timing;
  if(!proof?.file)throw Error('Imported local timing is missing its clock proof');
  const bytes=await readFile(path.resolve(base,proof.file));
  if(hash(bytes)!==proof.sha256)throw Error('Local clock proof checksum mismatch');
  const saved=JSON.parse(bytes);
  if(!isDeepStrictEqual(saved,{schemaVersion:1,identity:Object.fromEntries(keys.map(k=>[k,record[k]])),timing}))throw Error('Imported timing differs from its original clock observations/identity');
}

import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {mkdtemp,writeFile,readFile,copyFile,rm,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {collectArtifacts,verifyImportedLambda} from './sizes.mjs';
import {sha256,validateRecord} from './lib.mjs';
const dir=await mkdtemp(path.join(os.tmpdir(),'lambda-upload-size-'));
try {
 const made=spawnSync('python3',['-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('bundle.mjs','export function handler(){return {revision:\"new\"}}'); z.close()",path.join(dir,'report.zip')],{encoding:'utf8'});assert.equal(made.status,0,made.stderr);
 await writeFile(path.join(dir,'bundle.mjs.map'),JSON.stringify({version:3,sources:['app/report.mjs'],sourcesContent:['export function handler(){}'],names:['handler'],mappings:'AAAA'}));
 const spec={qualified:true,format:'lambda-zip',functionCount:1,files:[{name:'report',role:'function',path:'report.zip'},{name:'report',role:'source-map',path:'bundle.mjs.map',uploadedSeparately:true}]};
 const collected=await collectArtifacts(spec,dir);
 assert.equal(collected.bytes,collected.codeBytes+collected.sourceMapBytes);assert.equal(collected.zipBytes,collected.codeBytes);assert.equal(collected.sourceMapBytes,(await readFile(path.join(dir,'bundle.mjs.map'))).length);
 assert.equal(collected.files[1].sourceMap.version,3);
 const onlyCode=await collectArtifacts({...spec,files:[spec.files[0]]},dir);assert.equal(onlyCode.bytes,onlyCode.codeBytes);assert.equal(onlyCode.sourceMapBytes,0);
 await assert.rejects(collectArtifacts({...spec,files:[...spec.files,spec.files[1]]},dir),/counted twice/);
 await assert.rejects(collectArtifacts({...spec,files:[spec.files[0],{...spec.files[1],name:'other-function'}]},dir),/selected functions/);
 await assert.rejects(collectArtifacts({...spec,files:[spec.files[0],{...spec.files[1],uploadedSeparately:false}]},dir),/separately uploaded/);
 await assert.rejects(collectArtifacts({...spec,files:[spec.files[0],{...spec.files[1],bytes:1}]},dir),/checksum or size/);
 await writeFile(path.join(dir,'invalid.map'),'not a source map');await assert.rejects(collectArtifacts({...spec,files:[spec.files[0],{...spec.files[1],path:'invalid.map'}]},dir),/version 3 JSON/);
 await writeFile(path.join(dir,'invalid.map'),JSON.stringify({version:2,sources:[],names:[],mappings:''}));await assert.rejects(collectArtifacts({...spec,files:[spec.files[0],{...spec.files[1],path:'invalid.map'}]},dir),/version 3 JSON/);
 const cacheEvidence={runId:'upload-001',scenario:'package-lambda-1',provider:'sst',appId:'native-app',sourceCommit:'a'.repeat(40),series:'clean',proofFile:'cache.json',proofSHA:'b'.repeat(64)};
 const artifact={...collected,businessVerification:{completeZipBusinessProbes:[{name:'report',revision:'new'}]}};
 const evidence=[{file:cacheEvidence.proofFile,sha256:cacheEvidence.proofSHA}];
 for(const file of artifact.files){file.evidenceFile='retained-'+path.basename(file.path);await copyFile(path.join(dir,file.path),path.join(dir,file.evidenceFile));evidence.push({file:file.evidenceFile,sha256:file.sha256});}
 const record={schemaVersion:1,kind:'package',status:'passed',scenario:'package-lambda-1',provider:'sst',runId:cacheEvidence.runId,appId:cacheEvidence.appId,sourceCommit:cacheEvidence.sourceCommit,startedAt:'2026-10-13T10:00:00.000Z',finishedAt:'2026-10-13T10:00:01.000Z',durationMs:1000,toolVersion:{reported:'4.17.2'},environment:{region:'eu-west-1'},cacheEvidence,artifacts:artifact,evidence};
 validateRecord(record);assert.equal((await verifyImportedLambda(record,{base:dir})).bytes,collected.bytes);
 assert.throws(()=>validateRecord({...record,artifacts:{...artifact,bytes:artifact.codeBytes}}),/upload total/);
 assert.throws(()=>validateRecord({...record,artifacts:{...artifact,files:[artifact.files[0]],bytes:artifact.codeBytes,sourceMapBytes:0}}),/every separately uploaded/);
 await assert.rejects(verifyImportedLambda({...record,artifacts:{...artifact,bytes:1}},{base:dir}),/summary differs/);
 await writeFile(path.join(dir,artifact.files[1].evidenceFile),'{}');await assert.rejects(verifyImportedLambda(record,{base:dir}),/checksum or size/);
 // A dynamic native binding proof must survive import with the exact current descriptors and source identity.
 const metadata={provider:'sst',runId:'dynamic-001',sourceCommit:'c'.repeat(40),startedAt:new Date(Date.now()-60000).toISOString(),commandFinishedAt:new Date(Date.now()+1000).toISOString()};
 const nativeFiles=await Promise.all(spec.files.map(async f=>({...f,...(f.role==='function'?{handler:'bundle.handler',module:'bundle.mjs'}:{}),bytes:(await stat(path.join(dir,f.path))).size,mtimeMs:(await stat(path.join(dir,f.path))).mtimeMs,sha256:await sha256(path.join(dir,f.path))})));
 const native={schemaVersion:1,...metadata,functionCount:1,files:nativeFiles};
 const dynamic=await collectArtifacts({...spec,files:nativeFiles,nativeManifest:{argv:['readonly-native-observer']}},dir,{...metadata,runCommand:async()=>({exitCode:0,stdout:JSON.stringify(native)})});
 const dynamicEvidence=[{file:'dynamic-cache.json',sha256:'d'.repeat(64)}];
 for(const file of [...dynamic.files,...dynamic.proofs]){file.evidenceFile='dynamic-'+path.basename(file.path);await copyFile(path.join(dir,file.path),path.join(dir,file.evidenceFile));dynamicEvidence.push({file:file.evidenceFile,sha256:file.sha256});}
 dynamic.businessVerification=artifact.businessVerification;
 const dynamicRecord={...record,...metadata,finishedAt:metadata.commandFinishedAt,durationMs:Date.parse(metadata.commandFinishedAt)-Date.parse(metadata.startedAt),artifacts:dynamic,cacheEvidence:{...cacheEvidence,...metadata,proofFile:'dynamic-cache.json',proofSHA:'d'.repeat(64)},evidence:dynamicEvidence};
 validateRecord(dynamicRecord);await verifyImportedLambda(dynamicRecord,{base:dir});
 await assert.rejects(verifyImportedLambda({...dynamicRecord,sourceCommit:'e'.repeat(40)},{base:dir}),/current sourceCommit/);
 await assert.rejects(verifyImportedLambda({...dynamicRecord,artifacts:{...dynamic,nativeManifest:{...native,provider:'other'}}},{base:dir}),/retained raw manifest/);
 // No duplicate standalone map for a candidate whose map is already inside its code ZIP.
 const candidate={...record,provider:'candidate',cacheEvidence:{...cacheEvidence,provider:'candidate'},artifacts:{...onlyCode,businessVerification:artifact.businessVerification,files:[artifact.files[0]]}};
 validateRecord(candidate);assert.equal((await verifyImportedLambda(candidate,{base:dir})).sourceMapBytes,0);
 console.log('Lambda upload totals, raw source-map JSON proof, required SST maps, missing/duplicate/forged artifact rejection passed. No cloud requests.');
} finally {await rm(dir,{recursive:true,force:true});}

import {stat,readFile,realpath,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256,command,root} from './lib.mjs';
import {readCompressedImage,compressedImage} from './oci-size.mjs';
import {createHash} from 'node:crypto';
async function insideFile(cwd,file) {
  if(typeof file!=='string'||!file)throw Error('Artifact needs a file path');
  const target=await realpath(path.resolve(cwd,file)),relative=path.relative(cwd,target);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Artifact is outside the generated project');
  const info=await stat(target);if(!info.isFile())throw Error('Artifact must be a file');return {target,relative,info};
}
async function collectOci(spec,cwd,attempt) {
  if(spec.qualified!==true||!Array.isArray(spec.images)||spec.images.length!==1||!spec.nativeBuild)throw Error('A qualified complete OCI artifact manifest and current native build identity are required');
  if(!/^[a-f0-9]{40}$/.test(attempt.sourceCommit||'')||!attempt.runId||!attempt.provider||!Number.isFinite(Date.parse(attempt.startedAt))||!Number.isFinite(Date.parse(attempt.commandFinishedAt)))throw Error('OCI collection needs the current attempt source, run, provider and timer boundaries');
  const image=spec.images[0];if(!/^[a-z][a-z0-9-]*$/.test(image.name||''))throw Error('OCI image needs its selected component name');
  const start=Date.parse(attempt.startedAt),finish=Date.parse(attempt.commandFinishedAt);if(finish<start)throw Error('Invalid native build timer boundaries');
  const runCommand=attempt.runCommand||command;
  let proofRaw,identityFile;
  if(Boolean(spec.nativeBuild.file)===Boolean(spec.nativeBuild.argv))throw Error('Select exactly one native build identity file or observer argv');
  if(spec.nativeBuild.file) {
    identityFile=await insideFile(cwd,spec.nativeBuild.file);
    if(identityFile.info.mtimeMs+1<start||identityFile.info.mtimeMs>finish+1)throw Error('Native build identity file was not written during this attempt');
    proofRaw=await readFile(identityFile.target,'utf8');
  } else {
    const argv=spec.nativeBuild.argv;if(!Array.isArray(argv)||!argv.length||argv.some(v=>typeof v!=='string'||!v))throw Error('Native identity observer requires argv strings');
    const observed=await runCommand(argv,{cwd,env:{BENCH_SOURCE_COMMIT:attempt.sourceCommit,BENCH_RUN_ID:attempt.runId,BENCH_PROVIDER:attempt.provider}});
    if(observed.exitCode!==0)throw Error('Current native build identity observer failed');proofRaw=observed.stdout;
  }
  const native=JSON.parse(proofRaw);
  if(native.sourceCommit!==attempt.sourceCommit||native.runId!==attempt.runId||native.provider!==attempt.provider)throw Error('Native build identity differs from this source, run or provider');
  const entries=native.images?.filter(v=>(v.name||v.service)===image.name);if(entries?.length!==1||!/^sha256:[a-f0-9]{64}$/.test(entries[0].imageId||''))throw Error('Missing one current native built image config identity');
  const current=entries[0],manifestPath=image.manifestPath?(await insideFile(cwd,image.manifestPath)).target:undefined;
  const reference=image.reference||(!manifestPath&&(current.reference||current.registryReference));
  const {record,raw,indexRaw}=await readCompressedImage({manifestPath,reference,expectedDigest:image.expectedDigest,expectedConfigDigest:current.imageId,platform:spec.platform},{runCommand});
  const output=await mkdtemp(path.join(cwd,'artifact-size-'));
  const files=[];
  async function retain(filename,contents,role) {
    const file=path.join(output,filename);await writeFile(file,contents,{flag:'wx'});
    files.push({name:image.name,role,path:path.relative(cwd,file),bytes:Buffer.byteLength(contents),sha256:await sha256(file)});
  }
  await retain('image-manifest.json',raw,'image-manifest');if(indexRaw)await retain('image-index.json',indexRaw,'image-index');
  await retain('native-build.json',proofRaw,'native-build-identity');
  const nativeBuild={sourceCommit:native.sourceCommit,runId:native.runId,provider:native.provider,imageId:current.imageId,observedAt:new Date().toISOString(),...identityFile&&{originalFile:identityFile.relative}};
  return {...record,name:image.name,files,nativeBuild};
}
export async function collectArtifacts(spec,cwd,attempt={}) {
  const realCwd=await realpath(cwd);
  if(spec?.format==='oci-compressed')return collectOci(spec,realCwd,attempt);
  if(!spec||spec.qualified!==true||!['lambda-zip','heroku-slug'].includes(spec.format)||!Array.isArray(spec.files)||!spec.files.length) throw Error('A qualified complete artifact manifest is required');
  const files=[];const seen=new Set();const layers=new Set();
  for(const item of spec.files) { const file=await realpath(path.resolve(cwd,item.path));const relative=path.relative(realCwd,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Artifact is outside the generated project');if(seen.has(file)) throw Error('Artifact counted twice: '+file); seen.add(file); const info=await stat(file); if(!info.isFile()) throw Error('Artifact must be a file'); if(spec.format==='lambda-zip') {const magic=(await readFile(file)).subarray(0,4); if(!magic.equals(Buffer.from([0x50,0x4b,0x03,0x04]))) throw Error('Expected actual ZIP file: '+file);} const digest=await sha256(file);if(item.role==='layer'){if(layers.has(digest))throw Error('Shared layer counted twice');layers.add(digest);}files.push({role:item.role||'function',name:item.name,path:relative,bytes:info.size,sha256:digest}); }
  if(spec.format==='lambda-zip'&&files.filter(f=>f.role==='function').length!==spec.functionCount) throw Error('Missing complete per-function ZIPs');
  return {complete:true,format:spec.format,bytes:files.reduce((sum,f)=>sum+f.bytes,0),files,layersCountedOnce:true};
}
export async function verifyImportedOci(record,{base=root}={}) {
  const artifacts=record.artifacts;
  if(record.kind!=='package'||record.status!=='passed'||artifacts?.format!=='oci-compressed'||artifacts.complete!==true||artifacts.name!=='api')throw Error('OCI import requires a passed single-API packaging record');
  if(!Array.isArray(artifacts.files)||!Array.isArray(record.evidence))throw Error('OCI import requires retained raw manifest and native build proof');
  const basePath=await realpath(base),proofs=new Map(),paths=new Set();
  for(const file of artifacts.files) {
    if(!['image-manifest','image-index','native-build-identity'].includes(file.role)||proofs.has(file.role)||file.name!==artifacts.name)throw Error('Invalid or repeated OCI raw proof role');
    if(typeof file.evidenceFile!=='string'||!file.evidenceFile||path.isAbsolute(file.evidenceFile)||file.evidenceFile.split(/[\\/]/).includes('..')||!/^[a-f0-9]{64}$/.test(file.sha256||''))throw Error('OCI raw proof needs its root-relative evidenceFile and SHA256');
    const matches=record.evidence.filter(e=>e.file===file.evidenceFile&&e.sha256===file.sha256);
    if(matches.length!==1)throw Error('OCI raw proof is not bound to its exact result evidence path and hash');
    const retained=await insideFile(basePath,file.evidenceFile);
    if(paths.has(retained.target))throw Error('OCI raw proof file counted twice');paths.add(retained.target);
    if(await sha256(retained.target)!==file.sha256||file.bytes!==retained.info.size)throw Error('OCI retained raw proof checksum or size differs');
    proofs.set(file.role,await readFile(retained.target,'utf8'));
  }
  if(!proofs.has('image-manifest')||!proofs.has('native-build-identity'))throw Error('OCI import requires retained raw manifest and native build proof');
  const raw=proofs.get('image-manifest'),manifest=JSON.parse(raw),computed=compressedImage(manifest,raw);
  const ordered=blobs=>blobs.map(b=>({digest:b.digest,size:b.size,mediaType:b.mediaType})).sort((a,b)=>a.digest.localeCompare(b.digest));
  if(artifacts.manifestDigest!==computed.manifestDigest||artifacts.bytes!==computed.bytes||!Array.isArray(artifacts.blobs)||JSON.stringify(ordered(artifacts.blobs))!==JSON.stringify(ordered(computed.blobs)))throw Error('OCI summary differs from its retained compressed manifest');
  if(!['linux/amd64','linux/arm64'].includes(artifacts.platform))throw Error('OCI import needs its selected runnable platform');
  if(Boolean(artifacts.sourceIndexDigest)!==proofs.has('image-index'))throw Error('OCI index proof and summary must be retained together');
  if(proofs.has('image-index')) {
    const indexRaw=proofs.get('image-index'),index=JSON.parse(indexRaw),indexDigest='sha256:'+createHash('sha256').update(indexRaw).digest('hex');
    const [os,architecture]=artifacts.platform.split('/');
    const selected=index.manifests?.filter(m=>m.platform?.os===os&&m.platform?.architecture===architecture);
    if(index.schemaVersion!==2||indexDigest!==artifacts.sourceIndexDigest||selected?.length!==1||selected[0].digest!==computed.manifestDigest||selected[0].size!==Buffer.byteLength(raw))throw Error('OCI retained index does not select this runnable platform manifest');
  }
  const native=JSON.parse(proofs.get('native-build-identity')),bound=artifacts.nativeBuild;
  const selected=native.images?.filter(v=>(v.name||v.service)===artifacts.name);
  if(!/^[a-f0-9]{40}$/.test(record.sourceCommit||'')||!record.runId||!record.provider||!bound||selected?.length!==1)throw Error('OCI import needs the current native image identity');
  for(const key of ['sourceCommit','runId','provider'])if(native[key]!==record[key]||bound[key]!==native[key])throw Error('OCI retained native proof differs from this source, run or provider');
  if(selected[0].imageId!==manifest.config.digest||bound.imageId!==selected[0].imageId)throw Error('OCI retained native identity does not match the manifest config');
  return {verified:true,sourceCommit:native.sourceCommit,runId:native.runId,provider:native.provider,imageId:selected[0].imageId,manifestDigest:computed.manifestDigest};
}

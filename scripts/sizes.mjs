import {stat,readFile,realpath,mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {sha256,command} from './lib.mjs';
import {readCompressedImage} from './oci-size.mjs';
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

import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs,command} from './lib.mjs';
const digestPattern=/^sha256:[a-f0-9]{64}$/;
const manifestDigest=raw=>'sha256:'+createHash('sha256').update(raw).digest('hex');
const configTypes=new Set(['application/vnd.oci.image.config.v1+json','application/vnd.docker.container.image.v1+json']);
const layerTypes=new Set(['application/vnd.oci.image.layer.v1.tar+gzip','application/vnd.oci.image.layer.v1.tar+zstd','application/vnd.oci.image.layer.nondistributable.v1.tar+gzip','application/vnd.oci.image.layer.nondistributable.v1.tar+zstd','application/vnd.docker.image.rootfs.diff.tar.gzip','application/vnd.docker.image.rootfs.foreign.diff.tar.gzip']);
export function compressedImage(manifest,raw) {
 if(manifest.manifests)throw Error('Select the runnable platform manifest first; do not count attestations or another architecture');
 if(manifest.schemaVersion!==2||!manifest.config||!configTypes.has(manifest.config.mediaType)||!Array.isArray(manifest.layers)||!manifest.layers.length)throw Error('Incomplete OCI/Docker image manifest');
 if(manifest.layers.some(l=>!layerTypes.has(l.mediaType)))throw Error('The layer manifest does not describe compressed image blobs');
 if(JSON.stringify(JSON.parse(raw))!==JSON.stringify(manifest))throw Error('Raw manifest bytes differ from the parsed manifest');
 const map=new Map();for(const blob of [manifest.config,...manifest.layers]){if(!digestPattern.test(blob.digest)||!Number.isSafeInteger(blob.size)||blob.size<=0)throw Error('Invalid blob digest or size');if(map.has(blob.digest)&&(map.get(blob.digest).size!==blob.size||map.get(blob.digest).mediaType!==blob.mediaType))throw Error('Conflicting digest sizes or media types');map.set(blob.digest,{digest:blob.digest,size:blob.size,mediaType:blob.mediaType});}
 const blobs=[...map.values()],bytes=blobs.reduce((sum,b)=>sum+b.size,0);if(!Number.isSafeInteger(bytes))throw Error('Compressed size exceeds the supported integer range');
 return {complete:true,format:'oci-compressed',bytes,manifestDigest:manifestDigest(raw),blobs,scope:'one runnable platform image; unique config and compressed layer blobs; no attestations or manifest envelope bytes'};
}
export async function readCompressedImage({manifestPath,reference,expectedDigest,expectedConfigDigest,platform='linux/amd64'},{runCommand=command}={}) {
 if(!['linux/amd64','linux/arm64'].includes(platform))throw Error('Select linux/amd64 or linux/arm64');
 if(!expectedDigest&&!expectedConfigDigest||expectedDigest&&!digestPattern.test(expectedDigest)||expectedConfigDigest&&!digestPattern.test(expectedConfigDigest))throw Error('Supply the qualified runnable expectedDigest or current build expectedConfigDigest');
 if(Boolean(manifestPath)===Boolean(reference))throw Error('Supply exactly one local manifestPath or immutable registry reference');
 let raw,indexRaw,indexDigest;
 if(manifestPath)raw=await readFile(manifestPath,'utf8');
 else {
  if(!/^[a-zA-Z0-9./:_-]+(?:@sha256:[a-f0-9]{64})?$/.test(reference)||!reference.includes('@')&&!expectedConfigDigest)throw Error('Registry references must be digest-pinned or bound to the current native build config, without credentials');
  const result=await runCommand(['docker','buildx','imagetools','inspect',reference,'--raw']);if(result.exitCode!==0)throw Error('Registry manifest read failed');raw=result.stdout;
  if(reference.includes('@')&&manifestDigest(raw)!==reference.slice(reference.lastIndexOf('@')+1))throw Error('Registry response differs from its pinned manifest digest');
 }
 let manifest=JSON.parse(raw);
 if(manifest.manifests) {
  if(!reference)throw Error('Local input is an image index. Supply the selected runnable child manifest instead');
  if(manifest.schemaVersion!==2)throw Error('Invalid image index');
  const [os,architecture]=platform.split('/');const matches=manifest.manifests.filter(m=>m.platform?.os===os&&m.platform?.architecture===architecture);
  if(matches.length!==1||!digestPattern.test(matches[0].digest)||!Number.isSafeInteger(matches[0].size)||matches[0].size<=0)throw Error('Cannot select one runnable platform image');
  indexRaw=raw;indexDigest=manifestDigest(raw);const repo=reference.split('@')[0].replace(/:[^/:]+$/,'');
  const child=await runCommand(['docker','buildx','imagetools','inspect',repo+'@'+matches[0].digest,'--raw']);if(child.exitCode!==0)throw Error('Platform manifest read failed');raw=child.stdout;
  if(manifestDigest(raw)!==matches[0].digest||Buffer.byteLength(raw)!==matches[0].size)throw Error('Platform manifest digest or size mismatch');manifest=JSON.parse(raw);
 }
 const record={...compressedImage(manifest,raw),platform,...reference&&{sourceReference:reference,reference:reference.split('@')[0].replace(/:[^/:]+$/,'')+'@'+manifestDigest(raw)},...indexDigest&&{sourceIndexDigest:indexDigest}};
 if(expectedDigest&&record.manifestDigest!==expectedDigest)throw Error('Manifest differs from the qualified runnable image digest');
 if(expectedConfigDigest&&manifest.config.digest!==expectedConfigDigest)throw Error('Manifest config differs from the current native build image identity');
 return {record,raw,indexRaw};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 try{const {flags}=parseArgs(process.argv.slice(2));if(!flags.output)throw Error('Supply --output DIRECTORY to retain evidence');
  const {record,raw,indexRaw}=await readCompressedImage({manifestPath:flags.manifest,reference:flags.image,expectedDigest:flags['expected-digest'],expectedConfigDigest:flags['expected-config-digest'],platform:flags.platform});
  await mkdir(flags.output,{recursive:true});await writeFile(path.join(flags.output,'image-manifest.json'),raw);if(indexRaw)await writeFile(path.join(flags.output,'image-index.json'),indexRaw);await writeFile(path.join(flags.output,'size.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record,null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}
}

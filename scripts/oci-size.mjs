import {createHash} from 'node:crypto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs,command} from './lib.mjs';
export function compressedImage(manifest,raw) {
 if(manifest.manifests)throw Error('Select the runnable platform manifest first; do not count attestations or another architecture');
 if(!manifest.config||!Array.isArray(manifest.layers)||!manifest.layers.length)throw Error('Incomplete OCI/Docker image manifest');
 if(manifest.layers.some(l=>!/(gzip|zstd)$/.test(l.mediaType||'')))throw Error('The layer manifest does not describe compressed image blobs');
 const map=new Map();for(const blob of [manifest.config,...manifest.layers]){if(!/^sha256:[a-f0-9]{64}$/.test(blob.digest)||!Number.isSafeInteger(blob.size)||blob.size<=0)throw Error('Invalid blob digest or size');if(map.has(blob.digest)&&map.get(blob.digest).size!==blob.size)throw Error('Conflicting digest sizes');map.set(blob.digest,{digest:blob.digest,size:blob.size,mediaType:blob.mediaType});}
 const blobs=[...map.values()];return {complete:true,format:'oci-compressed',bytes:blobs.reduce((sum,b)=>sum+b.size,0),manifestDigest:'sha256:'+createHash('sha256').update(raw).digest('hex'),blobs,scope:'one runnable platform image; unique config and compressed layer blobs; no attestations'};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 try{const {flags}=parseArgs(process.argv.slice(2));const platform=flags.platform||'linux/amd64';if(!['linux/amd64','linux/arm64'].includes(platform))throw Error('Select linux/amd64 or linux/arm64');let raw,reference=flags.image;
  if(flags.manifest)raw=await readFile(flags.manifest,'utf8');else{if(!reference||!/^[a-zA-Z0-9./:@_-]+$/.test(reference))throw Error('Supply --manifest FILE or --image QUALIFIED_REGISTRY_REFERENCE');const result=await command(['docker','buildx','imagetools','inspect',reference,'--raw']);if(result.exitCode!==0)throw Error('Registry manifest read failed');raw=result.stdout;}
  let manifest=JSON.parse(raw);const [os,architecture]=platform.split('/');
  if(manifest.manifests){if(!reference)throw Error('Local input is an image index. Supply the selected runnable child manifest instead');const matches=manifest.manifests.filter(m=>m.platform?.os===os&&m.platform?.architecture===architecture);if(matches.length!==1)throw Error('Cannot select one runnable platform image');const repo=reference.replace(/@[^@]+$/,'').replace(/:[^/:]+$/,'');const child=await command(['docker','buildx','imagetools','inspect',repo+'@'+matches[0].digest,'--raw']);if(child.exitCode!==0)throw Error('Platform manifest read failed');raw=child.stdout;manifest=JSON.parse(raw);if('sha256:'+createHash('sha256').update(raw).digest('hex')!==matches[0].digest)throw Error('Manifest digest mismatch');}
  const record={...compressedImage(manifest,raw),platform,reference};if(flags['expected-digest']&&record.manifestDigest!==flags['expected-digest'])throw Error('Manifest differs from the qualified deployed digest');if(!flags.output)throw Error('Supply --output DIRECTORY to retain evidence');await mkdir(flags.output,{recursive:true});await writeFile(path.join(flags.output,'image-manifest.json'),raw);await writeFile(path.join(flags.output,'size.json'),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record,null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}
}

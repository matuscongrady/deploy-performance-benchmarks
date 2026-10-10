import {stat,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {sha256} from './lib.mjs';
export async function collectArtifacts(spec,cwd) {
  if(!spec||spec.qualified!==true||!['lambda-zip','heroku-slug'].includes(spec.format)||!Array.isArray(spec.files)||!spec.files.length) throw Error('A qualified complete artifact manifest is required');
  const files=[];const seen=new Set();const layers=new Set();const realCwd=await realpath(cwd);
  for(const item of spec.files) { const file=await realpath(path.resolve(cwd,item.path));const relative=path.relative(realCwd,file);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Artifact is outside the generated project');if(seen.has(file)) throw Error('Artifact counted twice: '+file); seen.add(file); const info=await stat(file); if(!info.isFile()) throw Error('Artifact must be a file'); if(spec.format==='lambda-zip') {const magic=(await readFile(file)).subarray(0,4); if(!magic.equals(Buffer.from([0x50,0x4b,0x03,0x04]))) throw Error('Expected actual ZIP file: '+file);} const digest=await sha256(file);if(item.role==='layer'){if(layers.has(digest))throw Error('Shared layer counted twice');layers.add(digest);}files.push({role:item.role||'function',name:item.name,path:relative,bytes:info.size,sha256:digest}); }
  if(spec.format==='lambda-zip'&&files.filter(f=>f.role==='function').length!==spec.functionCount) throw Error('Missing complete per-function ZIPs');
  return {complete:true,format:spec.format,bytes:files.reduce((sum,f)=>sum+f.bytes,0),files,layersCountedOnce:true};
}

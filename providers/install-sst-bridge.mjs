import {mkdir,readFile,writeFile,cp,access,rm} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const own=dirname(fileURLToPath(import.meta.url)),root=resolve(own,'..');
const cache=join(root,'.work/sst-native'),source=join(cache,'source');
const sourceSha='85fd0141a6b4a1b24c365b524b8997b2d3d9e7d2345bfb42d82375d1dd24cb37';
const url='https://codeload.github.com/anomalyco/sst/tar.gz/refs/tags/v4.17.2';
const goImage='golang:1.24.7-bookworm@sha256:b8bae5bd9ba9b1f89b635c91c24cc75cea335a16fb5076310f38566fc674b1ec';
await mkdir(cache,{recursive:true});
const archive=join(cache,'upstream.tar.gz');
let bytes;try{bytes=await readFile(archive);}catch{const res=await fetch(url);if(!res.ok)throw Error('Cannot download pinned SST source');bytes=Buffer.from(await res.arrayBuffer());await writeFile(archive,bytes);}
if(createHash('sha256').update(bytes).digest('hex')!==sourceSha)throw Error('Pinned SST source checksum mismatch');
const helperSha=createHash('sha256').update(await readFile(join(own,'sst-native-main.go'))).digest('hex');
let old;try{old=JSON.parse(await readFile(join(cache,'bridge.json'),'utf8'));}catch{}
if(old?.sourceSha===sourceSha && old?.helperSha===helperSha){try{await access(join(source,'native-package'));if(createHash('sha256').update(await readFile(join(source,'native-package'))).digest('hex')!==old.binarySha)throw Error('Compiled SST bridge checksum mismatch');await cp(join(source,'LICENSE'),join(cache,'SST-LICENSE'));console.log('Pinned SST native bridge already compiled');process.exit(0);}catch{}}
await rm(source,{recursive:true,force:true});await mkdir(source,{recursive:true});
run('tar',['-xzf',archive,'--strip-components=1','-C',source]);
await mkdir(join(source,'cmd/benchmark-package'),{recursive:true});await cp(join(own,'sst-native-main.go'),join(source,'cmd/benchmark-package/main.go'));
await mkdir(join(cache,'go-mod'),{recursive:true});await mkdir(join(cache,'go-build'),{recursive:true});
run('docker',['run','--rm','--user',`${process.getuid()}:${process.getgid()}`,'-e','CGO_ENABLED=0','-e','HOME=/tmp','-e','GOCACHE=/cache-build','-v',`${source}:/src`,'-v',`${join(cache,'go-mod')}:/go/pkg/mod`,'-v',`${join(cache,'go-build')}:/cache-build`,'-w','/src',goImage,'go','build','-mod=readonly','-o','/src/native-package','./cmd/benchmark-package']);
// Keep the complete archive body from the exact release; do not substitute a custom ZIP recipe.
const text=await readFile(join(source,'platform/src/components/aws/function.ts'),'utf8');
const start=text.indexOf('await new Promise(async (resolve, reject) => {',text.indexOf('function createCode('));
const end=text.indexOf('const hash = crypto.createHash("sha256");',start);
if(start<0||end<0)throw Error('Pinned SST archive implementation changed');
await writeFile(join(cache,'archive-body.js'),text.slice(start,end));
await cp(join(source,'LICENSE'),join(cache,'SST-LICENSE'));

await writeFile(join(cache,'bridge.json'),JSON.stringify({version:'4.17.2',sourceSha,helperSha,goImage,binarySha:createHash('sha256').update(await readFile(join(source,'native-package'))).digest('hex'),archiveBodySha:createHash('sha256').update(text.slice(start,end)).digest('hex')},null,2)+'\n');
console.log('Compiled pinned native SST runtime and captured its archive implementation');
function run(bin,args){const p=spawnSync(bin,args,{stdio:'inherit'});if(p.status!==0)throw Error(`${bin} failed`);}

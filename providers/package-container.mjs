import {spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const [provider,identity]=process.argv.slice(2);
if(!['sst','cdk'].includes(provider) || !/^[a-z][a-z0-9-]+$/.test(identity || ''))throw new Error('Usage: node package-container.mjs sst|cdk NEUTRAL_IDENTITY');
const capture=resolve('package-artifacts');await mkdir(capture,{recursive:true});
const services=(await readdir('app',{withFileTypes:true})).filter(x=>x.isDirectory()).map(x=>x.name);
const images=[];
for(const service of services){
 const context=resolve('app',service),dockerfile=join(context,`Dockerfile.${provider}`);
 const source=await readFile(dockerfile);const tag=`${identity}-${service}:package`;
 const noCache=process.env.BENCH_DOCKER_NO_CACHE==='1';
 const args=['build',...(noCache?['--no-cache']:[]),'--platform','linux/amd64','--file',dockerfile,'--tag',tag,context];
 const p=spawnSync('docker',args,{stdio:'inherit'});if(p.status!==0)throw new Error(`Native Docker build failed for ${service}`);
 const inspect=spawnSync('docker',['image','inspect',tag,'--format','{{json .Id}}'],{encoding:'utf8'});if(inspect.status!==0)throw new Error('Cannot capture built image identity');
 images.push({service,tag,imageId:JSON.parse(inspect.stdout),dockerfileSha256:createHash('sha256').update(source).digest('hex'),command:['docker',...args],cachePolicy:noCache?'no-cache':'native-cache',compressedBytes:null});
}
await writeFile(join(capture,'manifest.json'),JSON.stringify({provider,sourceCommit:process.env.BENCH_SOURCE_COMMIT,runId:process.env.BENCH_RUN_ID,method:'diagnostic Docker image-build phase using generated provider-owned recipe; not itself proof of native SST/CDK invocation parity',qualificationRequired:true,requiresParityWithNativeDeployment:true,images,compressedBytes:null,sizeReason:'Read compressed OCI bytes from the qualified registry image after timing. Local unpacked image size and docker-save tar size are not substitutes.'},null,2)+'\n');
console.log(JSON.stringify({provider,images:images.length,sizeAvailable:false}));

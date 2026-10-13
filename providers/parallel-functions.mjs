import {spawn} from 'node:child_process';
import {cp,mkdir,symlink,lstat,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
const [executable,stage,region,...functions]=process.argv.slice(2);
const concurrency=Number(process.env.BENCH_FUNCTION_CONCURRENCY || '8');
if(!executable || !/^[a-z][a-z0-9-]+$/.test(stage ?? '') || !/^[a-z]{2}-[a-z]+-\d$/.test(region ?? '') || !functions.length || functions.some(v=>!/^[a-z][a-z0-9-]+$/.test(v)) || !Number.isInteger(concurrency) || concurrency<1 || concurrency>32) throw new Error('Usage: node parallel-functions.mjs EXECUTABLE STAGE REGION FUNCTION...; concurrency 1–32');
const source=process.cwd();
const nativeExecutable=executable.includes('/')?resolve(executable):executable;
const contexts=join(source,'.parallel-functions');
if((await lstat(contexts).catch(()=>null))?.isSymbolicLink())throw Error('Native function contexts must be an owned directory');
await mkdir(contexts,{recursive:true});
for(const name of functions){
 const cwd=join(contexts,name);
 if((await lstat(cwd).catch(()=>null))?.isSymbolicLink())throw Error('Native function context must not be a link');
 await mkdir(cwd,{recursive:true});
 // Preserve only native install/build state; remove stale source inputs.
 for(const entry of await readdir(cwd))if(!['.serverless','node_modules'].includes(entry))await rm(join(cwd,entry),{recursive:true,force:true});
 for(const entry of await readdir(source)) {
  if(['.parallel-functions','.serverless','.git','node_modules','.work','.sst','cdk.out','package-artifacts'].includes(entry))continue;
  await cp(join(source,entry),join(cwd,entry),{recursive:true,filter:p=>!['node_modules','.git'].some(v=>p.slice(source.length).split('/').includes(v))});
 }
 for(const relative of ['node_modules','app/node_modules']){const origin=join(source,relative);if(await lstat(origin).catch(()=>null)){const target=join(cwd,relative);if(!(await lstat(target).catch(()=>null)))await symlink(origin,target,'dir');}}
}
let next=0;
const results=[];
async function worker(){
 while(next<functions.length){
  const name=functions[next++];
  const result=await new Promise(resolve=>{
   const child=spawn(nativeExecutable,['deploy','function','--function',name,'--stage',stage,'--region',region],{stdio:'inherit',cwd:join(contexts,name)});
   child.on('error',()=>resolve({function:name,success:false,error:'spawn-failed'}));
   child.on('close',code=>resolve({function:name,success:code===0,exitCode:code}));
  });
  results.push(result);
 }
}
await Promise.all(Array.from({length:Math.min(concurrency,functions.length)},worker));
console.log(JSON.stringify({concurrency,functions:results}));
if(results.some(r=>!r.success))process.exitCode=1;

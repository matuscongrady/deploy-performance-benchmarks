import {spawn} from 'node:child_process';
import {cp,mkdir,symlink,lstat,mkdtemp} from 'node:fs/promises';
import {join,dirname,basename,resolve} from 'node:path';
const [executable,stage,region,...functions]=process.argv.slice(2);
const concurrency=Number(process.env.BENCH_FUNCTION_CONCURRENCY || '8');
if(!executable || !/^[a-z][a-z0-9-]+$/.test(stage ?? '') || !/^[a-z]{2}-[a-z]+-\d$/.test(region ?? '') || !functions.length || functions.some(v=>!/^[a-z][a-z0-9-]+$/.test(v)) || !Number.isInteger(concurrency) || concurrency<1 || concurrency>32) throw new Error('Usage: node parallel-functions.mjs EXECUTABLE STAGE REGION FUNCTION...; concurrency 1–32');
const source=process.cwd();
const nativeExecutable=executable.includes('/')?resolve(executable):executable;
const contexts=await mkdtemp(join(dirname(source),`${basename(source)}-functions-`));
for(const name of functions){
 const cwd=join(contexts,name);
 await mkdir(cwd,{recursive:true});
 await cp(source,cwd,{recursive:true,filter:p=>!['.parallel-functions','.serverless','.git','node_modules','.work','.sst','cdk.out','package-artifacts'].some(v=>p.slice(source.length).split('/').includes(v))});
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

import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
const [file]=process.argv.slice(2);
if(!file)throw Error('Usage: node parallel-commands.mjs COMMAND_FILE');
const commands=JSON.parse(await readFile(file,'utf8'));
if(!Array.isArray(commands)||!commands.length||commands.some(a=>!Array.isArray(a)||!a.length||a.some(x=>typeof x!=='string'||x.startsWith('<'))))throw Error('Command file must contain bound argv arrays');
const results=await Promise.all(commands.map(argv=>new Promise(resolve=>{
 const child=spawn(argv[0],argv.slice(1),{stdio:'inherit'});
 child.once('error',()=>resolve({success:false,error:'spawn-failed'}));
 child.once('close',exitCode=>resolve({success:exitCode===0,exitCode}));
})));
console.log(JSON.stringify({commands:results.length,results}));
if(results.some(r=>!r.success))process.exitCode=1;

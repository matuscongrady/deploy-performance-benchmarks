import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const temporary=await mkdtemp(path.join(os.tmpdir(),'lambda-runtime-check-'));
try {
  await mkdir(path.join(temporary,'app/handlers'),{recursive:true});
  await writeFile(path.join(temporary,'app/handlers/report.revision.mjs'),"export const revision='current-fixture';\n");
  await writeFile(path.join(temporary,'manifest.json'),JSON.stringify({files:[{name:'report',role:'function',path:'app.zip',handler:'index.handler',module:'index.js'}]}));
  await writeFile(path.join(temporary,'fixtures.json'),JSON.stringify({lambda:{workloads:[{id:'lambda-1',functions:['report']}],functions:[{name:'report',probe:{input:{},expected:{asset:'native font asset'}}}]}}));
  const py=`import zipfile,stat,sys
with zipfile.ZipFile(sys.argv[1],'w') as z:
 entries=[('index.js',"const asset=require('document-library');module.exports=Object.fromEntries([['handler',async()=>({asset,revision:'current-fixture'})]]);",stat.S_IFREG|0o644),('node_modules/document-library','.pnpm/document-library/node_modules/document-library',stat.S_IFLNK|0o777),('node_modules/.pnpm/document-library/node_modules/document-library/index.js',"module.exports=require('node:fs').readFileSync(require('node:path').join(__dirname,'font.afm'),'utf8');",stat.S_IFREG|0o644),('node_modules/.pnpm/document-library/node_modules/document-library/font.afm','native font asset',stat.S_IFREG|0o644)]
 for name,content,mode in entries:
  info=zipfile.ZipInfo(name);info.create_system=3;info.external_attr=mode<<16;z.writestr(info,content)
`;
  const zipped=spawnSync('python3',['-c',py,path.join(temporary,'app.zip')],{encoding:'utf8'});assert.equal(zipped.status,0,zipped.stderr);
  const checked=spawnSync(process.execPath,[new URL('./check-lambda-zips.mjs',import.meta.url).pathname,'manifest.json',path.join(temporary,'fixtures.json'),'lambda-1',temporary],{encoding:'utf8',env:{...process.env,BENCH_NODE:process.execPath}});
  assert.equal(checked.status,0,checked.stderr);
  const result=JSON.parse(checked.stdout.trim());assert.deepEqual(result.completeZipBusinessProbes,[{name:'report',revision:'current-fixture'}]);
  console.log('Complete ZIP business probe loads opaque CommonJS exports and linked runtime assets. No cloud requests.');
}finally{await rm(temporary,{recursive:true,force:true});}

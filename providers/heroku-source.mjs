import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from '../scripts/lib.mjs';
import {herokuPushCommands} from './heroku-git.mjs';

const execute=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
async function git(directory,args,{input,env={}}={}) {
  if(input!==undefined) {
    const {spawn}=await import('node:child_process');
    return new Promise((resolve,reject)=>{const child=spawn('git',['-C',directory,...args],{env:{...process.env,GIT_TERMINAL_PROMPT:'0',...env}});let stdout=[],stderr=[];child.stdout.on('data',v=>stdout.push(v));child.stderr.on('data',v=>stderr.push(v));child.once('error',reject);child.once('close',code=>code===0?resolve(Buffer.concat(stdout)):reject(Error('Local projection Git operation failed')));child.stdin.end(input);});
  }
  const result=await execute('git',['-C',directory,...args],{encoding:'buffer',maxBuffer:32*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',...env}});return result.stdout;
}
async function selectedSources(repoRoot,sourceCommit,fixture,selectors) {
  if(!/^[a-f0-9]{40}$/.test(sourceCommit))throw Error('Project an exact original source commit');
  const manifest=JSON.parse(await git(repoRoot,['show',`${sourceCommit}:fixtures/manifest.json`]));
  const services=fixture==='five-services'?manifest.fiveServices.services:[{...manifest.containers.find(v=>v.id==='container-'+fixture),name:'api'}];
  if(!services.length||services.some(s=>!s.buildContext))throw Error('Select a native container fixture');
  const projected=[];
  for(const service of services) {
    const listed=(await git(repoRoot,['ls-tree','-r','-z',sourceCommit,'--',service.buildContext])).toString().split('\0').filter(Boolean);
    const files=[];
    for(const item of listed) {
      const [metadata,sourcePath]=item.split('\t'),[mode,type,sourceBlob]=metadata.split(' ');
      const nativePath=path.posix.relative(service.buildContext,sourcePath);
      if(nativePath.split('/').some(p=>['node_modules','.venv','__pycache__','.git'].includes(p))||/^Dockerfile(?:\.|$)/.test(path.posix.basename(nativePath))||nativePath==='.dockerignore')continue;
      if(type!=='blob'||!['100644','100755'].includes(mode)||nativePath.startsWith('..')||/[\n\r\t]/.test(nativePath))throw Error('Unsupported app-only source entry');
      const original=await git(repoRoot,['show',`${sourceCommit}:${sourcePath}`]);let bytes=original,transform;
      if(fixture!=='python'&&nativePath==='package.json') {
        const pkg=JSON.parse(original);pkg.engines={...pkg.engines,node:selectors.node};bytes=Buffer.from(json(pkg));transform='Select the qualified native Node runtime; dependencies and scripts are unchanged';
      }
      if(fixture!=='python'&&nativePath==='package-lock.json') {
        const lock=JSON.parse(original);lock.packages[''].engines={...lock.packages[''].engines,node:selectors.node};bytes=Buffer.from(json(lock));transform='Match the package runtime selector without changing any dependency lock entry';
      }
      if(fixture==='python'&&nativePath==='.python-version') {bytes=Buffer.from(selectors.python+'\n');transform='Select the qualified native Python runtime';}
      files.push({sourcePath,sourceBlob,sourceSHA256:hash(original),nativePath,nativeSHA256:hash(bytes),mode,...transform&&{transform},bytes});
    }
    if(!files.length)throw Error('Selected application has no committed files');
    const additions=files.some(f=>f.nativePath==='Procfile')?[]:[{nativePath:'Procfile',mode:'100644',bytes:Buffer.from(fixture==='python'?'web: uvicorn app:app --host 0.0.0.0 --port $PORT\n':'web: npm start\n'),reason:'Native web process start command'}];
    for(const added of additions){if(files.some(f=>f.nativePath===added.nativePath))throw Error('Native addition would overwrite application source');added.nativeSHA256=hash(added.bytes);}
    projected.push({name:service.name,sourceRoot:service.buildContext,files,nativeAdditions:additions});
  }
  return projected;
}
function withoutBytes(file) {const {bytes,...entry}=file;return entry;}
function selectorPolicy(fixture,{node='22.22.0',python='3.11.14'}={}) {
  if(!/^22(?:\.\d+\.\d+|\.x)$/.test(node)||!/^3\.11(?:\.\d+)?$/.test(python))throw Error('Native runtime selector differs from this fixture runtime family');
  return fixture==='python'?{python}:{node};
}
export async function projectHerokuSource({repoRoot,outputDir,fixture,sourceCommit,selectors={}}) {
  repoRoot=path.resolve(repoRoot);outputDir=path.resolve(outputDir);selectors=selectorPolicy(fixture,selectors);
  if(!sourceCommit)sourceCommit=(await git(repoRoot,['rev-parse','HEAD'])).toString().trim();
  const sources=await selectedSources(repoRoot,sourceCommit,fixture,selectors);
  await mkdir(outputDir,{recursive:true});
  const mappingFile=path.join(outputDir,`source-map-${sourceCommit}-${hash(json(selectors)).slice(0,8)}.json`);
  try {const existing=JSON.parse(await readFile(mappingFile,'utf8'));await verifyHerokuSourceMap({repoRoot,mapping:existing,mappingDir:outputDir});return {mappingFile,mappingSHA256:hash(await readFile(mappingFile)),mapping:existing};} catch(error) {if(error.code!=='ENOENT')throw error;}
  let previous;try{previous=JSON.parse(await readFile(path.join(outputDir,'source-map-latest.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(previous&&(previous.fixture!==fixture||JSON.stringify(previous.runtimeSelectors)!==JSON.stringify(selectors)))throw Error('Changing a qualified projection requires a new owned output directory');
  if(previous)await verifyHerokuSourceMap({repoRoot,mapping:previous,mappingDir:outputDir});
  const date=(await git(repoRoot,['show','-s','--format=%cI',sourceCommit])).toString().trim(),services=[];
  for(const source of sources) {
    const nativeRepo=`native/${source.name}.git`,directory=path.join(outputDir,nativeRepo);await mkdir(directory,{recursive:true});
    const marker=path.join(directory,'benchmark-projection.json');
    try{const owned=JSON.parse(await readFile(marker,'utf8'));if(owned.fixture!==fixture||owned.service!==source.name)throw Error('Projection Git directory has another owner');}catch(error){if(error.code!=='ENOENT')throw error;if((await readdir(directory)).length)throw Error('Refuse to initialize a nonempty unowned projection directory');await git(directory,['init','--bare','--initial-branch=app']);await writeFile(marker,json({fixture,service:source.name}));}
    await git(directory,['read-tree','--empty']);
    const entries=[...source.files,...source.nativeAdditions];
    for(const file of entries){const object=(await git(directory,['hash-object','-w','--stdin'],{input:file.bytes})).toString().trim();await git(directory,['update-index','--add','--cacheinfo',`${file.mode},${object},${file.nativePath}`]);}
    const nativeTree=(await git(directory,['write-tree'])).toString().trim(),old=previous?.services.find(s=>s.name===source.name);let nativeCommit,changed;
    if(old?.nativeTree===nativeTree){nativeCommit=old.nativeCommit;changed=false;}else {
      nativeCommit=(await git(directory,['commit-tree',nativeTree,...old?['-p',old.nativeCommit]:[], '-m',`Project ${source.name} from ${sourceCommit}`],{env:{GIT_AUTHOR_NAME:'Benchmark fixture',GIT_AUTHOR_EMAIL:'fixture@example.invalid',GIT_COMMITTER_NAME:'Benchmark fixture',GIT_COMMITTER_EMAIL:'fixture@example.invalid',GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date}})).toString().trim();changed=true;
    }
    await git(directory,['update-ref','refs/heads/app',nativeCommit]);
    services.push({name:source.name,sourceRoot:source.sourceRoot,nativeRepo,nativeTree,nativeCommit,changed,...old&&{previousNativeCommit:old.nativeCommit},files:source.files.map(withoutBytes),nativeAdditions:source.nativeAdditions.map(withoutBytes)});
  }
  const mapping={schemaVersion:1,fixture,sourceCommit,...previous&&{previousSourceCommit:previous.sourceCommit},runtimeSelectors:selectors,services};
  await verifyHerokuSourceMap({repoRoot,mapping,mappingDir:outputDir});
  await writeFile(mappingFile,json(mapping),{flag:'wx'});await writeFile(path.join(outputDir,'source-map-latest.json'),json(mapping));
  return {mappingFile,mappingSHA256:hash(await readFile(mappingFile)),mapping};
}
export async function verifyHerokuSourceMap({repoRoot,mapping,mappingDir}) {
  if(mapping.schemaVersion!==1||!Array.isArray(mapping.services))throw Error('A native source mapping is required');
  const expected=await selectedSources(repoRoot,mapping.sourceCommit,mapping.fixture,selectorPolicy(mapping.fixture,mapping.runtimeSelectors));
  const prior=mapping.previousSourceCommit?await selectedSources(repoRoot,mapping.previousSourceCommit,mapping.fixture,selectorPolicy(mapping.fixture,mapping.runtimeSelectors)):null;
  if(expected.length!==mapping.services.length)throw Error('Native source map has the wrong service count');
  for(const source of expected) {
    const entries=mapping.services.filter(s=>s.name===source.name);if(entries.length!==1)throw Error('Native source map has duplicate or missing services');const entry=entries[0];
    if(entry.sourceRoot!==source.sourceRoot||entry.nativeRepo!==`native/${source.name}.git`||!/^([a-f0-9]{40})$/.test(entry.nativeCommit||''))throw Error('Native source mapping identity differs');
    if(JSON.stringify(entry.files)!==JSON.stringify(source.files.map(withoutBytes))||JSON.stringify(entry.nativeAdditions)!==JSON.stringify(source.nativeAdditions.map(withoutBytes)))throw Error('Native source file mapping differs from the original commit');
    const directory=path.join(mappingDir,entry.nativeRepo),nativeTree=(await git(directory,['rev-parse',entry.nativeCommit+'^{tree}'])).toString().trim();
    if(nativeTree!==entry.nativeTree)throw Error('Native app tree differs from its source mapping');
    const paths=(await git(directory,['ls-tree','-r','--name-only',entry.nativeCommit])).toString().trim().split('\n');
    const files=[...source.files,...source.nativeAdditions];if(paths.length!==files.length||files.some(f=>!paths.includes(f.nativePath)))throw Error('Native app contains unlisted files');
    for(const file of files)if(hash(await git(directory,['show',entry.nativeCommit+':'+file.nativePath]))!==file.nativeSHA256)throw Error('Native app file bytes differ from the original source mapping');
    if(prior) {
      if(!/^[a-f0-9]{40}$/.test(entry.previousNativeCommit||''))throw Error('Native map needs its previous commit');
      const previousTree=(await git(directory,['rev-parse',entry.previousNativeCommit+'^{tree}'])).toString().trim(),old=prior.find(s=>s.name===source.name);
      const oldFiles=[...old.files,...old.nativeAdditions],oldPaths=(await git(directory,['ls-tree','-r','--name-only',entry.previousNativeCommit])).toString().trim().split('\n');
      if(oldPaths.length!==oldFiles.length||oldFiles.some(f=>!oldPaths.includes(f.nativePath)))throw Error('Previous native app has unlisted files');
      for(const file of oldFiles)if(hash(await git(directory,['show',entry.previousNativeCommit+':'+file.nativePath]))!==file.nativeSHA256)throw Error('Previous native app differs from its original source');
      if(entry.changed!==(previousTree!==nativeTree)||!entry.changed&&entry.nativeCommit!==entry.previousNativeCommit)throw Error('Native changed/unchanged identity differs from its application tree');
    }else if(entry.changed!==true||entry.previousNativeCommit)throw Error('First native source projection must mark every app as changed');
  }
  return {verified:true,sourceCommit:mapping.sourceCommit,nativeCommits:mapping.services.map(s=>({name:s.name,nativeCommit:s.nativeCommit,nativeTree:s.nativeTree}))};
}
if(process.argv[1]===new URL(import.meta.url).pathname) {
  try{const {positional,flags}=parseArgs(process.argv.slice(2));if(positional[0]!=='project'||!flags.repo||!flags.fixture||!flags.output)throw Error('Usage: heroku-source.mjs project --repo REPO --fixture node|python|five-services --output DIRECTORY [--source FULL_SHA]');const result=await projectHerokuSource({repoRoot:flags.repo,outputDir:flags.output,fixture:flags.fixture,sourceCommit:flags.source,selectors:{node:flags['node-version'],python:flags['python-version']}});if(flags.plan){const plan=JSON.parse(await readFile(flags.plan,'utf8'));if(path.resolve(plan.outputDir)!==path.resolve(flags.output)||path.resolve(plan.repoRoot)!==path.resolve(flags.repo)||plan.fixture!==flags.fixture)throw Error('Native plan and source projection differ');const commands=herokuPushCommands(plan,result.mapping,{destination:flags.destination||'heroku'});await writeFile(path.join(flags.output,'heroku-update-commands.json'),json(commands.map(c=>c.argv)));}console.log(json({mappingFile:result.mappingFile,mappingSHA256:result.mappingSHA256,sourceCommit:result.mapping.sourceCommit,services:result.mapping.services.map(({name,nativeCommit,nativeTree,changed})=>({name,nativeCommit,nativeTree,changed}))}));}catch(error){console.error(error.message);process.exitCode=1;}
}

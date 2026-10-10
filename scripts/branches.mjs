import {spawnSync,spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {root} from './lib.mjs';

function git(args,input) {const r=spawnSync('git',args,{cwd:root,input,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||'Git failed');return r.stdout.trim();}
function source(base,file) {return git(['show',`${base}:${file}`]);}
const stringify=v=>JSON.stringify(v,null,2)+'\n';
const binarySafeSource=(base,file)=>{const r=spawnSync('git',['show',`${base}:${file}`],{cwd:root,maxBuffer:32*1024*1024});if(r.status!==0)throw Error('Cannot read committed source '+file);return r.stdout;};

export async function filesForTest(base,scenario) {
  const tracked=git(['ls-tree','-r','--name-only',base]).split('\n');
  const files=new Map();
  const keep=file=>{if(!tracked.includes(file))throw Error('Required committed file is missing: '+file);files.set(file,binarySafeSource(base,file));};
  const keepPrefix=prefix=>{for(const file of tracked.filter(f=>f.startsWith(prefix)))keep(file);};
  const manifest=JSON.parse(source(base,'fixtures/manifest.json'));
  const isLambda=scenario.fixture.startsWith('lambda-');
  const reduced={schemaVersion:manifest.schemaVersion,pathsAreRelativeTo:manifest.pathsAreRelativeTo,probeMatching:manifest.probeMatching,runtimes:manifest.runtimes};
  const contexts=[];
  if(isLambda) {
    const workload=manifest.lambda.workloads.find(w=>w.id===scenario.fixture);
    const functions=manifest.lambda.functions.filter(f=>workload.functions.includes(f.name));
    reduced.lambda={...manifest.lambda,workloads:[workload],functions,dependencyLock:'fixtures/lambdas/package-lock.json'};
    contexts.push(manifest.lambda.context);
    for(const file of ['data.mjs','check.mjs'])keep(`fixtures/lambdas/${file}`);
    for(const f of functions){keep(f.entry);keep(f.revisionFile);}
    for(const file of ['package.json','package-lock.json'])files.set('fixtures/lambdas/'+file,binarySafeSource(base,`fixtures/lambdas/workload-locks/${scenario.fixture}/${file}`));
    const allWorkloads=JSON.parse(source(base,'fixtures/lambdas/workloads.json'));
    files.set('fixtures/lambdas/workloads.json',stringify({[String(scenario.functions)]:allWorkloads[String(scenario.functions)]}));
  } else if(scenario.fixture==='five-services') {
    reduced.fiveServices=manifest.fiveServices;
    for(const service of manifest.fiveServices.services){contexts.push(service.buildContext);keepPrefix(service.buildContext+'/');}
    keep('fixtures/containers/five-services/workload.json');
  } else {
    const fixture=manifest.containers.find(c=>c.id==='container-'+scenario.fixture);
    reduced.containers=[fixture];contexts.push(fixture.buildContext);keepPrefix(fixture.buildContext+'/');
  }
  files.set('fixtures/manifest.json',stringify(reduced));
  keep('fixtures/install.mjs');keep('fixtures/check.mjs');
  for(const file of tracked.filter(f=>/^scripts\/[^/]+\.mjs$/.test(f)&&f!=='scripts/branches.mjs'))keep(file);
  for(const file of ['providers/index.mjs','providers/link-tools.mjs','providers/node22-runtime.mjs'])keep(file);
  if(isLambda)for(const file of ['providers/package-cdk.mjs','providers/package-sst.mjs','providers/install-sst-bridge.mjs','providers/sst-native-main.go','providers/check-lambda-zips.mjs','providers/probe-packages.mjs','providers/parallel-commands.mjs','providers/parallel-functions.mjs'])keep(file);
  else {keep('providers/package-container.mjs');keep('providers/hosted.mjs');}
  for(const provider of scenario.providers.filter(p=>['serverless','sst','cdk'].includes(p)))keepPrefix(`providers/tools/${provider}/`);
  for(const file of ['.gitignore','docs/methodology.md','docs/cache-controls.md','docs/results.md','docs/runbook.md','docs/provider-setup.md','docs/qualification.example.json'])keep(file);
  if(scenario.journey.startsWith('git-')){keep('.github/workflows/deploy-benchmark.yml');keep('docs/ci-setup.md');}
  else {files.delete('scripts/ci.mjs');files.delete('scripts/github-run.mjs');files.delete('scripts/pipeline-completion.mjs');files.delete('scripts/git-push.mjs');}
  // The branch contains one scenario. main remains the owner of the complete catalogue.
  files.set('scenarios/index.json',stringify({schemaVersion:1,scenarios:[scenario]}));
  files.set('.benchmark-test.json',stringify({scenario:scenario.id,baseCommit:base}));
  const mainPackage=JSON.parse(source(base,'package.json'));
  delete mainPackage.scripts.branches;
  files.set('package.json',stringify(mainPackage));
  const {reviewFiles}=await import('../providers/index.mjs');
  if(typeof reviewFiles!=='function')throw Error('Native review configuration generator is not ready');
  for(const provider of scenario.providers) {
    const generated=await reviewFiles({provider,fixture:scenario.fixture,repoRoot:root,runId:`commerce-${scenario.fixture}`});
    for(const [file,content] of Object.entries(generated)) {
      if(path.isAbsolute(file)||file.split('/').includes('..'))throw Error('Invalid native configuration path');
      files.set(file,content);
    }
  }
  const description=isLambda?`This application has ${scenario.functions} different commerce functions.`:scenario.fixture==='five-services'?'This application has five independently built commerce services.':'This application is one '+(scenario.fixture==='node'?'Node.js':'Python')+' commerce API.';
  const changed=isLambda?`The update changes all ${scenario.functions} selected functions.`:scenario.fixture==='five-services'?'The update changes API, reporting and notifications. Inventory and webhooks keep their source, dependencies and deployed identities.':'The update changes the API revision.';
  const purpose=isLambda?'The reporting function generates actual PDF, Excel and Word documents. Other selected handlers perform commerce operations; their source and expected business results are listed in the manifest. This exposes the cost of packaging real dependencies and updating a whole application.':scenario.fixture==='five-services'?'Three changed services and two unchanged services show whether deployment avoids unnecessary rebuilding and replacement. Each service has its own source context and dependency lock.':'The app validates requests, calculates prices and renders receipts. It provides enough real work to check that a build is runnable, while keeping database and network dependencies out of the comparison.';
  const timing=scenario.kind==='package'?'Start immediately before the native package/build command. Stop when every deployable artifact is complete, before upload or deployment. Record compressed artifact size separately.':scenario.journey==='cli'?'Start immediately before the native update command. Stop after every business response confirms the expected revision.':'Start immediately before the actual Git push. Stop only after the deployment pipeline succeeds and every business response confirms the expected revision. Queueing, installation, building, upload and rollout are included.';
  const cache=scenario.kind==='package'?'Run one clean-cache series and one cached source-edit series. Keep the cache controls and raw logs.':scenario.journey==='git-cold'?'Use a fresh runner without restored CI caches. Record remote application caches separately.':scenario.journey==='git-repeat'?'Complete an untimed workflow deployment on the same trial branch. Wait 15 minutes after its verified readiness, edit again and push. Save actual restore/hit/miss evidence; another push is not automatically a warm build.':'Retain normal local caches and record what was reused.';
  const direct=scenario.fixture==='node'?'For a hosted native build, select `fixtures/containers/node` as the application directory. Its package, lockfile and start command are complete. Do not use the repository root as the build context.':scenario.fixture==='python'?'For a hosted native build, select `fixtures/containers/python` as the application directory. Its requirements, runtime version and start command are complete. Do not use the repository root as the build context.':scenario.fixture==='five-services'?'Configure five source paths, one for each directory under `fixtures/containers/five-services/`. Do not build all five from the repository root.':'Each selected function exports `handler(event)`. Direct Lambda invocation verifies the business result; an API Gateway is not required.';
  const readme=`# ${scenario.title}\n\n${description} ${changed}\n\n${purpose}\n\nThis branch contains only this test's application, locks, platform configurations and measurement scripts. [The full catalogue and common sources live on main](https://github.com/matuscongrady/deploy-performance-benchmarks/tree/main).\n\n## Run the application checks\n\n\`\`\`sh\nnode fixtures/install.mjs\nnode scripts/check.mjs\n\`\`\`\n\nThese commands install the locked dependencies and exercise the selected application. They do not contact AWS or deploy. ${scenario.fixture==='python'?'Installation uses uv to create the pinned Python environment.':''}\n\n${direct}\n\n## Read the platform configurations\n\nThe files under \`deployment/\` are ordinary native configurations that point to the selected source. Each platform directory explains its install, setup, update and cleanup commands. The automatic-builder source has no default Dockerfile; CDK/SST explicitly select their named recipes. Account-specific values stay in ignored qualification state.\n\nTo prepare an executable native command plan without deploying:\n\n\`\`\`sh\nnode scripts/bench.mjs prepare ${scenario.id} ${scenario.providers[0]} --app-id commerce-${scenario.fixture} --run-id review-${scenario.fixture}\n\`\`\`\n\nSupported platforms here: ${scenario.providers.join(', ')}. Heroku, where listed, remains blocked until its account and buildpack are selected. A generated plan does not count as a successful benchmark.\n\n## Make the measured change\n\n\`\`\`sh\ngit switch -c trial/${scenario.fixture}-001\nnode scripts/revision.mjs ${scenario.id} trial-001\ngit add fixtures\ngit commit -m 'Change the selected application revision'\n\`\`\`\n\nThe revision script changes only this test's edit targets. Deploy and verify the baseline before making that edit.\n\n## What the clock measures\n\n${timing}\n\n${cache}\n\nFollow [the run procedure](docs/runbook.md), [measurement rules](docs/methodology.md) and [cache controls](docs/cache-controls.md). ${scenario.journey.startsWith('git-')?'[CI setup](docs/ci-setup.md) describes the disabled-by-default GitHub workflow; hosted platforms use their own Git connection.':''}\n\nKeep ten measured attempts, including failures. Check the actual native artifact, business output, revision and deployment path before admitting a result. Use the saved cleanup commands and verify deletion afterward.\n`;
  files.set('README.md',readme);files.set('TEST.md',readme);
  files.set('fixtures/README.md',`# Selected application\n\n${description} ${changed}\n\n${purpose}\n\nThe machine-readable [manifest](manifest.json) contains every selected entrypoint, edit target, dependency lock, request and expected response. ${isLambda?'All selected Lambda handlers appear under `lambdas/handlers/`.':`The only application contexts here are: ${contexts.map(c=>'`'+c+'`').join(', ')}.`}\n\nRun \`node fixtures/install.mjs\` and \`node fixtures/check.mjs\` from the repository root. Each response must match the manifest's business fields and the expected revision. A health check alone can succeed on old code.\n\nApplication data and dates are fixed. No real payment, email or database service is used. This fixture measures building and deployment, rather than external service latency.\n`);
  let runbook=files.get('docs/runbook.md').toString().replaceAll('test/deploy-lambda-5-cli','test/'+scenario.id).replaceAll('deploy-lambda-5-cli',scenario.id).replaceAll('deploy-lambda-5-git-cold',scenario.id).replaceAll('commerce-five','commerce-'+scenario.fixture).replaceAll('serverless',scenario.providers.find(p=>p!=='candidate'));
  if(!scenario.journey.startsWith('git-'))runbook=runbook.replace('[CI setup](ci-setup.md)','CI setup on the Git-push test branches');
  files.set('docs/runbook.md',runbook);
  let sourceWorkflow=source(base,'.github/workflows/source-check.yml');
  if(scenario.fixture!=='python')sourceWorkflow=sourceWorkflow.replace(/      - name: Install pinned Python tooling\n[\s\S]*?(?=      - name: Install locked dependencies)/,'');
  files.set('.github/workflows/source-check.yml',sourceWorkflow);
  return files;
}

export function treeForFiles(files) {
  const tree={};
  for(const [filename,content] of files) {
    const parts=filename.split('/');let node=tree;
    for(const part of parts.slice(0,-1))node=node[part]??={};
    node[parts.at(-1)]={blob:git(['hash-object','-w','--stdin'],content)};
  }
  function make(node) {
    const entries=Object.entries(node).map(([name,value])=>value.blob?`100644 blob ${value.blob}\t${name}`:`040000 tree ${make(value)}\t${name}`);
    return git(['mktree'],entries.join('\n')+'\n');
  }
  return make(tree);
}

export async function validateExport(files,scenario) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'benchmark-branch-'));
  try {
    for(const [filename,content] of files){await mkdir(path.dirname(path.join(dir,filename)),{recursive:true});await writeFile(path.join(dir,filename),content);}
    function run(argv) {const r=spawnSync(argv[0],argv.slice(1),{cwd:dir,encoding:'utf8',maxBuffer:16*1024*1024});if(r.status!==0)throw Error(r.stderr||r.stdout||'Exported branch command failed');}
    run([process.execPath,'fixtures/install.mjs']);run([process.execPath,'scripts/check.mjs']);
    const m=JSON.parse(await readFile(path.join(dir,'fixtures/manifest.json')));
    if((m.lambda?.functions.length||0)!==(scenario.functions||0))throw Error('Branch includes unrelated Lambda functions');
    if((m.containers?.length||0)!==(scenario.fixture==='node'||scenario.fixture==='python'?1:0))throw Error('Branch includes unrelated single-container apps');
    if((m.fiveServices?.services.length||0)!==(scenario.fixture==='five-services'?5:0))throw Error('Branch includes unrelated services');
    console.log('Validated clean export: '+scenario.id);
  } finally {await rm(dir,{recursive:true,force:true});}
}

if(process.argv[1]===new URL(import.meta.url).pathname) {
  const validateOnly=process.argv.includes('--validate-only');
  const base=git(['rev-parse','HEAD']);
  if(git(['status','--porcelain']).trim())throw Error('Commit the canonical source before generating test branches');
  const all=JSON.parse(source(base,'scenarios/index.json')).scenarios;
  const filters=process.argv.slice(2).filter(arg=>arg!=='--validate-only');
  const selected=filters.length?all.filter(s=>filters.includes(s.id)):all;
  if(filters.some(id=>!selected.some(s=>s.id===id)))throw Error('Unknown selected test');
  for(const scenario of selected) {
    const files=await filesForTest(base,scenario);
    if(validateOnly){await validateExport(files,scenario);continue;}
    const branch='test/'+scenario.id;
    if(spawnSync('git',['show-ref','--verify','--quiet','refs/heads/'+branch],{cwd:root}).status===0)throw Error('Branch already exists: '+branch+'; retained without changes');
    const tree=treeForFiles(files);
    const commit=git(['commit-tree',tree,'-p',base],`Select ${scenario.title}\n`);
    git(['update-ref','refs/heads/'+branch,commit,'0000000000000000000000000000000000000000']);
    console.log(branch);
  }
}

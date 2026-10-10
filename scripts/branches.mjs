import {spawnSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm,readFile,chmod} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {root} from './lib.mjs';

function git(args,input) {const r=spawnSync('git',args,{cwd:root,input,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr||'Git failed');return r.stdout.trim();}
function source(base,file) {return git(['show',`${base}:${file}`]);}
const stringify=v=>JSON.stringify(v,null,2)+'\n';
const binarySafeSource=(base,file)=>{const r=spawnSync('git',['show',`${base}:${file}`],{cwd:root,maxBuffer:32*1024*1024});if(r.status!==0)throw Error('Cannot read committed source '+file);return r.stdout;};


function runbookForTest(scenario,{description,changed,direct,timing,cache}) {
  const provider=scenario.providers[0];
  const appId=`commerce-${scenario.fixture}`;
  const qualification=`.work/${appId}/${provider}/qualification.json`;
  const isGit=scenario.journey.startsWith('git-');
  const isPackage=scenario.kind==='package';
  const isLambda=scenario.fixture.startsWith('lambda-');
  const qualifiedCache=` --qualification ${qualification}`;
  const localCommands=(runId,series,retainFrom)=>`\`\`\`sh
node scripts/cache.mjs ${provider} --scenario ${scenario.id} \\
  --app-id ${appId} --run-id ${runId} --series ${series}${qualifiedCache}${retainFrom?` \\
  --retain-from ${retainFrom}`:''}
node scripts/bench.mjs run ${scenario.id} ${provider} \\
  --app-id ${appId} --run-id ${runId} \\
  --qualification ${qualification} \\
  --cache-evidence .work/evidence/${runId}/${provider}/cache-control.json --execute
\`\`\``;
  const clean=isPackage?`## Measure the clean build first

Keep the baseline source for this first attempt. Set the qualification's cacheEvidence.series to \`clean\`. ${isLambda?'The cache-control command resets only qualified owned output/cache paths; it keeps an immutable record of the action.':'First qualify the native builder’s no-cache control or an isolated clean builder. Save the actual invocation and its observed cache decision. Set cacheControl.localPaths to the builder’s qualified output/cache paths and cacheControl.nativeClean to its verified environment control when needed. Deleting ZIP or synth output directories does not disable Docker layers. Export the qualified control before the commands below; do not use the diagnostic Docker flag as proof of a native builder setting.'}

${localCommands('clean-001','clean')}

Complete this passed clean-build attempt before editing the source. Its raw result and retained cache/artifact files are prerequisites for the cached rebuild. ${isLambda?'':'The native compressed image identity/size and runnable business output must be observed before accepting it. If no native clean control or complete artifact proof is available, this series is blocked.'}

`:'';
  const setup=isPackage
    ? 'Run the generated tool/dependency installation commands outside the timer. Qualify the complete native artifacts and run their business checks before accepting measurements. Packaging stops before upload or deployment; any infrastructure used to establish artifact parity belongs to untimed qualification.'
    : 'Run the generated installation and setup commands outside the timer. Use a disposable application, keep its app ID/stage/region fixed, and save the native resource bindings and cleanup commands. Verify every baseline business response before measuring an update.';
  const execute=isGit
    ? `Configure the reviewed Git trigger for this trial branch. [CI setup](ci-setup.md) covers the disabled-by-default GitHub workflow; managed platforms use their native Git connection. Set qualification pipeline.branch and pipeline.sourceCommit to the actual trial branch and committed SHA. Bind pipeline.completion to the native terminal-status observer. Repeat pushes also need previousReadyAt.

\`\`\`sh
node scripts/git-push.mjs ${scenario.id} ${provider} \\
  --run-id trial-001 --qualification ${qualification} --execute
\`\`\`

The runner starts immediately before the push and stops at verified business readiness. It then checks native pipeline success; failures are retained and cannot qualify. CI/hosted cache evidence is bound to the observed completed pipeline, rather than a local cache-control file.`
    : `${isPackage?"Set the qualification's cacheEvidence.series to `cached-source-edit`. The retained result must be the passed clean attempt from the preceding source commit.":"Set the qualification's cacheEvidence.series to `cli-existing-cache`. This captures present local cache paths without deleting them or claiming a cache hit."}${isPackage&&!isLambda?' Turn off the clean-only native control, keep the same builder/base-image state and retain its qualified caches. Record actual layer reuse or misses and the new complete image identity/size. A retained directory does not by itself prove Docker reuse.':''}

${isPackage?localCommands('edited-001','cached-source-edit',`results/raw/clean-001-${provider}.json`):localCommands('trial-001','cli-existing-cache')}

The runner executes only the selected native ${isPackage?'packaging/build':'update'} command and retains its logs and result. Tool installation and baseline setup stay outside this interval.`;
  const managed=isPackage&&!isLambda&&scenario.providers.some(p=>['render','ravion','heroku'].includes(p))?`## Packaging on a managed builder

${scenario.providers.filter(p=>['render','ravion','heroku'].includes(p)).join(', ')} use their native account-connected builders. The local cache and run examples above do not apply to these platforms. Configure the selected source directory and native builder, then run the baseline and edited builds through the platform. Keep its build ID, exact source commit, actual cache-control request, restore/hit/miss observations and logs. Use build-phase start/end events, excluding queueing, checkout and rollout. A reset that starts a build is part of that observed build, rather than a separate invisible reset. If native clean or retained-cache state cannot be established, leave that series unmeasured.

Record the complete native output and compressed size only when observable; slug and OCI formats stay separate. Verify the deployed business response to establish that this output contains the edited code. Assemble the observed result using [result data](results.md), then validate it:

\`\`\`sh
node scripts/bench.mjs record-managed .work/observed-build.json
\`\`\`

Missing account access, build events or artifact proof blocks the row. A local Docker build or a full deployment duration cannot replace the native packaging measurement.

`:'';
  return `# Run: ${scenario.title}

${description} ${changed}

## Check out and exercise the selected application

\`\`\`sh
git checkout test/${scenario.id}
node fixtures/install.mjs
node scripts/check.mjs
git switch -c trial/${scenario.fixture}-001
\`\`\`

The installation and checks use only this branch's selected application. They make no cloud requests. ${direct}

## Prepare one platform

This branch supports ${scenario.providers.join(', ')}. The commands below use ${provider}; replace it consistently when running another supported platform. Follow [provider setup](provider-setup.md), including its pinned tools and any account/artifact prerequisites.

\`\`\`sh
node scripts/bench.mjs prepare ${scenario.id} ${provider} \\
  --app-id ${appId} --run-id review-001
\`\`\`

Read \`.work/${appId}/${provider}/plan.json\`. Preparation writes source/configuration and argv command lists; it does not run them. ${setup}

## Qualify the result and keep bindings local

Copy the [qualification example](qualification.example.json) into \`${qualification}\`. Set scenario to \`${scenario.id}\`, provider to \`${provider}\`, appId to \`${appId}\` and stage to the baseline's stage. Replace its example fields with this application's observed versions, cache evidence and artifact/runtime checks. The [selected manifest](../fixtures/manifest.json) is the source of required component names, requests and business expectations.

${isPackage?isLambda?`Supply every selected function ZIP and any required shared layer. See [result data](results.md) for the qualified artifact fields. Do not substitute a JavaScript bundle or a directory.`:'Supply qualified native container artifacts as described in [result data](results.md). For OCI images, measure compressed image bytes; record other native formats separately. Do not use an unpacked local image size.':`Supply baselineProbes and probes for every selected component. Before and after responses must match their expected business fields and revisions. ${scenario.fixture==='five-services'?'Include component snapshots proving that inventory and webhooks retain their deployed identities.':''}`}

For AWS operations, bind environment.accountId to the verified disposable account. Keep tokens, resource IDs and endpoints in ignored qualification state. Set approved only after the technical checks; that flag does not authorize a campaign.

${clean}## Make and commit the prescribed edit

\`\`\`sh
node scripts/revision.mjs ${scenario.id} trial-001
git add fixtures
git commit -m 'Change the selected application revision'
\`\`\`

${changed} ${isPackage?'The cached rebuild uses this committed edit and the preceding passed clean-build result.':'The baseline must return its previous revision; updated probes must expect trial-001 on changed components and the prior revision on unchanged components.'}

## ${isPackage?'Measure the cached rebuild':'Measure this deployment'}

${timing}

${execute}

${cache}

${managed}Follow [measurement rules](methodology.md) and [cache controls](cache-controls.md). Record ten attempts, including errors, and use a unique run ID for each. [Result data](results.md) describes raw evidence and compressed artifact sizes.

## Finish the series

Retain native logs, actual build/cache decisions, source SHA and runtime checks. For cloud resources, run the saved cleanup commands after success or failure and verify deletion. ${isGit?'Disable deployment CI and remove campaign-only account access after cleanup.':''}

\`\`\`sh
node scripts/results.mjs
\`\`\`

This reports recorded results and failures. Review and sanitize evidence before publishing it.
`;
}

export async function filesForTest(base,scenario) {
  const tracked=git(['ls-tree','-r','--name-only',base]).split('\n');
  const files=new Map();
  files.modes=new Map(git(['ls-tree','-r',base]).split('\n').map(line=>{const [meta,name]=line.split('\t');return [name,meta.split(' ')[0]];}));
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
  else {keep('providers/package-container.mjs');keep('providers/hosted.mjs');keep('providers/parallel-commands.mjs');}
  for(const provider of scenario.providers.filter(p=>['serverless','sst','cdk'].includes(p)))keepPrefix(`providers/tools/${provider}/`);
  for(const file of ['.gitignore','docs/methodology.md','docs/cache-controls.md','docs/results.md','docs/runbook.md','docs/provider-setup.md','docs/qualification.example.json'])keep(file);
  if(scenario.journey.startsWith('git-')){keep('.github/workflows/deploy-benchmark.yml');keep('docs/ci-setup.md');}
  else {
    files.delete('scripts/ci.mjs');files.delete('scripts/git-push.mjs');
    files.set('docs/cache-controls.md',files.get('docs/cache-controls.md').toString().replace('[CI setup](ci-setup.md)','[CI setup on main](https://github.com/matuscongrady/deploy-performance-benchmarks/blob/main/docs/ci-setup.md)'));
  }
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
  // A provider may merge its dependencies into the root package. Branch generation remains a main-only command.
  const branchPackage=JSON.parse(files.get('package.json').toString());
  if(branchPackage.scripts)delete branchPackage.scripts.branches;
  files.set('package.json',stringify(branchPackage));
  if(scenario.providers.includes('serverless'))files.set('.gitignore',files.get('.gitignore').toString()+'\n.serverless/\n');
  const description=isLambda?`This application has ${scenario.functions} different commerce functions.`:scenario.fixture==='five-services'?'This application has five independently built commerce services.':'This application is one '+(scenario.fixture==='node'?'Node.js':'Python')+' commerce API.';
  const changed=isLambda?`The update changes all ${scenario.functions} selected functions.`:scenario.fixture==='five-services'?'The update changes API, reporting and notifications. Inventory and webhooks keep their source, dependencies and deployed identities.':'The update changes the API revision.';
  const purpose=isLambda?(scenario.functions===1?'The reporting function generates actual PDF, Excel and Word documents. This tests a dependency-heavy business function, including the assets its document libraries need.':'The reporting function generates actual PDF, Excel and Word documents. Other selected handlers perform commerce operations; their source and expected business results are listed in the manifest. This exposes the cost of packaging real dependencies and updating a whole application.'):scenario.fixture==='five-services'?'Three changed services and two unchanged services show whether deployment avoids unnecessary rebuilding and replacement. Each service has its own source context and dependency lock.':'The app validates requests, calculates prices and renders receipts. It provides enough real work to check that a build is runnable, while keeping database and network dependencies out of the comparison.';
  const timing=scenario.kind==='package'?'Start immediately before the native package/build command. Stop when every deployable artifact is complete, before upload or deployment. Record compressed artifact size separately.':scenario.journey==='cli'?'Start immediately before the native update command. Stop after every business response confirms the expected revision.':'Start immediately before the actual Git push. Stop when every business response confirms the expected revision. Queueing, installation, building, upload and rollout are included. Then verify that the native pipeline succeeded; a failed pipeline disqualifies the result, but waiting for its terminal status does not extend the readiness timer.';
  const cache=scenario.kind==='package'?'Run one clean-cache series and one cached source-edit series. Keep the cache controls and raw logs.':scenario.journey==='git-cold'?'Use a fresh runner without restored CI caches. Record remote application caches separately.':scenario.journey==='git-repeat'?'Complete an untimed workflow deployment on the same trial branch. Wait 15 minutes after its verified readiness, edit again and push. Save actual restore/hit/miss evidence; another push is not automatically a warm build.':'Retain normal local caches and record what was reused.';
  const direct=scenario.fixture==='node'?'For a hosted native build, select `fixtures/containers/node` as the application directory. Its package, lockfile and start command are complete. Do not use the repository root as the build context.':scenario.fixture==='python'?'For a hosted native build, select `fixtures/containers/python` as the application directory. Its requirements, runtime version and start command are complete. Do not use the repository root as the build context.':scenario.fixture==='five-services'?'Configure five source paths, one for each directory under `fixtures/containers/five-services/`. Do not build all five from the repository root.':'Each selected function exports `handler(event)`. Direct Lambda invocation verifies the business result; an API Gateway is not required.';
  const readme=`# ${scenario.title}\n\n${description} ${changed}\n\n${purpose}\n\nThis branch contains only this test's application, locks, platform configurations and measurement scripts. [The full catalogue and common sources live on main](https://github.com/matuscongrady/deploy-performance-benchmarks/tree/main).\n\n## Run the application checks\n\n\`\`\`sh\nnode fixtures/install.mjs\nnode scripts/check.mjs\n\`\`\`\n\nThese commands install the locked dependencies and exercise the selected application. They do not contact AWS or deploy. ${scenario.fixture==='python'?'Installation uses uv to create the pinned Python environment.':''}\n\n${direct}\n\n## Read the platform configurations\n\nThe files under \`deployment/\` are ordinary native configurations that point to the selected source. Each platform directory explains its install, setup, update and cleanup commands. The automatic-builder source has no default Dockerfile; CDK/SST explicitly select their named recipes. Account-specific values stay in ignored qualification state.\n\nTo prepare an executable native command plan without deploying:\n\n\`\`\`sh\nnode scripts/bench.mjs prepare ${scenario.id} ${scenario.providers[0]} --app-id commerce-${scenario.fixture} --run-id review-${scenario.fixture}\n\`\`\`\n\nSupported platforms here: ${scenario.providers.join(', ')}. ${scenario.providers.includes('heroku')?'Heroku remains blocked until its account and buildpack are selected. ':''} A generated plan does not count as a successful benchmark.\n\n## Make the measured change\n\n\`\`\`sh\ngit switch -c trial/${scenario.fixture}-001\nnode scripts/revision.mjs ${scenario.id} trial-001\ngit add fixtures\ngit commit -m 'Change the selected application revision'\n\`\`\`\n\nThe revision script changes only this test's edit targets. ${scenario.kind==='package'?'Keep the baseline source for the clean-build series; use the committed edit for the cached rebuild.':'Deploy and verify the baseline before making that edit.'}\n\n## What the clock measures\n\n${timing}\n\n${cache}\n\nFollow [the run procedure](docs/runbook.md), [measurement rules](docs/methodology.md) and [cache controls](docs/cache-controls.md). ${scenario.journey.startsWith('git-')?'[CI setup](docs/ci-setup.md) describes the disabled-by-default GitHub workflow; hosted platforms use their own Git connection.':''}\n\nKeep ten measured attempts, including failures. Check the actual native artifact, business output, revision and deployment path before admitting a result. Use the saved cleanup commands and verify deletion afterward.\n`;
  files.set('README.md',readme);files.set('TEST.md',readme);
  files.set('fixtures/README.md',`# Selected application\n\n${description} ${changed}\n\n${purpose}\n\nThe machine-readable [manifest](manifest.json) contains every selected entrypoint, edit target, dependency lock, request and expected response. ${isLambda?'All selected Lambda handlers appear under `lambdas/handlers/`.':`The only application contexts here are: ${contexts.map(c=>'`'+c+'`').join(', ')}.`}\n\nRun \`node fixtures/install.mjs\` and \`node fixtures/check.mjs\` from the repository root. Each response must match the manifest's business fields and the expected revision. A health check alone can succeed on old code.\n\nApplication data and dates are fixed. No real payment, email or database service is used. This fixture measures building and deployment, rather than external service latency.\n`);
  files.set('docs/runbook.md',runbookForTest(scenario,{description,changed,direct,timing,cache}));
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
    node[parts.at(-1)]={blob:git(['hash-object','-w','--stdin'],content),mode:files.modes?.get(filename)||'100644'};
  }
  function make(node) {
    const entries=Object.entries(node).map(([name,value])=>value.blob?`${value.mode} blob ${value.blob}\t${name}`:`040000 tree ${make(value)}\t${name}`);
    return git(['mktree'],entries.join('\n')+'\n');
  }
  return make(tree);
}

export async function validateExport(files,scenario) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'benchmark-branch-'));
  try {
    for(const [filename,content] of files){await mkdir(path.dirname(path.join(dir,filename)),{recursive:true});await writeFile(path.join(dir,filename),content);if(files.modes?.get(filename)==='100755')await chmod(path.join(dir,filename),0o755);}
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

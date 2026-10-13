import { cp, mkdir, readFile, writeFile, symlink, lstat, readdir, copyFile, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import {createHash} from 'node:crypto';

export const versions = Object.freeze({ serverless: '4.43.0', sst: '4.17.2', cdk: '2.1145.0', cdkLibrary: '2.273.0', constructs: '10.8.1', esbuild: '0.28.2', ravion: '1.14.3', render: '2.28.0',heroku:'11.11.0',herokuBuilds:'2.0.4' });
const json = (v) => JSON.stringify(v, null, 2) + '\n';
const exists = async (p) => lstat(p).then(() => true, () => false);
const write = async (dir, name, value) => { await mkdir(dirname(join(dir, name)), { recursive: true }); await writeFile(join(dir, name), typeof value === 'string' ? value : json(value)); };
const safe = (v, label) => { if (!/^[a-z][a-z0-9-]{0,39}$/.test(v)) throw new Error(`${label} must be a lower-case neutral identifier (maximum 40 characters)`); return v; };
const copySource = async (source, destination) => cp(source, destination, { recursive: true, filter: (p) => !p.split('/').some((s) => ['node_modules','.venv','__pycache__','.git','workload-locks'].includes(s)) });

/** Generate a native provider project and a command plan. This never invokes a cloud API. */
export async function prepare({ provider, scenario, outputDir, repoRoot, runId, region = 'eu-west-1', stage = 'bench', nativeBindings = {} }) {
  if (!['candidate','serverless','sst','cdk','ravion','render','heroku'].includes(provider)) throw new Error(`Unknown provider: ${provider}`);
  repoRoot = resolve(repoRoot); outputDir = resolve(outputDir);
  const owner=nativeBindings.owner; if(owner)safe(owner,'benchmark owner');
  const bucket=nativeBindings.serverless?.deploymentBucket;
  if(nativeBindings.serverless&&(provider!=='serverless'||typeof bucket!=='string'||!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)))throw Error('Supply an owned Serverless deployment bucket for Serverless only');
  const bootstrap=nativeBindings.cdk;
  if(bootstrap&&(provider!=='cdk'||!/^[a-z0-9]{1,10}$/.test(bootstrap.qualifier||'')||!bootstrap.toolkitStackName))throw Error('Supply both CDK bootstrap qualifier and toolkit stack name for CDK only');
  if(bootstrap)safe(bootstrap.toolkitStackName,'CDK toolkit stack name');
  safe(stage, 'stage');
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region)) throw new Error('Invalid AWS region');
  const name = safe(`bench-${String(runId).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0,26)}`, 'runId');
  const manifest = JSON.parse(await readFile(join(repoRoot, 'fixtures/manifest.json'), 'utf8'));
  const isLambda = scenario.fixture.startsWith('lambda-');
  const workload = isLambda ? manifest.lambda.workloads.find((v) => v.id === scenario.fixture) : null;
  if (isLambda && !workload) throw new Error(`Unknown Lambda fixture: ${scenario.fixture}`);
  const functions = isLambda ? workload.functions.map((n) => manifest.lambda.functions.find((v) => v.name === n)) : [];
  const services = isLambda ? [] : scenario.fixture === 'five-services'
    ? manifest.fiveServices.services
    : [manifest.containers.find((v) => v.id === `container-${scenario.fixture}`)].map((v) => ({ ...v, name: 'api' }));
  if (!isLambda && services.some((v) => !v.buildContext)) throw new Error(`Unknown container fixture: ${scenario.fixture}`);
  await mkdir(outputDir, { recursive: true });
  if (isLambda) {
    await copySource(join(repoRoot, manifest.lambda.context), join(outputDir, 'app'));
    const selectedLocks=join(repoRoot,manifest.lambda.context,'workload-locks',scenario.fixture);
    if(await exists(join(selectedLocks,'package.json')))for(const file of ['package.json','package-lock.json'])await copyFile(join(selectedLocks,file),join(outputDir,'app',file));
    const workloadData=JSON.parse(await readFile(join(repoRoot,manifest.lambda.context,'workloads.json'),'utf8'));
    await write(outputDir,'app/workloads.json',{[scenario.fixture.slice(7)]:workloadData[scenario.fixture.slice(7)]});
    await write(outputDir,'manifest.json',{...manifest,lambda:{...manifest.lambda,workloads:[workload],functions}});
    for(const f of manifest.lambda.functions.filter(f=>!workload.functions.includes(f.name)))for(const path of [f.entry,f.revisionFile])await rm(join(outputDir,'app',relative(join(repoRoot,manifest.lambda.context),join(repoRoot,path))),{force:true});
  }
  else for (const svc of services) await copySource(join(repoRoot, svc.buildContext), join(outputDir, 'app', svc.name));
  const result = { cwd: outputDir, appName:name, nativeBindings, commands: {}, readiness: { type: isLambda ? 'lambda-invocation' : 'http-version-and-business-probe', fixture: scenario.fixture, manifest: join(repoRoot,'fixtures/manifest.json'), expectedOutputsFile: join(outputDir,'native-outputs.json') }, artifacts: { format: isLambda ? 'lambda-zips-and-layers' : 'provider-native', comparable: false, qualificationRequired: true }, notes: [], availability: 'qualification-required' };
  if (isLambda) result.commands.install = [['npm','ci','--ignore-scripts','--prefix',join(outputDir,'app')]];
  const tool = (p, binary = p) => join(repoRoot, 'providers/tools', p, 'node_modules/.bin', binary);
  if (['serverless','sst','cdk'].includes(provider)) {
    const nodeModules = join(repoRoot,'providers/tools',provider,'node_modules');
    if (await exists(nodeModules)) {
      await mkdir(join(outputDir,'node_modules'), {recursive:true});
      for (const entry of await readdir(nodeModules)) {
        if (entry === '.bin') continue;
        const target=join(outputDir,'node_modules',entry);
        if (!(await exists(target))) await symlink(join(nodeModules,entry),target,'dir');
      }
    }
    result.commands.install ??= [];
    result.commands.install.unshift(['npm','ci','--prefix',join(repoRoot,'providers/tools',provider)]);
    result.commands.install.push(['node',join(repoRoot,'providers/link-tools.mjs'),outputDir,join(repoRoot,'providers/tools',provider),provider]);
  }
  if (provider === 'candidate') {
    const resourceName=(fixtureName)=>fixtureName.replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
    if(isLambda)result.readiness.functions=functions.map(f=>({name:f.name,resourceName:resourceName(f.name)}));
    const resources = Object.fromEntries(isLambda ? functions.map((f) => [resourceName(f.name), { type:'function', properties:{ runtime:'nodejs22.x', memory:512, timeout:30, packaging:{ type:'js-bundle', properties:{ entryfilePath:`app/${relative(join(repoRoot,manifest.lambda.context),join(repoRoot,f.entry))}`, nodeVersion:22,...f.name==='report'&&{dependenciesToExcludeFromBundle:['pdfkit']} } } } }]) : services.map((s) => [s.name, { type:'web-service', properties:{ resources:{cpu:0.25,memory:512}, packaging:scenario.fixture === 'python' ? {type:'buildpack',properties:{sourceDirectoryPath:`app/${s.name}`}} : {type:'js-bundle',properties:{entryfilePath:`app/${s.name}/server.mjs`,nodeVersion:22,outputModuleFormat:'esm'}}, environment:[{name:'PORT',value:'3000'}] } }]));
    await write(outputDir,'candidate.yml',json({ projectName:name, resources,...owner&&{stackConfig:{tags:[{name:'benchmark-owner',value:owner}]}} }));
    const executable = process.env.CANDIDATE_CLI || '<CANDIDATE_CLI>';
    const common = ['--configPath','candidate.yml','--stage',stage,'--region',region,'--autoConfirmOperation'];
    result.commands.setup = [[executable,'deploy',...common,'--fullDeploy']];
    result.commands.package = [[executable,'package','--configPath','candidate.yml','--stage',stage,'--region',region]];
    result.commands.update = [[executable,'deploy',...common]];
    result.commands.cleanup = [[executable,'delete',...common]];
    result.notes.push('Lambda functions use the native JavaScript builder and shared-layer defaults. The report keeps PDFKit external so its font assets remain available. Node containers use ESM output to preserve the source entrypoint guard; Python uses the native source buildpack. Native map and minification defaults are retained. Updates use automatic fast deployment; setup alone forces a full deployment.');
    result.reason = process.env.CANDIDATE_CLI ? 'The supplied candidate artifact and generated resources must pass native artifact and fast-path readiness qualification.' : 'Supply a pinned candidate executable in CANDIDATE_CLI, then qualify its artifacts and fast deployment.';
  } else if (provider === 'serverless' && isLambda) {
    for(const file of ['build-timing.mjs','serverless-build-stage.cjs']){await mkdir(join(outputDir,'.benchmark-instrumentation'),{recursive:true});await copyFile(join(repoRoot,'providers',file),join(outputDir,'.benchmark-instrumentation',file));}
    await write(outputDir,'package-lock.json',JSON.parse(await readFile(join(outputDir,'app/package-lock.json'),'utf8')));
    await mkdir(join(outputDir,'node_modules'),{recursive:true});
    const fixtureDependencies=JSON.parse(await readFile(join(outputDir,'app/package.json'),'utf8')).dependencies;
    for (const dep of Object.keys(fixtureDependencies)) {const target=join(outputDir,'node_modules',dep);await mkdir(dirname(target),{recursive:true});if (!(await exists(target))) await symlink(join(outputDir,'app/node_modules',dep),target,'dir');}
    const entries = Object.fromEntries(functions.map((f) => [f.name,{handler:`app/handlers/${f.name}.handler`,name:`${name}-${stage}-${f.name}`,...f.name!=='report'&&{package:{patterns:['!node_modules/**']}}} ]));
    await write(outputDir,'package.json',JSON.parse(await readFile(join(outputDir,'app/package.json'),'utf8')));
    const config = { frameworkVersion:versions.serverless, plugins:['./.benchmark-instrumentation/serverless-build-stage.cjs'], service:name, provider:{name:'aws',runtime:'nodejs22.x',region,stage,memorySize:512,timeout:30,...bucket&&{deploymentBucket:{name:bucket,serverSideEncryption:'AES256'}},...owner&&{tags:{'benchmark-owner':owner},stackTags:{'benchmark-owner':owner}}}, package:{individually:true,patterns:['!app/check.mjs','!app/workloads.json','!app/package-lock.json','!provider-plan.json','!manifest.json','!plan.json','!qualification.json','!qualifications.json','!native-outputs.json','!**/*.log','!**/evidence/**','!.parallel-functions/**','!.benchmark-instrumentation/**','!**/serverless-build-stage.cjs','!**/build-timing.mjs','!**/build-inputs.json','!**/native-build-*.json*']}, functions:entries, build:{esbuild:{minify:true,sourcemap:false,external:['pdfkit'],banner:{js:"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"}}} };
    await write(outputDir,'serverless.yml',json(config));
    const common=['--stage',stage,'--region',region];
    result.commands.setup=[[tool(provider),'deploy',...common]];
    result.commands.package=[[tool(provider),'package',...common]];
    result.commands.update=[['node',join(repoRoot,'providers/parallel-functions.mjs'),tool(provider),stage,region,...workload.changedFunctions]];
    result.commands.cleanup=[[tool(provider),'remove',...common]];
    result.artifacts.paths=['.serverless/*.zip'];
    result.notes.push('Serverless Framework built-in esbuild; production minification enabled, maps disabled. PDFKit is externalized for its font assets; ExcelJS and docx stay bundled. The native createRequire banner supports CommonJS dependencies in the ESM output. deploy function updates every changed function without a CloudFormation update. Up to eight native commands run concurrently (BENCH_FUNCTION_CONCURRENCY changes the disclosed limit).');
    result.reason='Qualify the native ZIPs with fixture probes; CLI package requires an authenticated Serverless account in versions that enforce login.';
    result.readiness.functions=functions.map((f)=>({name:f.name,functionName:`${name}-${stage}-${f.name}`}));
  } else if (['sst','cdk'].includes(provider) && isLambda) {
    if (provider === 'sst') {
      await write(outputDir,'sst.config.ts',`/// <reference path="./.sst/platform/config.d.ts" />\nexport default $config({\n app() { return { name:${JSON.stringify(name)},home:'aws',removal:'remove',providers:{aws:{region:${JSON.stringify(region)}${owner?`,defaultTags:{tags:{'benchmark:owner':${JSON.stringify(owner)}}}`:''}}}}; },\n async run() {\n const functions = {};\n${functions.map((f)=>` const f_${f.name.replaceAll('-','_')} = new sst.aws.Function(${JSON.stringify(f.name)}, {handler:${JSON.stringify(`app/handlers/${f.name}.handler`)},runtime:'nodejs22.x',memory:'512 MB',timeout:'30 seconds',nodejs:{install:${JSON.stringify(f.name === 'report' ? ['pdfkit'] : [])}}});\n functions[${JSON.stringify(f.name)}]=f_${f.name.replaceAll('-','_')}.arn;`).join('\n')}\n return {functions};\n }\n});\n`);
      await write(outputDir,'sst-build-inputs.json',functions.map(f=>({dev:false,functionID:f.name,handler:`app/handlers/${f.name}.handler`,runtime:'nodejs22.x',links:{},copyFiles:[],properties:{architecture:'x86_64',install:f.name==='report'?{pdfkit:'*'}:{}}})));
      if(scenario.kind==='package')result.commands.install.push(['node',join(repoRoot,'providers/install-sst-bridge.mjs')]);
      result.commands.package=[['node',join(repoRoot,'providers/package-sst.mjs'),repoRoot]];
      result.requiredPackageEnvironment=['SST_PACKAGE_ENCRYPTION_KEY'];
      const common=['--stage',stage];
      result.commands.setup=[[tool(provider),'deploy',...common]];
      result.commands.update=[[tool(provider),'deploy',...common]];
      result.commands.cleanup=[[tool(provider),'remove',...common]];
      result.notes.push('SST cloud deploy uses its usual production build settings; PDFKit installed with its font assets; ExcelJS and docx remain bundled. Live mode is excluded. SST complete packaging uses the pinned upstream native-runtime bridge and platform archiver; byte/runtime parity still requires qualification.');
    } else {
      await write(outputDir,'cdk.json',{app:'node cdk-app.mjs',context:{'@aws-cdk/core:newStyleStackSynthesis':true,...bootstrap&&{'@aws-cdk/core:bootstrapQualifier':bootstrap.qualifier}}});
      await write(outputDir,'cdk-app.mjs',`import {App,Stack,CfnOutput,Duration,Tags} from 'aws-cdk-lib';\nimport {Runtime} from 'aws-cdk-lib/aws-lambda';\nimport {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';\nimport {resolve} from 'node:path';\nconst app=new App(); const stack=new Stack(app,${JSON.stringify(name)}, {env:{region:${JSON.stringify(region)}}});\nif(process.env.BENCH_BUILD_TIMING_FILE){const {writeBuildStart}=await import(process.env.BENCH_BUILD_STAGE_HELPER);await writeBuildStart('cdk');}\n${functions.map((f)=>`const f_${f.name.replaceAll('-','_')}=new NodejsFunction(stack,${JSON.stringify(f.name)},{entry:resolve(${JSON.stringify(`app/handlers/${f.name}.mjs`)}),handler:'handler',depsLockFilePath:resolve('app/package-lock.json'),projectRoot:resolve('app'),runtime:Runtime.NODEJS_22_X,functionName:${JSON.stringify(`${name}-${stage}-${f.name}`)},memorySize:512,timeout:Duration.seconds(30),bundling:{minify:true,sourceMap:false,nodeModules:${JSON.stringify(f.name === 'report' ? ['pdfkit'] : [])}}});\nnew CfnOutput(stack,${JSON.stringify(f.name.replaceAll('-','')+'Arn')},{value:f_${f.name.replaceAll('-','_')}.functionArn});`).join('\n')}\n${owner?`Tags.of(stack).add('benchmark-owner',${JSON.stringify(owner)});\n`:''}app.synth();\n`);
      const common=['--require-approval','never','--outputs-file','native-outputs.json',...(bootstrap?['--toolkit-stack-name',bootstrap.toolkitStackName]:[])];
      result.commands.setup=[[tool(provider),'deploy',...common]];
      result.commands.package=[['node',join(repoRoot,'providers/package-cdk.mjs'),join(repoRoot,'providers/tools/cdk')]];
      result.commands.update=[[tool(provider),'deploy','--hotswap',...common]];
      result.commands.cleanup=[[tool(provider),'destroy','--force',...(bootstrap?['--toolkit-stack-name',bootstrap.toolkitStackName]:[])]];
      result.readiness.functions=functions.map((f)=>({name:f.name,functionName:`${name}-${stage}-${f.name}`}));
      result.notes.push('CDK NodejsFunction production minification enabled, maps disabled; PDFKit installed with font assets; ExcelJS and docx remain bundled. synth creates asset directories, not necessarily upload-ready ZIPs. --hotswap is documented by CDK for development and creates CloudFormation drift.');
    }
    result.artifacts.manifest='package-artifacts/manifest.json';
    result.reason='Native deployment is configured; complete ZIP/layer boundary and runtime probes still require qualification. Native complete-artifact bridges produce final ZIPs; their deployed-artifact and runtime parity must be qualified.';
  } else if (['sst','cdk'].includes(provider) && !isLambda) {
    await prepareEcs({provider,services,outputDir,repoRoot,name,stage,region,tool,result,scenario});
  } else if (provider === 'render' && !isLambda) {
    await write(outputDir,'render.yaml',`services:\n${services.map((s)=>`  - type: web\n    name: ${name}-${s.name}\n    runtime: ${scenario.fixture === 'python' ? 'python' : 'node'}\n    plan: starter\n    rootDir: ${s.buildContext}\n    buildCommand: ${scenario.fixture === 'python' ? 'pip install --require-hashes -r requirements.txt' : 'npm ci --omit=dev'}\n    startCommand: ${scenario.fixture === 'python' ? 'uvicorn app:app --host 0.0.0.0 --port $PORT' : 'npm start'}\n    healthCheckPath: /version\n    autoDeployTrigger: commit\n`).join('')}`);
    result.commands.update=services.filter((s)=>scenario.fixture !== 'five-services' || manifest.fiveServices.changedServices.includes(s.name)).map((s)=>['render','deploys','create',process.env[`RENDER_SERVICE_${s.name.toUpperCase()}`] || `<RENDER_SERVICE_${s.name.toUpperCase()}>`,'--commit',process.env.BENCH_COMMIT || '<BENCH_COMMIT>','--wait','--confirm','--output','json']);
    await write(outputDir,'render-update-commands.json',result.commands.update);
    result.commands.update=[['node',join(repoRoot,'providers/parallel-commands.mjs'),'render-update-commands.json']];
    result.requiredEnvironment=[...services.map(s=>`RENDER_SERVICE_${s.name.toUpperCase()}`),'BENCH_COMMIT'];
    const bound=result.requiredEnvironment.every(k=>Boolean(process.env[k])) && /^[a-f0-9]{40}$/.test(process.env.BENCH_COMMIT || '');
    result.availability=bound?'qualification-required':'account-required'; result.reason='Create native services from the blueprint and record their service IDs, actual plan/build capacity and revision URLs. Packaging-only build phase and artifact-size observability still need qualification.';
    result.notes.push('Render native language runtime; no supplied Dockerfile. Hosted builder versions are recorded from each build log rather than assumed pinned. Native runtime output is not automatically a customer-exportable OCI image.');
    result.artifacts.format='render-native-runtime';
  } else if (provider === 'ravion' && !isLambda) {
    result.commands.discovery=[['ravion','project','config','schema'],['ravion','module','definition','list'],['ravion','module','schema','rvn-ecs-web']];
    result.commands.update=[['node',join(repoRoot,'providers/hosted.mjs'),'ravion',process.env.RAVION_PIPELINE_ID || '<RAVION_PIPELINE_ID>',process.env.RAVION_VARIANT_ID || '<RAVION_VARIANT_ID>',process.env.BENCH_COMMIT || '<BENCH_COMMIT>',name]];
    result.requiredEnvironment=['RAVION_PIPELINE_ID','RAVION_VARIANT_ID','BENCH_COMMIT'];
    const bound=result.requiredEnvironment.every(k=>Boolean(process.env[k])) && /^[a-f0-9]{40}$/.test(process.env.BENCH_COMMIT || '');
    result.availability=bound?'qualification-required':'account-required'; result.reason='Export the current standard module schema, project and build/deploy pipeline from the connected account. The qualified pipeline must accept a commit input and use the native Railpack builder.';
    result.notes.push('Fresh standard modules use the provider default Sandbox capacity; older saved EC2 capacity must not silently stand in for that default. Preserve five independent source paths. Do not fabricate module inputs or classify an unobserved queue-inclusive run as build time.');
    result.artifacts.format='oci-image';
  } else if (provider === 'heroku' && !isLambda) {
    const native={schemaVersion:1,appId:String(runId),repoRoot,outputDir,fixture:scenario.fixture,generation:'cedar',stack:'heroku-24',dyno:'basic',region:process.env.HEROKU_BENCH_REGION||'eu',runtimeSelectors:{node:process.env.HEROKU_NODE_VERSION||'22.22.0',python:process.env.HEROKU_PYTHON_VERSION||'3.11.14'},services:services.map(s=>({name:s.name,sourceRoot:s.buildContext,appName:process.env[`HEROKU_APP_${s.name.toUpperCase()}`]||`bench-${createHash('sha256').update(name+'-'+stage+'-'+s.name).digest('hex').slice(0,12)}-${s.name.slice(0,10)}`,buildpack:scenario.fixture==='python'?'heroku/python':'heroku/nodejs',githubRemote:process.env[`HEROKU_GITHUB_REMOTE_${s.name.toUpperCase()}`],githubBranch:process.env[`HEROKU_GITHUB_BRANCH_${s.name.toUpperCase()}`]}))};
    await write(outputDir,'heroku-plan.json',native);
    const adapter=join(repoRoot,'providers/heroku.mjs'),common=['--plan','heroku-plan.json'];
    result.commands.discovery=[['heroku','--version'],['heroku','plugins']];
    result.commands.prepareSource=[['node',join(repoRoot,'providers/heroku-source.mjs'),'project','--repo',repoRoot,'--fixture',scenario.fixture,'--output',outputDir,'--plan',join(outputDir,'heroku-plan.json'),'--node-version',native.runtimeSelectors.node,'--python-version',native.runtimeSelectors.python]];
    result.commands.setup=[['node',adapter,'setup',...common,'--execute']];
    result.commands.activate=[['node',adapter,'activate',...common,'--execute']];
    result.commands.update=[['node',join(repoRoot,'providers/parallel-commands.mjs'),'heroku-update-commands.json']];
    result.env={GIT_TERMINAL_PROMPT:'0',GIT_TRACE:'0',GIT_TRACE_CURL:'0',GIT_TRACE_REDACT:'1'};
    result.commands.cleanup=[['node',adapter,'cleanup',...common,'--execute']];
    result.readiness.services=native.services.map(s=>({name:s.name,appName:s.appName}));
    result.artifacts.format='heroku-slug';
    const githubBound=native.services.every(s=>s.githubRemote&&s.githubBranch);
    result.availability=scenario.journey?.startsWith('git-')&&!githubBound?'account-required':'qualification-required';
    result.reason=scenario.kind==='package'?'Native build logs and compressed slug capture are executable; qualify exact packaging-phase events and cache observations before importing a managed package result. Total Git push time is not packaging time.':scenario.journey?.startsWith('git-')&&!githubBound?'Bind app-only GitHub repositories/branches and verify native Heroku automatic deployments; CLI authentication alone does not provide that integration.':'Project the exact selected source, create recorded owned Cedar apps, push the baseline, activate Basic, and qualify native build/release/slug plus business probes.';
    result.notes.push('Cedar Common Runtime Basic with official buildpacks. The CLI update pushes app-only Git inputs directly to Heroku; GitHub automation is a separate destination. Three changed service inputs are pushed concurrently; unchanged trees reuse their exact native commits. Compressed slug bytes remain separate from OCI image bytes. Native preparation, source projection, baseline activation and cache purge are outside timing.');
  } else {
    result.availability='unsupported';result.reason=`${provider} has no selected native ${isLambda ? 'Lambda' : 'container'} recipe in this comparison.`;
  }
  if (scenario.journey?.startsWith('git-')) result.notes.push('Git journeys start at the push. CLI update commands are diagnostic/manual alternatives and must not be substituted for a Git-triggered measurement. Preserve native workflow, commit identity and actual cache/runner evidence.');
  result.qualificationRequirements = ['native-artifact-boundary','live-business-and-revision-probes','owned-resource-cleanup'];
  if (provider === 'candidate') result.qualificationRequirements.push('reviewed-binary-sha256','automatic-fast-path');
  if (!isLambda && ['sst','cdk'].includes(provider)) result.qualificationRequirements.push('native-container-build-invocation','compressed-oci-image-bytes');
  if (['render','ravion'].includes(provider)) result.qualificationRequirements.push('hosted-build-phase-observed','platform-version-and-capacity-recorded');
  if(provider==='heroku')result.qualificationRequirements.push('immutable-app-only-source-mapping','exact-native-build-release-slug','official-buildpack-runtime','native-cache-and-build-phase','compressed-slug-bytes');
  await write(outputDir,'provider-plan.json',result);
  return result;
}

async function prepareEcs({provider,services,outputDir,repoRoot,name,stage,region,tool,result,scenario}) {
  const python=scenario.fixture === 'python';
  const baseImage=python ? 'python:3.11.14-slim-bookworm@sha256:65a93d69fa75478d554f4ad27c85c1e69fa184956261b4301ebaf6dbb0a3543d' : 'node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94';
  for (const svc of services) {
    const recipe=python ? `FROM ${baseImage}\nWORKDIR /app\nENV PORT=3000 PYTHONUNBUFFERED=1\nCOPY requirements.txt ./\nRUN pip install --no-cache-dir --require-hashes -r requirements.txt\nCOPY . .\nEXPOSE 3000\nCMD ["python", "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", "3000"]\n` : `FROM ${baseImage}\nWORKDIR /app\nENV NODE_ENV=production PORT=3000\nCOPY package.json package-lock.json ./\nRUN npm ci --omit=dev --no-audit --no-fund\nCOPY . .\nUSER node\nEXPOSE 3000\nCMD ["node", "server.mjs"]\n`;
    for(const owner of ['cdk','sst'])await write(outputDir,`app/${svc.name}/Dockerfile.${owner}`,recipe);
    await rm(join(outputDir,'app',svc.name,'Dockerfile'),{force:true});
    await write(outputDir,`app/${svc.name}/.dockerignore`,'node_modules\n.venv\n__pycache__\n.git\nDockerfile.cdk\nDockerfile.sst\n');
  }
  if(provider === 'cdk') {
    await write(outputDir,'cdk.json',{app:'node cdk-app.mjs',context:{'@aws-cdk/core:newStyleStackSynthesis':true}});
    await write(outputDir,'cdk-app.mjs',`import {App,Stack,CfnOutput,Duration} from 'aws-cdk-lib';\nimport {Vpc,SubnetType} from 'aws-cdk-lib/aws-ec2';\nimport {Cluster,ContainerImage} from 'aws-cdk-lib/aws-ecs';\nimport {ApplicationLoadBalancedFargateService} from 'aws-cdk-lib/aws-ecs-patterns';\nimport {resolve} from 'node:path';\nconst app=new App();const stack=new Stack(app,${JSON.stringify(name)},{env:{region:${JSON.stringify(region)}}});\nconst vpc=new Vpc(stack,'Vpc',{maxAzs:2,natGateways:0,subnetConfiguration:[{name:'public',subnetType:SubnetType.PUBLIC}]});const cluster=new Cluster(stack,'Cluster',{vpc});new CfnOutput(stack,'ClusterArn',{value:cluster.clusterArn});\n${services.map(s=>`const ${s.name}=new ApplicationLoadBalancedFargateService(stack,${JSON.stringify(s.name)},{cluster,cpu:256,memoryLimitMiB:512,desiredCount:1,assignPublicIp:true,taskSubnets:{subnetType:SubnetType.PUBLIC},publicLoadBalancer:true,minHealthyPercent:100,maxHealthyPercent:200,taskImageOptions:{image:ContainerImage.fromAsset(resolve(${JSON.stringify('app/'+s.name)}),{file:'Dockerfile.cdk'}),containerPort:3000,environment:{PORT:'3000'}}});\n${s.name}.targetGroup.configureHealthCheck({path:'/version'});new CfnOutput(stack,${JSON.stringify(s.name+'Url')},{value:'http://'+${s.name}.loadBalancer.loadBalancerDnsName});new CfnOutput(stack,${JSON.stringify(s.name+'Service')},{value:${s.name}.service.serviceArn});`).join('\n')}\napp.synth();\n`);
    const common=['--require-approval','never','--outputs-file','native-outputs.json'];
    result.commands.setup=[[tool(provider),'deploy',...common]];
    result.commands.update=[[tool(provider),'deploy','--hotswap',...common]];
    result.commands.cleanup=[[tool(provider),'destroy','--force']];
  } else {
    await write(outputDir,'sst.config.ts',`/// <reference path="./.sst/platform/config.d.ts" />\nexport default $config({app(){return {name:${JSON.stringify(name)},home:'aws',removal:'remove',providers:{aws:{region:${JSON.stringify(region)}}}}},async run(){const vpc=new sst.aws.Vpc('Vpc');const cluster=new sst.aws.Cluster('Cluster',{vpc});const outputs={clusterArn:cluster.nodes.cluster.arn};\n${services.map(s=>`const ${s.name}=new sst.aws.Service(${JSON.stringify(s.name)},{cluster,image:{context:${JSON.stringify('app/'+s.name)},dockerfile:'Dockerfile.sst'},cpu:'0.25 vCPU',memory:'0.5 GB',environment:{PORT:'3000'},loadBalancer:{rules:[{listen:'80/http',forward:'3000/http'}],health:{'3000/http':{path:'/version'}}},wait:false});outputs[${JSON.stringify(s.name)}]={url:${s.name}.url,serviceArn:${s.name}.nodes.service.arn};`).join('\n')}\nreturn outputs;}});\n`);
    result.commands.setup=[[tool(provider),'deploy','--stage',stage]];
    result.commands.update=[[tool(provider),'deploy','--stage',stage]];
    result.commands.cleanup=[[tool(provider),'remove','--stage',stage]];
  }
  result.commands.package=[['node',join(repoRoot,'providers/package-container.mjs'),provider,name]];
  result.availability='qualification-required';
  result.containerBackend='ecs';
  result.artifacts.manifest='package-artifacts/manifest.json';
  result.artifacts.diagnosticOnly=true;
  result.reason='Native ECS image build/deployment recipe is generated. Qualify the actual native image build invocation, final compressed OCI bytes, source-revision probes and cleanup before recording results. Template synthesis alone is not an image build.';
  result.notes.push('Each competitor uses its native Docker image builder and a provider-owned ordinary production Dockerfile. The candidate keeps its optimized automatic builder. Dependencies are installed before source copying to retain the native dependency layer cache. The five service contexts remain independent.');
  result.notes.push(provider==='cdk' ? 'CDK hotswap retains its native ECS minimum-healthy behavior; record any availability difference and wait for the new live revision. No CloudFormation deployment is timed.' : 'SST Service keeps its native wait:false default; runtime revision and business probes determine readiness after the CLI exits.');
  result.artifacts.format='oci-image';
  result.artifacts.baseImage=baseImage;
}

/** Reviewable native files for a lean test branch; source files are never duplicated. */
export async function reviewFiles({provider,fixture,repoRoot,runId}) {
 repoRoot=resolve(repoRoot);
 const generated=join(repoRoot,'.work/review-generation',`${provider}-${fixture}`);
 const plan=await prepare({provider,scenario:{kind:'package',fixture,journey:'local'},outputDir:generated,repoRoot,runId});
 const manifest=JSON.parse(await readFile(join(repoRoot,'fixtures/manifest.json'),'utf8'));
 const lambda=fixture.startsWith('lambda-'),folder=`deployment/${provider}`,files={};
 const source=lambda?'../../fixtures/lambdas':null;
 const services=lambda?[]:fixture==='five-services'?manifest.fiveServices.services:[{...manifest.containers.find(c=>c.id==='container-'+fixture),name:'api'}];
 const rewrite=(text)=>lambda?text.replaceAll('app/handlers/','../../fixtures/lambdas/handlers/').replaceAll('app/package-lock.json','../../fixtures/lambdas/package-lock.json').replaceAll("resolve('app')", "resolve('../../fixtures/lambdas')"):services.reduce((s,v)=>s.replaceAll(`app/${v.name}`,`../../${v.buildContext}`),text);
 const names=provider==='candidate'?['candidate.yml']:provider==='sst'?['sst.config.ts',...(lambda?['sst-build-inputs.json']:[])]:provider==='cdk'?['cdk.json','cdk-app.mjs']:provider==='render'?['render.yaml']:[];
 for(const n of names){let text=rewrite(await readFile(join(generated,n),'utf8'));
  files[`${folder}/${n}`]=text;
 }
 if(!lambda&&['sst','cdk'].includes(provider))for(const svc of services){for(const owner of ['cdk','sst'])files[`${svc.buildContext}/Dockerfile.${owner}`]=await readFile(join(generated,'app',svc.name,`Dockerfile.${owner}`),'utf8');files[`${svc.buildContext}/.dockerignore`]=await readFile(join(generated,'app',svc.name,'.dockerignore'),'utf8');}
 if(lambda&&['sst','cdk'].includes(provider)){
  const readiness={...plan.readiness,manifest:'../../fixtures/manifest.json',sourceRoot:source};delete readiness.expectedOutputsFile;
  files[`${folder}/provider-plan.json`]=json({readiness});
 }
 let commands=[];
 if(['sst','cdk'].includes(provider)){
  commands=[`cd ${folder}`,`npm ci --prefix ../../providers/tools/${provider}`];
  if(lambda)commands.push('npm ci --ignore-scripts --prefix ../../fixtures/lambdas',`node ../../providers/link-tools.mjs . ../../providers/tools/${provider} ${provider} ../../fixtures/lambdas`);
  else commands.push(`node ../../providers/link-tools.mjs . ../../providers/tools/${provider} ${provider}`);
  if(lambda&&provider==='sst')commands.push('node ../../providers/install-sst-bridge.mjs','SST_PACKAGE_ENCRYPTION_KEY must be supplied through the environment before packaging.','node ../../providers/package-sst.mjs ../..');
  if(lambda&&provider==='cdk')commands.push('node ../../providers/package-cdk.mjs ../../providers/tools/cdk');
  commands.push(`../../providers/tools/${provider}/node_modules/.bin/${provider} deploy ${provider==='sst'?'--stage bench':'--require-approval never --outputs-file native-outputs.json'}`);
  commands.push(`Fast update: ../../providers/tools/${provider}/node_modules/.bin/${provider} deploy ${provider==='sst'?'--stage bench':'--hotswap --require-approval never --outputs-file native-outputs.json'}`);
  commands.push(`Cleanup: ../../providers/tools/${provider}/node_modules/.bin/${provider} ${provider==='sst'?'remove --stage bench':'destroy --force'}`);
 }
 if(provider==='candidate')commands=[`cd ${folder}`,'Use the reviewed CANDIDATE_CLI executable.','package --configPath candidate.yml --stage bench --region eu-west-1','Initial setup: deploy --configPath candidate.yml --stage bench --region eu-west-1 --autoConfirmOperation --fullDeploy','Fast update: deploy --configPath candidate.yml --stage bench --region eu-west-1 --autoConfirmOperation','Cleanup: delete --configPath candidate.yml --stage bench --region eu-west-1 --autoConfirmOperation'];
 if(provider==='serverless'&&lambda){
  const config=JSON.parse(await readFile(join(generated,'serverless.yml'),'utf8'));
  config.plugins=['./.benchmark-instrumentation/serverless-build-stage.cjs'];
  for(const name of ['build-timing.mjs','serverless-build-stage.cjs'])files['.benchmark-instrumentation/'+name]=await readFile(join(generated,'.benchmark-instrumentation',name),'utf8');
  for(const f of Object.values(config.functions))f.handler=f.handler.replace('app/handlers/','fixtures/lambdas/handlers/');
  config.package.patterns.push('!deployment/**','!providers/**','!docs/**','!scripts/**','!scenarios/**','!.work/**','!results/**');
  files['serverless.yml']=json(config);
  const pkg=JSON.parse(await readFile(join(repoRoot,'package.json'),'utf8')),dep=JSON.parse(await readFile(join(generated,'app/package.json'),'utf8'));
  pkg.dependencies={...pkg.dependencies,...dep.dependencies};files['package.json']=json(pkg);
  const lock=JSON.parse(await readFile(join(generated,'app/package-lock.json'),'utf8'));lock.name=pkg.name;lock.version=pkg.version;lock.packages[''].name=pkg.name;lock.packages[''].version=pkg.version;files['package-lock.json']=json(lock);
  commands=['Run these commands from the repository root.','npm ci --ignore-scripts','npm ci --prefix providers/tools/serverless','node providers/link-tools.mjs . providers/tools/serverless serverless .','providers/tools/serverless/node_modules/.bin/serverless package --stage bench --region eu-west-1','Initial setup: providers/tools/serverless/node_modules/.bin/serverless deploy --stage bench --region eu-west-1',`Fast update: node providers/parallel-functions.mjs providers/tools/serverless/node_modules/.bin/serverless bench eu-west-1 ${manifest.lambda.workloads.find(w=>w.id===fixture).changedFunctions.join(' ')}`,'Cleanup: providers/tools/serverless/node_modules/.bin/serverless remove --stage bench --region eu-west-1'];
 }
 if(provider==='render')commands=['Select deployment/render/render.yaml when creating the neutral native blueprint.','Select the source directory shown by rootDir; do not build the benchmark harness as part of the app.','Record service IDs, the actual builder capacity and URLs before qualification.','Manual deploy: render deploys create SERVICE_ID --commit FULL_COMMIT --wait --confirm --output json','Run all changed service commands concurrently; then check every service with the common business/revision probes.','Cleanup: delete each recorded benchmark service in the Render dashboard, then verify every recorded service is absent.'];
 if(provider==='ravion')commands=['Discover the current native schema: ravion project config schema','List current modules: ravion module definition list','Inspect the web module: ravion module schema rvn-ecs-web','Export the owned Railpack project and exact-commit pipeline into ignored campaign state.','Set RAVION_PIPELINE_ID, RAVION_VARIANT_ID and BENCH_COMMIT after validating the pipeline input.','Native run: node providers/hosted.mjs ravion PIPELINE_ID VARIANT_ID FULL_COMMIT NEUTRAL_DESCRIPTION','Cleanup: use the recorded owned project/module destruction procedure from the exported schema, verify its AWS resources are gone, then remove the temporary account connection. No unverified generic deletion command is supplied.'];
 if(provider==='heroku')commands=['Use the pinned Heroku CLI and official builds plugin from provider setup.','Prepare the native command plan from the selected branch before provisioning.','Project source outside timing: run commands.prepareSource from the generated plan. It creates only app-owned Git trees, native Procfile/runtime selectors and an immutable original/native SHA mapping.','Create the recorded owned Cedar apps with commands.setup outside timing. Push the baseline, then use commands.activate to run one Basic web dyno per app. Verify every baseline business probe.','CLI update: execute the generated heroku-update-commands.json concurrently through providers/parallel-commands.mjs. Those commands are native direct Heroku Git pushes.','GitHub update: bind one app-only branch per app and configure native automatic deployments in Heroku; use the projected immutable commits, not the benchmark harness as the source root.','Observe exact native builds/releases/slugs with providers/heroku.mjs completion and capture; require the original source mapping and actual push start.','Purge native cache with providers/heroku.mjs purge outside timing; qualify restoration and packaging phase events against real native logs.','Cleanup: execute commands.cleanup, which deletes only recorded owned app IDs and verifies their absence.'];
 files[`${folder}/README.md`]=`# ${provider} recipe\n\nThis file shows the native commands and configuration for ${fixture}. The comparison runner still supplies a reviewed app identity, cache policy and runtime probes. The example resource names are stable across this workload's CLI and Git branches. Setup, dependency installation and cleanup are outside the timed update. Do not run a deployment before the campaign is approved.\n\n${commands.map(c=>`- ${c}`).join('\n')}\n\n${lambda?'The complete ZIP bridges and post-build probe are explained':'Native builder and artifact-size qualification are explained'} in [provider setup](../../docs/provider-setup.md). A successful command is not a qualified result.\n`;
 files[`${folder}/.gitignore`]='node_modules/\n.sst/\ncdk.out/\n.serverless/\npackage-artifacts/\nnative-outputs.json\n';
 return files;
}

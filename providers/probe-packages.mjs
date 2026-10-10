import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const [manifestFile='package-artifacts/manifest.json']=process.argv.slice(2);
const plan=JSON.parse(await readFile('provider-plan.json','utf8'));
const argv=[join(dirname(fileURLToPath(import.meta.url)),'check-lambda-zips.mjs'),manifestFile,plan.readiness.manifest,plan.readiness.fixture,process.cwd(),plan.readiness.sourceRoot||'app'];
const result=spawnSync(process.execPath,argv,{stdio:'inherit'});if(result.error)throw result.error;process.exitCode=result.status||0;

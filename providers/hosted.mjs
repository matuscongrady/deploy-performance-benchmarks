import { spawnSync } from 'node:child_process';
const [provider,pipeline,variant,commit,description]=process.argv.slice(2);
if (provider !== 'ravion' || !pipeline || !variant || !/^[a-f0-9]{40}$/.test(commit ?? '') || !/^[a-z][a-z0-9-]+$/.test(description ?? '')) throw new Error('Usage: node providers/hosted.mjs ravion PIPELINE VARIANT FULL_COMMIT NEUTRAL_DESCRIPTION');
function call(args) {
 const p=spawnSync('ravion', [...args,'--json'],{encoding:'utf8',timeout:35*60*1000,maxBuffer:16*1024*1024});
 if (p.status !== 0) throw new Error(`Ravion ${args.slice(0,3).join(' ')} failed; inspect the provider dashboard. Exit ${p.status}`);
 return JSON.parse(p.stdout);
}
const run=call(['pipeline','run','create','--pipeline-id',pipeline,'--variant-id',variant,'--input',JSON.stringify({commit}),'--description',description]);
if (typeof run.id !== 'string' || !run.id) throw new Error('Provider did not return a run ID');
const state=call(['pipeline','run','wait',run.id,'--timeout','30m']);
console.log(JSON.stringify({provider,runId:run.id,status:state.status,commit}));
if (state.status !== 'SUCCESS') process.exitCode=1;
